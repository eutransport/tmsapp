"""
Chatbot AI service.
Integrates with OpenAI/GitHub Models/Azure OpenAI to power the smart assistant.
Supports tool calls so the assistant can query TMS data.
"""
import json
import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Je bent een slimme AI-assistent voor een Transport Management Systeem (TMS).
Je helpt gebruikers met vragen over:
- Chauffeurs, voertuigen en vloot
- Ritten en urenregistratie
- Verlofaanvragen en saldo's
- Facturen en omzet
- Onderhoud en APK
- Planning
- Bankafschriften
- Rapportages

Je kunt data opvragen via tools en de resultaten overzichtelijk presenteren.
Antwoord altijd in het Nederlands, beknopt en behulpzaam.
Als je niet weet hoe je iets moet opzoeken, geef dat dan eerlijk aan.
Vandaag is: {today}.
"""

# ---------------------------------------------------------------------------
# Tool definitions
# ---------------------------------------------------------------------------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "run_report",
            "description": (
                "Voer een TMS rapport uit en geef de resultaten terug. "
                "Gebruik dit als een gebruiker gegevens wil zien over ritten, uren, verlof, facturen, "
                "voertuigen, chauffeurs, onderhoud, planning of banktransacties."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "report_type": {
                        "type": "string",
                        "description": "Het rapport type",
                        "enum": [
                            "leave_overview_user",
                            "leave_balance_overview",
                            "leave_requests_overview",
                            "trips_by_user",
                            "trips_by_vehicle",
                            "time_entries_summary",
                            "time_entries_by_user",
                            "time_entries_by_week",
                            "weekly_hours_summary",
                            "vehicle_overview",
                            "vehicle_maintenance",
                            "driver_overview",
                            "driver_activity",
                            "invoice_overview",
                            "invoice_by_company",
                            "revenue_summary",
                            "company_overview",
                            "maintenance_overview",
                            "apk_overview",
                            "planning_overview",
                            "banking_transactions",
                            "spreadsheet_overview",
                        ],
                    },
                    "parameters": {
                        "type": "object",
                        "description": (
                            "Query parameters. Mogelijke sleutels afhankelijk van rapport: "
                            "user_id (UUID), year (int), week (int), date_from (YYYY-MM-DD), "
                            "date_to (YYYY-MM-DD), kenteken (str), ritnummer (str), "
                            "bedrijf_id (UUID), status (str), actief (bool)."
                        ),
                    },
                },
                "required": ["report_type"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "count_records",
            "description": (
                "Tel het aantal records voor een bepaald model in het TMS. "
                "Handig voor snelle overzichtsvragen zoals 'hoeveel chauffeurs zijn er?'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "model": {
                        "type": "string",
                        "description": "Model naam",
                        "enum": [
                            "users", "drivers", "vehicles", "time_entries",
                            "leave_requests", "invoices", "maintenance_tasks",
                            "apk_records", "planning_entries", "bank_transactions",
                            "spreadsheets", "companies",
                        ],
                    },
                    "filter": {
                        "type": "object",
                        "description": "Optionele filter parameters (bijv. {'actief': true, 'year': 2026})",
                    },
                },
                "required": ["model"],
            },
        },
    },
]


# ---------------------------------------------------------------------------
# Tool execution
# ---------------------------------------------------------------------------

def _execute_tool_run_report(tool_args: dict) -> dict:
    """Execute a report query and return results."""
    from apps.reports.services import execute_report
    report_type = tool_args.get("report_type", "")
    parameters = tool_args.get("parameters", {}) or {}
    try:
        columns, rows, title = execute_report(report_type, parameters)
        # Limit rows to avoid huge responses
        truncated = len(rows) > 50
        display_rows = rows[:50]
        return {
            "title": title,
            "columns": columns,
            "rows": display_rows,
            "total_rows": len(rows),
            "truncated": truncated,
        }
    except Exception as exc:
        logger.warning("run_report tool error: %s", exc)
        return {"error": str(exc)}


def _execute_tool_count_records(tool_args: dict) -> dict:
    """Count records for a given model."""
    model_name = tool_args.get("model", "")
    extra_filter = tool_args.get("filter") or {}

    MODEL_MAP = {
        "users": ("apps.accounts.models", "User"),
        "drivers": ("apps.drivers.models", "Driver"),
        "vehicles": ("apps.fleet.models", "Vehicle"),
        "time_entries": ("apps.timetracking.models", "TimeEntry"),
        "leave_requests": ("apps.leave.models", "LeaveRequest"),
        "invoices": ("apps.invoicing.models", "Invoice"),
        "maintenance_tasks": ("apps.maintenance.models", "MaintenanceTask"),
        "apk_records": ("apps.maintenance.models", "APKRecord"),
        "planning_entries": ("apps.planning.models", "PlanningEntry"),
        "bank_transactions": ("apps.banking.models", "BankTransaction"),
        "spreadsheets": ("apps.spreadsheets.models", "Spreadsheet"),
        "companies": ("apps.companies.models", "Company"),
    }

    if model_name not in MODEL_MAP:
        return {"error": f"Onbekend model: {model_name}"}

    module_path, class_name = MODEL_MAP[model_name]
    try:
        import importlib
        module = importlib.import_module(module_path)
        ModelClass = getattr(module, class_name)
        qs = ModelClass.objects.all()

        # Apply simple filters
        safe_filter = {}
        for key, val in extra_filter.items():
            # Only allow safe lookups to avoid injection
            allowed_keys = {
                "actief", "status", "jaar", "jaar__gte", "jaar__lte",
                "datum__year", "created_at__year",
            }
            if key in allowed_keys:
                safe_filter[key] = val
        if safe_filter:
            qs = qs.filter(**safe_filter)

        return {"model": model_name, "count": qs.count()}
    except Exception as exc:
        logger.warning("count_records tool error: %s", exc)
        return {"error": str(exc)}


def execute_tool_call(tool_name: str, tool_args: dict) -> str:
    """Dispatch a tool call and return JSON string result."""
    if tool_name == "run_report":
        result = _execute_tool_run_report(tool_args)
    elif tool_name == "count_records":
        result = _execute_tool_count_records(tool_args)
    else:
        result = {"error": f"Onbekende tool: {tool_name}"}
    return json.dumps(result, ensure_ascii=False, default=str)


# ---------------------------------------------------------------------------
# AI client helpers
# ---------------------------------------------------------------------------

def _get_ai_client():
    """Build OpenAI-compatible client from AppSettings."""
    from apps.core.models import AppSettings
    try:
        settings_obj = AppSettings.get_settings()
    except Exception:
        settings_obj = None

    if not settings_obj or settings_obj.ai_provider == 'none':
        return None, None, None

    provider = settings_obj.ai_provider
    model = settings_obj.ai_model or 'gpt-4o-mini'

    try:
        from openai import OpenAI, AzureOpenAI

        if provider == 'openai':
            key = settings_obj.ai_openai_api_key
            if not key:
                return None, None, "OpenAI API key niet geconfigureerd."
            client = OpenAI(api_key=key)
            return client, model, None

        elif provider == 'github':
            token = settings_obj.ai_github_token
            if not token:
                return None, None, "GitHub token niet geconfigureerd."
            client = OpenAI(
                api_key=token,
                base_url="https://models.inference.ai.azure.com",
            )
            return client, model, None

        elif provider == 'azure':
            endpoint = settings_obj.ai_azure_endpoint
            key = settings_obj.ai_azure_api_key
            deployment = settings_obj.ai_azure_deployment or model
            if not endpoint or not key:
                return None, None, "Azure OpenAI endpoint/key niet geconfigureerd."
            client = AzureOpenAI(
                azure_endpoint=endpoint,
                api_key=key,
                api_version="2024-02-01",
            )
            return client, deployment, None

    except ImportError:
        return None, None, "OpenAI pakket niet geïnstalleerd (pip install openai)."
    except Exception as exc:
        return None, None, str(exc)

    return None, None, f"Onbekende AI provider: {provider}"


def _friendly_api_error(exc: Exception, provider: str) -> str:
    """Convert API exceptions into user-friendly Dutch error messages."""
    err_str = str(exc)
    # 401 / unauthorized – most common with GitHub Models token issues
    if "401" in err_str or "unauthorized" in err_str.lower():
        if provider == 'github':
            return (
                "GitHub token heeft onvoldoende rechten. "
                "Zorg dat uw GitHub Personal Access Token de 'models' scope (read-only) heeft. "
                "Maak een nieuw token aan via github.com/settings/tokens → "
                "\"Fine-grained tokens\" → voeg de \"Models\" permissie toe."
            )
        return f"Authenticatiefout (401): controleer uw API-sleutel. ({err_str})"
    # 429 rate limit
    if "429" in err_str or "rate limit" in err_str.lower():
        return "Limiet bereikt (429): te veel verzoeken. Probeer het later opnieuw."
    # 404 model not found
    if "404" in err_str or ("model" in err_str.lower() and "not found" in err_str.lower()):
        return f"Model niet gevonden. Controleer de model-naam in de AI-instellingen. ({err_str})"
    return err_str


# ---------------------------------------------------------------------------
# Main chat function
# ---------------------------------------------------------------------------

def chat(messages: list, user=None) -> dict:
    """
    Send messages to the AI and return a response dict with:
      - content: str (the assistant reply)
      - data: dict | None  (structured tool result if any)
      - error: str | None
    """
    client, model, err = _get_ai_client()

    if err:
        return {"content": f"⚠️ AI niet beschikbaar: {err}", "data": None, "error": err}

    if not client:
        return {
            "content": (
                "ℹ️ De AI-assistent is nog niet geconfigureerd. "
                "Ga naar Instellingen → AI om een provider te kiezen."
            ),
            "data": None,
            "error": None,
        }

    # Determine provider for error messages
    try:
        from apps.core.models import AppSettings
        provider = AppSettings.get_settings().ai_provider
    except Exception:
        provider = 'unknown'

    system = SYSTEM_PROMPT.format(today=date.today().isoformat())
    full_messages = [{"role": "system", "content": system}] + messages

    combined_data = None

    try:
        response = client.chat.completions.create(
            model=model,
            messages=full_messages,
            tools=TOOLS,
            tool_choice="auto",
            max_tokens=2048,
            temperature=0.3,
        )

        msg = response.choices[0].message

        # Handle tool calls (agent loop – max 3 rounds to avoid infinite loops)
        rounds = 0
        while msg.tool_calls and rounds < 3:
            rounds += 1
            tool_results = []
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    tool_args = {}

                result_str = execute_tool_call(tool_name, tool_args)
                tool_results.append({
                    "tool_call_id": tc.id,
                    "role": "tool",
                    "content": result_str,
                })

                # Store the first non-error result as structured data
                if combined_data is None:
                    try:
                        parsed = json.loads(result_str)
                        if "error" not in parsed:
                            combined_data = parsed
                    except Exception:
                        pass

            # Append assistant message with tool calls + tool results
            full_messages.append(msg)
            full_messages.extend(tool_results)

            # Ask the model to produce a natural language response
            response = client.chat.completions.create(
                model=model,
                messages=full_messages,
                tools=TOOLS,
                tool_choice="auto",
                max_tokens=2048,
                temperature=0.3,
            )
            msg = response.choices[0].message

        content = msg.content or ""
        return {"content": content, "data": combined_data, "error": None}

    except Exception as exc:
        logger.exception("Chat AI error")
        friendly = _friendly_api_error(exc, provider)
        return {
            "content": f"❌ Er is een fout opgetreden: {friendly}",
            "data": None,
            "error": friendly,
        }

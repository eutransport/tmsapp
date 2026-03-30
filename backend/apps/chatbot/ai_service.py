"""
Chatbot AI service.
Integrates with OpenAI/GitHub Models/Azure OpenAI to power the smart assistant.
Supports tool calls so the assistant can query TMS data.
"""
import json
import logging
import urllib.parse
from datetime import date, datetime
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """Je bent een slimme, vriendelijke AI-assistent voor een Transport Management Systeem (TMS).
Je helpt gebruikers met vragen over:
- Chauffeurs, voertuigen en vloot
- Ritten en urenregistratie
- Verlofaanvragen en saldo's
- Facturen, omzet en totaalbedragen
- Onderhoud en APK
- Planning
- Bankafschriften
- Rapportages

Je kunt data opvragen via tools en de resultaten overzichtelijk presenteren.
Antwoord altijd in het Nederlands, beknopt en behulpzaam.
Als je niet weet hoe je iets moet opzoeken, geef dat dan eerlijk aan.
Vandaag is: {today}. Huidig tijdstip (UTC): {now}.

BELANGRIJK voor data-overzichten:
- Wanneer je een tabel/overzicht toont via een tool, geef ALLEEN een korte inleidende zin terug als tekst. 
  Herhaal de tabeldata NOOIT als platte tekst of Markdown-tabel – de interface toont de tabel automatisch.
- Als de gebruiker vraagt om totaalbedragen van facturen, gebruik dan 'invoice_overview' of 'revenue_summary'.
- Voor vragen over het hoogste factuurbedrag, gebruik 'invoice_overview' en kijk in de Totaal-kolom.

Je kunt ook gewone gespreksvragen beantwoorden:
- Begroetingen en smalltalk ('hoe gaat het', 'goedemorgen', enz.) beantwoord je vriendelijk.
- Vragen over het huidige tijdstip of datum beantwoord je direct op basis van bovenstaande info.
- Voor weersberichten, afstanden en webzoekopdrachten gebruik je de beschikbare tools.
- Je mag ook vragen over het TMS-systeem zelf beantwoorden op basis van je kennis.
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
                "voertuigen, chauffeurs, onderhoud, planning of banktransacties. "
                "Voor factuurtotalen gebruik je 'invoice_overview' (bevat subtotaal, btw en totaal per factuur plus eindtotaal) "
                "of 'revenue_summary' (totalen per bedrijf en status)."
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
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": (
                "Haal de huidige weersomstandigheden of verwachting op voor een locatie. "
                "Gebruik dit voor vragen zoals 'hoe is het weer in Amsterdam' of 'wat is de weersvoorspelling voor Rotterdam'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {
                        "type": "string",
                        "description": "Stad of locatie naam, bijv. 'Amsterdam' of 'Rotterdam, Netherlands'",
                    },
                    "lang": {
                        "type": "string",
                        "description": "Taal voor het antwoord (standaard: 'nl')",
                        "default": "nl",
                    },
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_distance",
            "description": (
                "Bereken de afstand (in km) tussen twee locaties via de weg of hemelsbreed. "
                "Gebruik dit voor vragen zoals 'hoeveel km is het van Amsterdam naar Rotterdam'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "origin": {
                        "type": "string",
                        "description": "Startlocatie, bijv. 'Amsterdam'",
                    },
                    "destination": {
                        "type": "string",
                        "description": "Eindlocatie, bijv. 'Rotterdam'",
                    },
                },
                "required": ["origin", "destination"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": (
                "Zoek op het internet naar actuele informatie. "
                "Gebruik dit voor algemene vragen, nieuws, of informatie die je niet uit het TMS kunt halen."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "De zoekopdracht",
                    },
                    "max_results": {
                        "type": "integer",
                        "description": "Maximum aantal resultaten (standaard: 5)",
                        "default": 5,
                    },
                },
                "required": ["query"],
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


def _execute_tool_get_weather(tool_args: dict) -> dict:
    """Get weather information for a location using wttr.in (free, no API key)."""
    import urllib.request
    location = tool_args.get("location", "")
    lang = tool_args.get("lang", "nl")
    if not location:
        return {"error": "Geen locatie opgegeven."}
    try:
        # wttr.in provides free weather data in JSON format
        encoded_loc = urllib.parse.quote(location)
        url = f"https://wttr.in/{encoded_loc}?format=j1&lang={lang}"
        req = urllib.request.Request(url, headers={"User-Agent": "TMS-Assistant/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())

        current = data.get("current_condition", [{}])[0]
        weather_desc = current.get("lang_nl", [{}])[0].get("value", "") or current.get("weatherDesc", [{}])[0].get("value", "")
        temp_c = current.get("temp_C", "?")
        feels_like = current.get("FeelsLikeC", "?")
        humidity = current.get("humidity", "?")
        wind_kmph = current.get("windspeedKmph", "?")
        wind_dir = current.get("winddir16Point", "?")
        visibility = current.get("visibility", "?")

        # Next days forecast
        weather_data = data.get("weather", [])
        forecast_lines = []
        for day in weather_data[:3]:
            day_date = day.get("date", "")
            max_c = day.get("maxtempC", "?")
            min_c = day.get("mintempC", "?")
            hourly = day.get("hourly", [{}])
            day_desc = ""
            if hourly:
                mid = hourly[len(hourly) // 2]
                descs = mid.get("lang_nl") or mid.get("weatherDesc") or [{}]
                day_desc = descs[0].get("value", "") if descs else ""
            forecast_lines.append(f"{day_date}: {day_desc}, min {min_c}°C / max {max_c}°C")

        return {
            "location": location,
            "current": {
                "description": weather_desc,
                "temperature_c": temp_c,
                "feels_like_c": feels_like,
                "humidity_pct": humidity,
                "wind_kmph": wind_kmph,
                "wind_direction": wind_dir,
                "visibility_km": visibility,
            },
            "forecast": forecast_lines,
        }
    except Exception as exc:
        logger.warning("get_weather tool error: %s", exc)
        return {"error": f"Weer ophalen mislukt: {exc}"}


def _execute_tool_get_distance(tool_args: dict) -> dict:
    """Calculate driving distance between two locations using OSRM (free, no API key)."""
    import urllib.request
    import urllib.parse

    origin = tool_args.get("origin", "")
    destination = tool_args.get("destination", "")
    if not origin or not destination:
        return {"error": "Zowel startlocatie als eindlocatie zijn verplicht."}

    try:
        # First geocode both locations using Nominatim (free OpenStreetMap geocoder)
        def geocode(place: str):
            url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(place)}&format=json&limit=1"
            req = urllib.request.Request(url, headers={"User-Agent": "TMS-Assistant/1.0"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                results = json.loads(resp.read().decode())
            if not results:
                raise ValueError(f"Locatie niet gevonden: {place}")
            return float(results[0]["lon"]), float(results[0]["lat"])

        orig_lon, orig_lat = geocode(origin)
        dest_lon, dest_lat = geocode(destination)

        # Use OSRM to calculate driving distance
        osrm_url = (
            f"https://router.project-osrm.org/route/v1/driving/"
            f"{orig_lon},{orig_lat};{dest_lon},{dest_lat}"
            f"?overview=false"
        )
        req = urllib.request.Request(osrm_url, headers={"User-Agent": "TMS-Assistant/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            route_data = json.loads(resp.read().decode())

        if route_data.get("code") != "Ok":
            raise ValueError("Route niet beschikbaar via OSRM.")

        route = route_data["routes"][0]
        distance_km = round(route["distance"] / 1000, 1)
        duration_min = round(route["duration"] / 60)
        hours, mins = divmod(duration_min, 60)
        duration_str = f"{hours}u {mins}min" if hours else f"{duration_min} min"

        # Also calculate straight-line distance
        import math
        r = 6371
        lat1, lat2 = math.radians(orig_lat), math.radians(dest_lat)
        dlat = math.radians(dest_lat - orig_lat)
        dlon = math.radians(dest_lon - orig_lon)
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        straight_km = round(r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)), 1)

        return {
            "origin": origin,
            "destination": destination,
            "driving_distance_km": distance_km,
            "driving_duration": duration_str,
            "straight_line_km": straight_km,
        }
    except Exception as exc:
        logger.warning("get_distance tool error: %s", exc)
        return {"error": f"Afstand berekenen mislukt: {exc}"}


def _execute_tool_web_search(tool_args: dict) -> dict:
    """Search the web using DuckDuckGo Instant Answer API (free, no API key)."""
    import urllib.request
    import urllib.parse

    query = tool_args.get("query", "")
    max_results = int(tool_args.get("max_results", 5))
    if not query:
        return {"error": "Geen zoekopdracht opgegeven."}

    try:
        # DuckDuckGo Instant Answer API
        url = f"https://api.duckduckgo.com/?q={urllib.parse.quote(query)}&format=json&no_html=1&skip_disambig=1"
        req = urllib.request.Request(url, headers={"User-Agent": "TMS-Assistant/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode())

        results = []

        # Abstract (main summary)
        if data.get("AbstractText"):
            results.append({
                "title": data.get("Heading", query),
                "snippet": data["AbstractText"],
                "url": data.get("AbstractURL", ""),
                "source": data.get("AbstractSource", ""),
            })

        # Related topics
        for topic in data.get("RelatedTopics", [])[:max_results]:
            if isinstance(topic, dict) and topic.get("Text"):
                results.append({
                    "title": topic.get("Text", "")[:80],
                    "snippet": topic.get("Text", ""),
                    "url": topic.get("FirstURL", ""),
                    "source": "DuckDuckGo",
                })
            if len(results) >= max_results:
                break

        if not results:
            # Return search link when no instant results
            search_url = f"https://duckduckgo.com/?q={urllib.parse.quote(query)}"
            return {
                "query": query,
                "results": [],
                "search_url": search_url,
                "message": f"Geen directe resultaten. Bekijk: {search_url}",
            }

        return {
            "query": query,
            "results": results[:max_results],
            "search_url": f"https://duckduckgo.com/?q={urllib.parse.quote(query)}",
        }
    except Exception as exc:
        logger.warning("web_search tool error: %s", exc)
        return {
            "error": f"Zoeken mislukt: {exc}",
            "search_url": f"https://duckduckgo.com/?q={urllib.parse.quote(tool_args.get('query', ''))}",
        }


def execute_tool_call(tool_name: str, tool_args: dict) -> str:
    """Dispatch a tool call and return JSON string result."""
    if tool_name == "run_report":
        result = _execute_tool_run_report(tool_args)
    elif tool_name == "count_records":
        result = _execute_tool_count_records(tool_args)
    elif tool_name == "get_weather":
        result = _execute_tool_get_weather(tool_args)
    elif tool_name == "get_distance":
        result = _execute_tool_get_distance(tool_args)
    elif tool_name == "web_search":
        result = _execute_tool_web_search(tool_args)
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
                "\"Fine-grained tokens\" → voeg de \"Models\" permissie toe. "
                "Voer het nieuwe token daarna in via Instellingen → AI."
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

    system = SYSTEM_PROMPT.format(
        today=date.today().isoformat(),
        now=datetime.utcnow().strftime("%H:%M UTC"),
    )
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

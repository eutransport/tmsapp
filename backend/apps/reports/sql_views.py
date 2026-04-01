"""
SQL Query views for the reports agent.
Provides a safe, read-only SQL query interface for admin users.
Only SELECT statements are allowed — all DML/DDL is blocked.
"""
import io
import csv
import re
import logging
import sqlparse
from datetime import datetime, date
from decimal import Decimal

from django.db import connections
from django.http import HttpResponse
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from apps.core.permissions import IsAdminOnly

logger = logging.getLogger(__name__)

# Maximum rows returned to prevent memory issues
MAX_ROWS = 5000
# Maximum query execution time in seconds
QUERY_TIMEOUT_SECONDS = 30

# ---- Blocked SQL keywords ----
BLOCKED_KEYWORDS = {
    'INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE',
    'GRANT', 'REVOKE', 'EXEC', 'EXECUTE', 'CALL',
    'INTO',  # SELECT INTO
    'COPY',  # Postgres COPY
    'SET',   # SET config
    'VACUUM', 'REINDEX', 'CLUSTER', 'ANALYZE',
    'LOCK', 'COMMENT', 'SECURITY',
    'pg_read_file', 'pg_write_file', 'pg_ls_dir',
    'lo_import', 'lo_export',
}


def _validate_query(sql: str) -> str | None:
    """
    Validate that the SQL is a safe SELECT query.
    Returns an error message if invalid, None if OK.
    """
    if not sql or not sql.strip():
        return "Query is leeg."

    # Parse with sqlparse
    parsed = sqlparse.parse(sql.strip())
    if not parsed:
        return "Ongeldige SQL."

    for statement in parsed:
        # Get the statement type
        stmt_type = statement.get_type()
        if stmt_type and stmt_type.upper() not in ('SELECT', 'UNKNOWN'):
            return f"Alleen SELECT queries zijn toegestaan. Type gevonden: {stmt_type}"

    # Additional safety: check for blocked keywords at word boundaries
    upper_sql = sql.upper()
    for keyword in BLOCKED_KEYWORDS:
        # Use word boundary matching to avoid false positives
        pattern = r'\b' + re.escape(keyword) + r'\b'
        if re.search(pattern, upper_sql):
            return f"Niet toegestane SQL operatie: {keyword}"

    # Block multiple statements (;)
    stripped = sql.strip().rstrip(';')
    if ';' in stripped:
        return "Meerdere statements zijn niet toegestaan."

    return None


def _make_serializable(value):
    """Convert non-JSON-serializable types to safe types."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    if isinstance(value, memoryview):
        return bytes(value).hex()
    return value


@api_view(['GET'])
@permission_classes([IsAdminOnly])
def sql_schema(request):
    """
    Return database schema information: tables, columns, types, and sample queries.
    Used for autocomplete in the frontend SQL editor.
    """
    connection = connections['default']
    schema_data = []

    with connection.cursor() as cursor:
        # Get all user tables (excluding Django internals we don't need to expose)
        cursor.execute("""
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
        """)
        tables = [row[0] for row in cursor.fetchall()]

        for table_name in tables:
            # Get columns with types
            cursor.execute("""
                SELECT column_name, data_type, is_nullable,
                       column_default, character_maximum_length
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = %s
                ORDER BY ordinal_position
            """, [table_name])

            columns = []
            for col_row in cursor.fetchall():
                col_info = {
                    'name': col_row[0],
                    'type': col_row[1],
                    'nullable': col_row[2] == 'YES',
                }
                if col_row[4]:
                    col_info['max_length'] = col_row[4]
                columns.append(col_info)

            # Get foreign keys for this table
            cursor.execute("""
                SELECT
                    kcu.column_name,
                    ccu.table_name AS foreign_table,
                    ccu.column_name AS foreign_column
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                    ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND tc.table_schema = 'public'
                  AND tc.table_name = %s
            """, [table_name])

            foreign_keys = []
            for fk_row in cursor.fetchall():
                foreign_keys.append({
                    'column': fk_row[0],
                    'references_table': fk_row[1],
                    'references_column': fk_row[2],
                })

            # Get row count estimate (fast, via pg stats)
            cursor.execute("""
                SELECT reltuples::bigint
                FROM pg_class
                WHERE relname = %s
            """, [table_name])
            row_count_row = cursor.fetchone()
            row_count = row_count_row[0] if row_count_row else 0

            schema_data.append({
                'table': table_name,
                'columns': columns,
                'foreign_keys': foreign_keys,
                'estimated_rows': max(0, row_count),
            })

    # Generate example queries based on actual tables
    example_queries = _generate_example_queries(schema_data)

    return Response({
        'tables': schema_data,
        'example_queries': example_queries,
    })


def _generate_example_queries(schema_data: list) -> list:
    """Generate helpful example queries based on the actual schema."""
    examples = []
    table_names = {t['table'] for t in schema_data}

    # Basic examples
    if 'accounts_user' in table_names:
        examples.append({
            'label': 'Alle gebruikers',
            'query': "SELECT id, username, voornaam, achternaam, email, rol\nFROM accounts_user\nORDER BY achternaam",
        })

    if 'timetracking_timeentry' in table_names:
        examples.append({
            'label': 'Uren deze maand',
            'query': "SELECT te.datum, u.voornaam, u.achternaam, te.aanvang, te.eind, te.ritnummer, te.kenteken\nFROM timetracking_timeentry te\nJOIN accounts_user u ON te.user_id = u.id\nWHERE te.datum >= date_trunc('month', CURRENT_DATE)\nORDER BY te.datum DESC",
        })

    if 'fleet_vehicle' in table_names:
        examples.append({
            'label': 'Voertuigen overzicht',
            'query': "SELECT v.id, v.kenteken, v.type_wagen, v.ritnummer, c.naam AS bedrijf\nFROM fleet_vehicle v\nLEFT JOIN companies_company c ON v.bedrijf_id = c.id\nORDER BY v.kenteken",
        })

    if 'companies_company' in table_names:
        examples.append({
            'label': 'Bedrijven overzicht',
            'query': "SELECT id, naam, kvk, contactpersoon, email, stad\nFROM companies_company\nORDER BY naam",
        })

    if 'invoicing_invoice' in table_names:
        examples.append({
            'label': 'Facturen dit jaar',
            'query': "SELECT i.factuurnummer, c.naam AS bedrijf, i.totaal, i.status, i.factuurdatum\nFROM invoicing_invoice i\nJOIN companies_company c ON i.bedrijf_id = c.id\nWHERE i.factuurdatum >= date_trunc('year', CURRENT_DATE)\nORDER BY i.factuurdatum DESC",
        })

    if 'leave_leaverequest' in table_names:
        examples.append({
            'label': 'Verlofaanvragen',
            'query': "SELECT lr.id, u.voornaam, u.achternaam, lr.start_date, lr.end_date, lr.status, lr.leave_type\nFROM leave_leaverequest lr\nJOIN accounts_user u ON lr.user_id = u.id\nORDER BY lr.start_date DESC",
        })

    if 'drivers_driver' in table_names:
        examples.append({
            'label': 'Chauffeurs met voertuig',
            'query': "SELECT d.id, d.naam, d.telefoon, v.kenteken, c.naam AS bedrijf\nFROM drivers_driver d\nLEFT JOIN fleet_vehicle v ON d.voertuig_id = v.id\nLEFT JOIN companies_company c ON d.bedrijf_id = c.id\nORDER BY d.naam",
        })

    if 'planning_planningentry' in table_names:
        examples.append({
            'label': 'Planning deze week',
            'query': "SELECT pe.dag, d.naam AS chauffeur, v.kenteken, pe.ritnummer\nFROM planning_planningentry pe\nJOIN planning_weekplanning wp ON pe.planning_id = wp.id\nLEFT JOIN drivers_driver d ON pe.chauffeur_id = d.id\nJOIN fleet_vehicle v ON pe.vehicle_id = v.id\nWHERE wp.weeknummer = EXTRACT(WEEK FROM CURRENT_DATE)\n  AND wp.jaar = EXTRACT(YEAR FROM CURRENT_DATE)\nORDER BY pe.dag",
        })

    if 'maintenance_maintenancetask' in table_names:
        examples.append({
            'label': 'Openstaande onderhoudstaken',
            'query': "SELECT mt.title, mt.status, mt.priority, mt.scheduled_date, v.kenteken\nFROM maintenance_maintenancetask mt\nJOIN fleet_vehicle v ON mt.vehicle_id = v.id\nWHERE mt.status NOT IN ('completed', 'cancelled')\nORDER BY mt.scheduled_date",
        })

    if 'invoicing_expense' in table_names:
        examples.append({
            'label': 'Kosten per categorie',
            'query': "SELECT categorie, COUNT(*) AS aantal, SUM(totaal) AS totaal_bedrag\nFROM invoicing_expense\nWHERE datum >= date_trunc('year', CURRENT_DATE)\nGROUP BY categorie\nORDER BY totaal_bedrag DESC",
        })

    # Always add a generic count example
    examples.append({
        'label': 'Alle tabellen met aantal rijen',
        'query': "SELECT schemaname, relname AS tabel, n_live_tup AS rijen\nFROM pg_stat_user_tables\nORDER BY n_live_tup DESC",
    })

    return examples


@api_view(['POST'])
@permission_classes([IsAdminOnly])
def sql_execute(request):
    """
    Execute a read-only SQL query and return the results.
    Only SELECT queries are allowed. Results are limited to MAX_ROWS.
    """
    sql = request.data.get('query', '').strip()
    limit = min(int(request.data.get('limit', MAX_ROWS)), MAX_ROWS)

    # Validate query
    error = _validate_query(sql)
    if error:
        return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

    connection = connections['default']

    try:
        with connection.cursor() as cursor:
            # Set statement timeout (PostgreSQL)
            cursor.execute(
                "SET LOCAL statement_timeout = %s",
                [QUERY_TIMEOUT_SECONDS * 1000]
            )
            # Force read-only transaction
            cursor.execute("SET LOCAL default_transaction_read_only = ON")

            # Execute the query
            cursor.execute(sql)

            # Get column names
            columns = [desc[0] for desc in cursor.description] if cursor.description else []

            # Fetch rows (limited)
            rows = cursor.fetchmany(limit)
            has_more = bool(cursor.fetchone())  # Check if there's more

            # Convert to JSON-safe values
            serialized_rows = [
                [_make_serializable(cell) for cell in row]
                for row in rows
            ]

        return Response({
            'columns': columns,
            'rows': serialized_rows,
            'row_count': len(serialized_rows),
            'has_more': has_more,
            'limit': limit,
        })

    except Exception as exc:
        logger.warning("SQL query execution failed: %s", exc)
        error_msg = str(exc)
        # Clean up Postgres error messages for readability
        if 'canceling statement due to statement timeout' in error_msg:
            error_msg = f"Query timeout: de query duurde langer dan {QUERY_TIMEOUT_SECONDS} seconden."
        return Response(
            {'error': f'Query fout: {error_msg}'},
            status=status.HTTP_400_BAD_REQUEST,
        )


@api_view(['POST'])
@permission_classes([IsAdminOnly])
def sql_export(request):
    """
    Execute a read-only SQL query and return results as CSV download.
    """
    sql = request.data.get('query', '').strip()

    # Validate query
    error = _validate_query(sql)
    if error:
        return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)

    connection = connections['default']

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SET LOCAL statement_timeout = %s",
                [QUERY_TIMEOUT_SECONDS * 1000]
            )
            cursor.execute("SET LOCAL default_transaction_read_only = ON")
            cursor.execute(sql)

            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = cursor.fetchall()

        # Build CSV
        output = io.StringIO()
        writer = csv.writer(output, delimiter=';', quoting=csv.QUOTE_MINIMAL)
        writer.writerow(columns)
        for row in rows:
            writer.writerow([_make_serializable(cell) for cell in row])

        response = HttpResponse(
            output.getvalue(),
            content_type='text/csv; charset=utf-8',
        )
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        response['Content-Disposition'] = f'attachment; filename="query_export_{timestamp}.csv"'
        return response

    except Exception as exc:
        logger.warning("SQL export failed: %s", exc)
        return Response(
            {'error': f'Export fout: {exc}'},
            status=status.HTTP_400_BAD_REQUEST,
        )

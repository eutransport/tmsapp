"""
Report generator service.
Executes queries and generates data, Excel, and PDF reports.
"""
import io
import logging
from datetime import datetime, date
from decimal import Decimal

from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_duration(td):
    """Convert timedelta to HH:MM string."""
    if td is None:
        return ''
    total_seconds = int(td.total_seconds())
    hours, remainder = divmod(abs(total_seconds), 3600)
    minutes = remainder // 60
    return f"{hours:02d}:{minutes:02d}"


def _safe_str(value):
    if value is None:
        return ''
    return str(value)


# ---------------------------------------------------------------------------
# Query executors – return (columns, rows, title)
# ---------------------------------------------------------------------------

def _execute_leave_overview_user(params):
    """Verlof overzicht voor een specifieke gebruiker dit jaar."""
    from apps.leave.models import LeaveRequest, LeaveRequestStatus

    user_id = params.get('user_id')
    year = int(params.get('year', date.today().year))

    qs = LeaveRequest.objects.select_related('user', 'reviewed_by').filter(
        start_date__year=year,
    )
    if user_id:
        qs = qs.filter(user_id=user_id)

    columns = [
        'Medewerker', 'Type verlof', 'Startdatum', 'Einddatum',
        'Uren aangevraagd', 'Status', 'Opmerking', 'Beoordeeld door', 'Beoordeeld op',
    ]
    rows = []
    for req in qs.order_by('user__achternaam', 'start_date'):
        rows.append([
            req.user.get_full_name() if hasattr(req.user, 'get_full_name') else str(req.user),
            req.get_leave_type_display(),
            str(req.start_date),
            str(req.end_date),
            str(req.hours_requested),
            req.get_status_display(),
            req.reason or '',
            (req.reviewed_by.get_full_name() if req.reviewed_by and hasattr(req.reviewed_by, 'get_full_name') else _safe_str(req.reviewed_by)),
            str(req.reviewed_at.date()) if req.reviewed_at else '',
        ])
    title = f"Verlof overzicht {year}"
    return columns, rows, title


def _execute_leave_balance_overview(params):
    """Verlof saldo overzicht voor alle medewerkers."""
    from apps.leave.models import LeaveBalance

    qs = LeaveBalance.objects.select_related('user').all()
    columns = [
        'Medewerker', 'E-mail', 'Verlofuren', 'Overuren',
        'Beschikbare overuren als verlof',
    ]
    rows = []
    for bal in qs.order_by('user__achternaam'):
        rows.append([
            bal.user.get_full_name() if hasattr(bal.user, 'get_full_name') else str(bal.user),
            bal.user.email,
            str(bal.vacation_hours),
            str(bal.overtime_hours),
            str(bal.available_overtime_for_leave),
        ])
    return columns, rows, 'Verlof saldo overzicht'


def _execute_leave_requests_overview(params):
    """Alle verlofaanvragen met optionele status filter."""
    from apps.leave.models import LeaveRequest

    status_filter = params.get('status')
    year = params.get('year')

    qs = LeaveRequest.objects.select_related('user', 'reviewed_by').all()
    if status_filter:
        qs = qs.filter(status=status_filter)
    if year:
        qs = qs.filter(start_date__year=int(year))

    columns = [
        'Medewerker', 'Type', 'Startdatum', 'Einddatum', 'Uren', 'Status', 'Reden',
    ]
    rows = []
    for req in qs.order_by('-start_date'):
        rows.append([
            req.user.get_full_name() if hasattr(req.user, 'get_full_name') else str(req.user),
            req.get_leave_type_display(),
            str(req.start_date),
            str(req.end_date),
            str(req.hours_requested),
            req.get_status_display(),
            req.reason or '',
        ])
    return columns, rows, 'Verlofaanvragen overzicht'


def _execute_trips_by_user(params):
    """Alle ritten van een specifieke gebruiker."""
    from apps.timetracking.models import TimeEntry

    user_id = params.get('user_id')
    year = params.get('year')
    date_from = params.get('date_from')
    date_to = params.get('date_to')

    qs = TimeEntry.objects.select_related('user').all()
    if user_id:
        qs = qs.filter(user_id=user_id)
    if year:
        qs = qs.filter(datum__year=int(year))
    if date_from:
        qs = qs.filter(datum__gte=date_from)
    if date_to:
        qs = qs.filter(datum__lte=date_to)

    columns = [
        'Medewerker', 'Datum', 'Weeknummer', 'Ritnummer', 'Kenteken',
        'KM Start', 'KM Eind', 'Totaal KM', 'Aanvang', 'Eind', 'Pauze', 'Totaal Uren', 'Status',
    ]
    rows = []
    for entry in qs.order_by('user__achternaam', '-datum'):
        rows.append([
            entry.user.get_full_name() if hasattr(entry.user, 'get_full_name') else str(entry.user),
            str(entry.datum),
            entry.weeknummer,
            entry.ritnummer,
            entry.kenteken,
            entry.km_start,
            entry.km_eind,
            entry.totaal_km,
            str(entry.aanvang),
            str(entry.eind),
            _format_duration(entry.pauze),
            _format_duration(entry.totaal_uren),
            entry.get_status_display(),
        ])
    return columns, rows, 'Ritten per gebruiker'


def _execute_trips_by_vehicle(params):
    """Alle ritten van een voertuig (via ritnummer of kenteken)."""
    from apps.timetracking.models import TimeEntry

    ritnummer = params.get('ritnummer')
    kenteken = params.get('kenteken')
    year = params.get('year')
    date_from = params.get('date_from')
    date_to = params.get('date_to')

    qs = TimeEntry.objects.select_related('user').all()
    if ritnummer:
        qs = qs.filter(ritnummer=ritnummer)
    if kenteken:
        qs = qs.filter(kenteken__icontains=kenteken)
    if year:
        qs = qs.filter(datum__year=int(year))
    if date_from:
        qs = qs.filter(datum__gte=date_from)
    if date_to:
        qs = qs.filter(datum__lte=date_to)

    columns = [
        'Medewerker', 'Datum', 'Weeknummer', 'Ritnummer', 'Kenteken',
        'KM Start', 'KM Eind', 'Totaal KM', 'Aanvang', 'Eind', 'Pauze', 'Totaal Uren', 'Status',
    ]
    rows = []
    for entry in qs.order_by('-datum'):
        rows.append([
            entry.user.get_full_name() if hasattr(entry.user, 'get_full_name') else str(entry.user),
            str(entry.datum),
            entry.weeknummer,
            entry.ritnummer,
            entry.kenteken,
            entry.km_start,
            entry.km_eind,
            entry.totaal_km,
            str(entry.aanvang),
            str(entry.eind),
            _format_duration(entry.pauze),
            _format_duration(entry.totaal_uren),
            entry.get_status_display(),
        ])
    label = ritnummer or kenteken or 'Voertuig'
    return columns, rows, f'Ritten van {label}'


def _execute_time_entries_summary(params):
    """Urenregistratie samenvatting per medewerker."""
    from apps.timetracking.models import TimeEntry
    from django.db.models import Sum, Count

    year = int(params.get('year', date.today().year))

    qs = (
        TimeEntry.objects
        .filter(datum__year=year)
        .values('user__id', 'user__voornaam', 'user__achternaam', 'user__email')
        .annotate(
            totaal_ritten=Count('id'),
            totaal_km_sum=Sum('totaal_km'),
        )
        .order_by('user__achternaam')
    )

    columns = ['Medewerker', 'E-mail', 'Totaal ritten', 'Totaal KM']
    rows = []
    for row in qs:
        naam = f"{row['user__voornaam'] or ''} {row['user__achternaam'] or ''}".strip()
        rows.append([
            naam,
            row['user__email'],
            row['totaal_ritten'],
            row['totaal_km_sum'] or 0,
        ])
    return columns, rows, f'Urenregistratie samenvatting {year}'


def _execute_time_entries_by_user(params):
    """Gedetailleerde urenregistraties per gebruiker (zelfde als trips_by_user)."""
    return _execute_trips_by_user(params)


def _execute_time_entries_by_week(params):
    """Urenregistraties gegroepeerd per week."""
    from apps.timetracking.models import TimeEntry
    from django.db.models import Sum, Count

    user_id = params.get('user_id')
    year = int(params.get('year', date.today().year))

    qs = TimeEntry.objects.filter(datum__year=year)
    if user_id:
        qs = qs.filter(user_id=user_id)

    qs = (
        qs.values('weeknummer', 'user__voornaam', 'user__achternaam')
        .annotate(totaal_ritten=Count('id'), totaal_km_sum=Sum('totaal_km'))
        .order_by('weeknummer', 'user__achternaam')
    )

    columns = ['Week', 'Medewerker', 'Totaal ritten', 'Totaal KM']
    rows = []
    for row in qs:
        naam = f"{row['user__voornaam'] or ''} {row['user__achternaam'] or ''}".strip()
        rows.append([row['weeknummer'], naam, row['totaal_ritten'], row['totaal_km_sum'] or 0])
    return columns, rows, f'Urenregistraties per week {year}'


def _execute_weekly_hours_summary(params):
    """Wekelijkse uren samenvatting."""
    return _execute_time_entries_by_week(params)


def _execute_vehicle_overview(params):
    """Overzicht van alle voertuigen."""
    from apps.fleet.models import Vehicle

    qs = Vehicle.objects.select_related('bedrijf').all()
    actief = params.get('actief')
    if actief is not None:
        qs = qs.filter(actief=bool(actief))

    columns = ['Kenteken', 'Type', 'Ritnummer', 'Bedrijf', 'Min. weken/jaar', 'Actief']
    rows = []
    for v in qs.order_by('kenteken'):
        rows.append([
            v.kenteken,
            v.type_wagen,
            v.ritnummer or '',
            v.bedrijf.naam if v.bedrijf else '',
            v.minimum_weken_per_jaar,
            'Ja' if v.actief else 'Nee',
        ])
    return columns, rows, 'Voertuigen overzicht'


def _execute_vehicle_maintenance(params):
    """Onderhoud overzicht per voertuig."""
    from apps.maintenance.models import MaintenanceTask

    kenteken = params.get('kenteken')
    qs = MaintenanceTask.objects.select_related('vehicle', 'maintenance_type', 'maintenance_type__category').all()
    if kenteken:
        qs = qs.filter(vehicle__kenteken__icontains=kenteken)

    columns = ['Kenteken', 'Type onderhoud', 'Categorie', 'Status', 'Gepland', 'Voltooid', 'KM bij voltooiing', 'Opmerkingen']
    rows = []
    for task in qs.order_by('vehicle__kenteken', '-planned_date'):
        rows.append([
            task.vehicle.kenteken if task.vehicle else '',
            task.maintenance_type.name if task.maintenance_type else '',
            task.maintenance_type.category.name if task.maintenance_type and task.maintenance_type.category else '',
            task.get_status_display() if hasattr(task, 'get_status_display') else str(task.status),
            str(task.planned_date) if task.planned_date else '',
            str(task.completed_date) if hasattr(task, 'completed_date') and task.completed_date else '',
            task.completed_km if hasattr(task, 'completed_km') and task.completed_km else '',
            task.notes if hasattr(task, 'notes') else '',
        ])
    return columns, rows, 'Onderhoud per voertuig'


def _execute_driver_overview(params):
    """Overzicht van alle chauffeurs."""
    from apps.drivers.models import Driver

    qs = Driver.objects.select_related('gekoppelde_gebruiker', 'voertuig').all()
    actief = params.get('actief')
    if actief is not None:
        qs = qs.filter(actief=bool(actief))

    columns = ['Naam', 'Telefoon', 'Voertuig', 'ADR', 'Min. uren/week', 'Actief', 'Gekoppelde gebruiker']
    rows = []
    for d in qs.order_by('naam'):
        rows.append([
            d.naam,
            d.telefoon or '',
            d.voertuig.kenteken if d.voertuig else '',
            'Ja' if d.adr else 'Nee',
            d.minimum_uren_per_week,
            'Ja' if d.actief else 'Nee',
            d.gekoppelde_gebruiker.email if d.gekoppelde_gebruiker else '',
        ])
    return columns, rows, 'Chauffeurs overzicht'


def _execute_driver_activity(params):
    """Activiteit per chauffeur (ritten en uren)."""
    from apps.timetracking.models import TimeEntry
    from django.db.models import Sum, Count

    user_id = params.get('user_id')
    year = int(params.get('year', date.today().year))

    qs = TimeEntry.objects.filter(datum__year=year)
    if user_id:
        qs = qs.filter(user_id=user_id)

    entries = qs.select_related('user').order_by('user__achternaam', '-datum')

    columns = ['Medewerker', 'Datum', 'Ritnummer', 'Kenteken', 'KM', 'Totaal Uren']
    rows = []
    for e in entries:
        rows.append([
            e.user.get_full_name() if hasattr(e.user, 'get_full_name') else str(e.user),
            str(e.datum),
            e.ritnummer,
            e.kenteken,
            e.totaal_km,
            _format_duration(e.totaal_uren),
        ])
    return columns, rows, f'Chauffeur activiteit {year}'


def _execute_invoice_overview(params):
    """Facturen overzicht."""
    from apps.invoicing.models import Invoice

    year = params.get('year')
    status_filter = params.get('status')
    bedrijf_id = params.get('bedrijf_id')

    qs = Invoice.objects.select_related('bedrijf', 'template').all()
    if year:
        qs = qs.filter(created_at__year=int(year))
    if status_filter:
        qs = qs.filter(status=status_filter)
    if bedrijf_id:
        qs = qs.filter(bedrijf_id=bedrijf_id)

    columns = ['Factuurnummer', 'Bedrijf', 'Type', 'Status', 'Datum', 'Totaal']
    rows = []
    for inv in qs.order_by('-created_at'):
        rows.append([
            inv.factuurnummer or '',
            inv.bedrijf.naam if inv.bedrijf else '',
            inv.get_type_display() if hasattr(inv, 'get_type_display') else str(inv.type),
            inv.get_status_display() if hasattr(inv, 'get_status_display') else str(inv.status),
            str(inv.created_at.date()),
            '',
        ])
    return columns, rows, 'Facturen overzicht'


def _execute_invoice_by_company(params):
    """Facturen per bedrijf."""
    return _execute_invoice_overview(params)


def _execute_revenue_summary(params):
    """Omzet samenvatting."""
    from apps.invoicing.models import Invoice

    year = int(params.get('year', date.today().year))
    qs = Invoice.objects.select_related('bedrijf').filter(created_at__year=year)

    columns = ['Bedrijf', 'Aantal facturen', 'Status']
    rows = []
    from django.db.models import Count
    summary = (
        qs.values('bedrijf__naam', 'status')
        .annotate(count=Count('id'))
        .order_by('bedrijf__naam')
    )
    for s in summary:
        rows.append([
            s['bedrijf__naam'] or 'Onbekend',
            s['count'],
            s['status'],
        ])
    return columns, rows, f'Omzet samenvatting {year}'


def _execute_company_overview(params):
    """Bedrijven overzicht."""
    from apps.companies.models import Company

    qs = Company.objects.all()

    columns = ['Naam', 'KVK', 'Telefoon', 'Contactpersoon', 'E-mail', 'Stad']
    rows = []
    for c in qs.order_by('naam'):
        rows.append([
            c.naam,
            c.kvk or '',
            c.telefoon or '',
            c.contactpersoon or '',
            c.email or '',
            c.stad or '',
        ])
    return columns, rows, 'Bedrijven overzicht'


def _execute_maintenance_overview(params):
    """Onderhoud overzicht."""
    from apps.maintenance.models import MaintenanceTask

    qs = MaintenanceTask.objects.select_related('vehicle', 'maintenance_type', 'maintenance_type__category').all()
    status_filter = params.get('status')
    if status_filter:
        qs = qs.filter(status=status_filter)

    columns = ['Kenteken', 'Type', 'Categorie', 'Status', 'Gepland']
    rows = []
    for task in qs.order_by('planned_date'):
        rows.append([
            task.vehicle.kenteken if task.vehicle else '',
            task.maintenance_type.name if task.maintenance_type else '',
            task.maintenance_type.category.name if task.maintenance_type and task.maintenance_type.category else '',
            task.get_status_display() if hasattr(task, 'get_status_display') else str(task.status),
            str(task.planned_date) if task.planned_date else '',
        ])
    return columns, rows, 'Onderhoud overzicht'


def _execute_apk_overview(params):
    """APK overzicht."""
    from apps.maintenance.models import APKRecord

    qs = APKRecord.objects.select_related('vehicle').all()
    columns = ['Kenteken', 'APK datum', 'Vervaldatum', 'Status']
    rows = []
    for rec in qs.order_by('vehicle__kenteken'):
        rows.append([
            rec.vehicle.kenteken if rec.vehicle else '',
            str(rec.apk_date) if hasattr(rec, 'apk_date') and rec.apk_date else '',
            str(rec.expiry_date) if hasattr(rec, 'expiry_date') and rec.expiry_date else '',
            rec.get_status_display() if hasattr(rec, 'get_status_display') else '',
        ])
    return columns, rows, 'APK overzicht'


def _execute_planning_overview(params):
    """Planning overzicht."""
    from apps.planning.models import PlanningEntry

    date_from = params.get('date_from')
    date_to = params.get('date_to')
    user_id = params.get('user_id')

    qs = PlanningEntry.objects.select_related('user', 'vehicle').all()
    if user_id:
        qs = qs.filter(user_id=user_id)
    if date_from:
        qs = qs.filter(datum__gte=date_from)
    if date_to:
        qs = qs.filter(datum__lte=date_to)

    columns = ['Datum', 'Medewerker', 'Voertuig', 'Ritnummer', 'Opmerkingen']
    rows = []
    for entry in qs.order_by('datum'):
        rows.append([
            str(entry.datum),
            entry.user.get_full_name() if hasattr(entry.user, 'get_full_name') else str(entry.user),
            entry.vehicle.kenteken if entry.vehicle else '',
            entry.ritnummer if hasattr(entry, 'ritnummer') else '',
            entry.opmerkingen if hasattr(entry, 'opmerkingen') else '',
        ])
    return columns, rows, 'Planning overzicht'


def _execute_banking_transactions(params):
    """Bank transacties overzicht."""
    from apps.banking.models import BankTransaction

    date_from = params.get('date_from')
    date_to = params.get('date_to')
    match_status = params.get('match_status')

    qs = BankTransaction.objects.select_related('gekoppelde_factuur').all()
    if date_from:
        qs = qs.filter(datum__gte=date_from)
    if date_to:
        qs = qs.filter(datum__lte=date_to)
    if match_status:
        qs = qs.filter(match_status=match_status)

    columns = ['Datum', 'Bedrag', 'Tegenpartij', 'Omschrijving', 'Match status', 'Factuur']
    rows = []
    for txn in qs.order_by('-datum'):
        rows.append([
            str(txn.datum),
            str(txn.bedrag),
            txn.naam_tegenpartij or '',
            txn.omschrijving or '',
            txn.get_match_status_display() if hasattr(txn, 'get_match_status_display') else str(txn.match_status),
            txn.gekoppelde_factuur.factuurnummer if txn.gekoppelde_factuur else '',
        ])
    return columns, rows, 'Bank transacties'


def _execute_spreadsheet_overview(params):
    """Ritregistratie overzicht."""
    from apps.spreadsheets.models import Spreadsheet

    year = params.get('year')
    bedrijf_id = params.get('bedrijf_id')

    qs = Spreadsheet.objects.select_related('bedrijf', 'template').all()
    if year:
        qs = qs.filter(jaar=int(year))
    if bedrijf_id:
        qs = qs.filter(bedrijf_id=bedrijf_id)

    columns = ['Naam', 'Bedrijf', 'Week', 'Jaar', 'Tarief/uur', 'Tarief/km', 'Totaal', 'Status']
    rows = []
    for s in qs.order_by('-jaar', '-week_nummer'):
        rows.append([
            s.naam,
            s.bedrijf.naam if s.bedrijf else '',
            s.week_nummer,
            s.jaar,
            str(s.tarief_per_uur),
            str(s.tarief_per_km),
            str(s.totaal_factuur),
            s.get_status_display() if hasattr(s, 'get_status_display') else str(s.status),
        ])
    return columns, rows, 'Ritregistratie overzicht'


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

EXECUTOR_MAP = {
    'leave_overview_user': _execute_leave_overview_user,
    'leave_balance_overview': _execute_leave_balance_overview,
    'leave_requests_overview': _execute_leave_requests_overview,
    'trips_by_user': _execute_trips_by_user,
    'trips_by_vehicle': _execute_trips_by_vehicle,
    'time_entries_summary': _execute_time_entries_summary,
    'time_entries_by_user': _execute_time_entries_by_user,
    'time_entries_by_week': _execute_time_entries_by_week,
    'weekly_hours_summary': _execute_weekly_hours_summary,
    'vehicle_overview': _execute_vehicle_overview,
    'vehicle_maintenance': _execute_vehicle_maintenance,
    'driver_overview': _execute_driver_overview,
    'driver_activity': _execute_driver_activity,
    'invoice_overview': _execute_invoice_overview,
    'invoice_by_company': _execute_invoice_by_company,
    'revenue_summary': _execute_revenue_summary,
    'company_overview': _execute_company_overview,
    'maintenance_overview': _execute_maintenance_overview,
    'apk_overview': _execute_apk_overview,
    'planning_overview': _execute_planning_overview,
    'banking_transactions': _execute_banking_transactions,
    'spreadsheet_overview': _execute_spreadsheet_overview,
}


def execute_report(report_type: str, parameters: dict):
    """
    Execute a report query and return (columns, rows, title).
    Raises ValueError if report_type is unknown.
    """
    executor = EXECUTOR_MAP.get(report_type)
    if not executor:
        raise ValueError(f"Onbekend rapport type: {report_type}")
    return executor(parameters)

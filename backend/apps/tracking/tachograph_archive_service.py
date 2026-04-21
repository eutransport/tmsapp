from datetime import datetime, timedelta

from django.db import transaction
from django.utils.dateparse import parse_date

from apps.drivers.models import Driver
from apps.tracking.models import TachographArchiveEntry
from apps.tracking.tachograph_service import get_tachograph_overview


def enrich_with_driver_overtime(vehicles, date_str):
    """
    Apply driver-specific overtime logic to vehicle rows.
    """
    from zoneinfo import ZoneInfo

    nl_tz = ZoneInfo('Europe/Amsterdam')
    target_date = parse_date(date_str)

    plate_lookup = {}
    for driver in Driver.objects.filter(auto_uren=True).exclude(tacho_kenteken=''):
        normalized = driver.tacho_kenteken.upper().replace('-', '').replace(' ', '')
        plate_lookup[normalized] = driver

    for vehicle in vehicles:
        plate = vehicle.get('plate_number', '')
        normalized_plate = plate.upper().replace('-', '').replace(' ', '')
        driver = plate_lookup.get(normalized_plate)

        if not driver:
            vehicle['overtime_calculation'] = None
            continue

        last_end_str = vehicle.get('last_end')
        if not last_end_str:
            vehicle['overtime_calculation'] = None
            continue

        try:
            tacho_end = datetime.fromisoformat(
                last_end_str.replace('Z', '+00:00')
            ).astimezone(nl_tz).time()
            tacho_start_str = vehicle.get('first_start', '')
            tacho_start = datetime.fromisoformat(
                tacho_start_str.replace('Z', '+00:00')
            ).astimezone(nl_tz).time() if tacho_start_str else None
        except (ValueError, AttributeError):
            vehicle['overtime_calculation'] = None
            continue

        start_time = driver.standaard_begintijd or tacho_start
        if not start_time:
            vehicle['overtime_calculation'] = None
            continue

        end_time = tacho_end
        pauze_minutes = driver.standaard_pauze or 30
        uren_per_dag = float(driver.uren_per_dag) if driver.uren_per_dag is not None else 8.0

        start_dt = datetime.combine(target_date, start_time) if target_date else datetime.combine(datetime.today().date(), start_time)
        end_dt = datetime.combine(target_date, end_time) if target_date else datetime.combine(datetime.today().date(), end_time)
        if end_dt < start_dt:
            end_dt += timedelta(days=1)

        total_work_seconds = (end_dt - start_dt).total_seconds()
        total_work_hours = total_work_seconds / 3600
        pauze_hours = pauze_minutes / 60
        netto_hours = total_work_hours - pauze_hours
        overtime = max(0, round(netto_hours - uren_per_dag, 2))

        vehicle['overtime_hours'] = overtime
        vehicle['has_overtime'] = overtime > 0

        def _fmt(hours):
            hrs = int(hours)
            mins = int(round((hours - hrs) * 60))
            if mins == 60:
                hrs += 1
                mins = 0
            return f'{hrs:02d}:{mins:02d}'

        vehicle['overtime_display'] = _fmt(overtime) if overtime > 0 else None
        vehicle['overtime_calculation'] = {
            'driver_name': driver.naam,
            'start_time': start_time.strftime('%H:%M'),
            'end_time': end_time.strftime('%H:%M'),
            'total_work_hours': round(total_work_hours, 2),
            'total_work_display': _fmt(total_work_hours),
            'pauze_minutes': pauze_minutes,
            'pauze_display': _fmt(pauze_hours),
            'netto_hours': round(netto_hours, 2),
            'netto_display': _fmt(netto_hours),
            'uren_per_dag': uren_per_dag,
            'uren_per_dag_display': _fmt(uren_per_dag),
            'overtime_hours': overtime,
            'overtime_display': _fmt(overtime) if overtime > 0 else '00:00',
            'formula': f"{_fmt(netto_hours)} - {_fmt(uren_per_dag)} = {_fmt(overtime)} overuren",
        }


def fetch_live_tachograph_data(date_str):
    vehicles = get_tachograph_overview(date_str)
    enrich_with_driver_overtime(vehicles, date_str)
    return vehicles


def upsert_tachograph_archive_for_date(date_str):
    target_date = parse_date(date_str)
    if not target_date:
        raise ValueError('Ongeldig datumformaat. Gebruik YYYY-MM-DD.')

    vehicles = fetch_live_tachograph_data(date_str)

    to_create = []
    for vehicle in vehicles:
        to_create.append(TachographArchiveEntry(
            date=target_date,
            object_id=vehicle.get('object_id', ''),
            vehicle_name=vehicle.get('vehicle_name', ''),
            vehicle_make=vehicle.get('vehicle_make', ''),
            vehicle_model=vehicle.get('vehicle_model', ''),
            plate_number=vehicle.get('plate_number', ''),
            first_start=vehicle.get('first_start') or None,
            last_end=vehicle.get('last_end') or None,
            first_km=vehicle.get('first_km') or 0,
            last_km=vehicle.get('last_km') or 0,
            total_km=vehicle.get('total_km') or 0,
            total_duration_seconds=vehicle.get('total_duration_seconds') or 0,
            total_hours=vehicle.get('total_hours') or 0,
            total_hours_display=vehicle.get('total_hours_display') or '',
            overtime_hours=vehicle.get('overtime_hours') or 0,
            overtime_display=vehicle.get('overtime_display'),
            has_overtime=vehicle.get('has_overtime') or False,
            overtime_calculation=vehicle.get('overtime_calculation'),
            drivers=vehicle.get('drivers') or [],
            trips=vehicle.get('trips') or [],
            trip_count=vehicle.get('trip_count') or 0,
        ))

    with transaction.atomic():
        deleted_count, _ = TachographArchiveEntry.objects.filter(date=target_date).delete()
        if to_create:
            TachographArchiveEntry.objects.bulk_create(to_create)

    return {
        'date': target_date.isoformat(),
        'deleted_count': deleted_count,
        'created_count': len(to_create),
    }


def get_tachograph_archive(date_str=None, date_from=None, date_till=None):
    qs = TachographArchiveEntry.objects.all().order_by('vehicle_name')

    if date_str:
        qs = qs.filter(date=date_str)
    if date_from:
        qs = qs.filter(date__gte=date_from)
    if date_till:
        qs = qs.filter(date__lte=date_till)

    rows = []
    for item in qs:
        rows.append({
            'object_id': item.object_id,
            'vehicle_name': item.vehicle_name,
            'vehicle_make': item.vehicle_make,
            'vehicle_model': item.vehicle_model,
            'plate_number': item.plate_number,
            'first_start': item.first_start.isoformat() if item.first_start else None,
            'last_end': item.last_end.isoformat() if item.last_end else None,
            'first_km': item.first_km,
            'last_km': item.last_km,
            'total_km': item.total_km,
            'total_duration_seconds': item.total_duration_seconds,
            'total_hours': item.total_hours,
            'total_hours_display': item.total_hours_display,
            'overtime_hours': item.overtime_hours,
            'overtime_display': item.overtime_display,
            'has_overtime': item.has_overtime,
            'overtime_calculation': item.overtime_calculation,
            'drivers': item.drivers or [],
            'trips': item.trips or [],
            'trip_count': item.trip_count,
        })

    return rows

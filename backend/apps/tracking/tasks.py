"""
Celery tasks for tachograph data synchronization.

Automatically syncs FM-Track tachograph data and creates TimeEntry records
for matched drivers.
"""
import logging
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from celery import shared_task

NL_TZ = ZoneInfo('Europe/Amsterdam')

logger = logging.getLogger(__name__)


@shared_task
def sync_tachograph_hours():
    """
    Sync tachograph data from FM-Track and auto-create TimeEntry records.

    Process:
    1. Check tachograaf_start_datum in AppSettings
    2. Find unprocessed dates from start_datum to yesterday
    3. For each date, fetch tachograph overview
    4. Match FM-Track drivers to TMS drivers by name
    5. Create TimeEntry records with auto-filled data
    6. Calculate and record overtime
    """
    from apps.core.models import AppSettings
    from apps.drivers.models import Driver
    from apps.timetracking.models import TimeEntry
    from apps.tracking.models import TachographOvertime, TachographSyncLog
    from apps.tracking.tachograph_service import get_tachograph_overview, FMTrackError

    settings = AppSettings.get_settings()
    start_datum = settings.tachograaf_start_datum
    api_key = getattr(settings, 'linqo_api_key', '')

    if not start_datum:
        logger.info('Tachograaf sync: geen startdatum geconfigureerd, overslaan.')
        return {'status': 'skipped', 'reason': 'no_start_date'}

    if not api_key:
        logger.info('Tachograaf sync: geen API key geconfigureerd, overslaan.')
        return {'status': 'skipped', 'reason': 'no_api_key'}

    yesterday = date.today() - timedelta(days=1)

    # FM-Track only allows fetching data from the last 29 days
    MAX_HISTORY = 29
    earliest_allowed = date.today() - timedelta(days=MAX_HISTORY)
    effective_start = max(start_datum, earliest_allowed)

    # Find dates that haven't been synced yet
    synced_dates = set(
        TachographSyncLog.objects.filter(
            date__gte=start_datum,
            date__lte=yesterday,
        ).values_list('date', flat=True)
    )

    # Mark dates before the FM-Track window as synced (data unavailable)
    dates_too_old = []
    current = start_datum
    while current < effective_start:
        if current not in synced_dates:
            dates_too_old.append(current)
        current += timedelta(days=1)

    if dates_too_old:
        logs_to_create = [
            TachographSyncLog(
                date=d,
                errors='Datum ouder dan 30 dagen - FM-Track data niet meer beschikbaar',
            )
            for d in dates_too_old
        ]
        TachographSyncLog.objects.bulk_create(logs_to_create)
        logger.info(
            'Tachograaf sync: %d datums overgeslagen (ouder dan 30 dagen)',
            len(dates_too_old),
        )

    dates_to_process = []
    current = effective_start
    while current <= yesterday:
        if current not in synced_dates:
            dates_to_process.append(current)
        current += timedelta(days=1)

    if not dates_to_process:
        logger.info('Tachograaf sync: alle datums al verwerkt.')
        return {'status': 'up_to_date', 'dates_processed': 0}

    # Build driver name lookup: FM-Track name -> TMS Driver
    driver_lookup = _build_driver_lookup()

    # Build plate->driver lookup for drivers with auto_uren + tacho_kenteken
    plate_lookup = _build_plate_lookup()

    total_entries = 0
    total_overtime = 0
    results = []

    for process_date in dates_to_process:
        date_str = process_date.strftime('%Y-%m-%d')
        try:
            result = _process_date(
                date_str, process_date, driver_lookup, plate_lookup
            )
            total_entries += result['entries_created']
            total_overtime += result['overtime_created']
            results.append(result)
        except FMTrackError as e:
            logger.error('Tachograaf sync fout voor %s: %s', date_str, e)
            TachographSyncLog.objects.create(
                date=process_date,
                errors=str(e),
            )
        except Exception as e:
            logger.exception('Onverwachte fout bij tachograaf sync voor %s', date_str)
            TachographSyncLog.objects.create(
                date=process_date,
                errors=str(e),
            )

    logger.info(
        'Tachograaf sync voltooid: %d datums, %d uren, %d overuren',
        len(dates_to_process), total_entries, total_overtime,
    )
    return {
        'status': 'completed',
        'dates_processed': len(dates_to_process),
        'entries_created': total_entries,
        'overtime_created': total_overtime,
    }


def force_resync_tachograph_hours():
    """
    Force re-sync of ALL tachograph data by clearing existing sync logs
    and auto-created TimeEntries, then running a fresh sync.

    This is needed when the sync logic has been fixed (e.g. timezone corrections)
    and existing data needs to be re-processed.
    """
    from apps.core.models import AppSettings
    from apps.drivers.models import Driver
    from apps.timetracking.models import TimeEntry
    from apps.tracking.models import TachographOvertime, TachographSyncLog

    settings = AppSettings.get_settings()
    start_datum = settings.tachograaf_start_datum

    if not start_datum:
        return {'status': 'skipped', 'reason': 'no_start_date'}

    yesterday = date.today() - timedelta(days=1)

    # Get all auto_uren drivers
    auto_drivers = Driver.objects.filter(auto_uren=True).exclude(
        gekoppelde_gebruiker__isnull=True,
    )
    auto_user_ids = [d.gekoppelde_gebruiker_id for d in auto_drivers]

    # Delete auto-created TimeEntries (bron='auto_import') for these drivers
    # in the tachograph date range - manual entries are preserved
    deleted_entries, _ = TimeEntry.objects.filter(
        user_id__in=auto_user_ids,
        datum__gte=start_datum,
        datum__lte=yesterday,
        bron='auto_import',
    ).delete()

    # Delete overtime records in the date range
    deleted_overtime, _ = TachographOvertime.objects.filter(
        date__gte=start_datum,
        date__lte=yesterday,
    ).delete()

    # Clear sync logs only for dates within the FM-Track window (last 29 days)
    # so old dates don't get retried needlessly
    MAX_HISTORY = 29
    earliest_allowed = date.today() - timedelta(days=MAX_HISTORY)
    effective_start = max(start_datum, earliest_allowed)

    deleted_logs, _ = TachographSyncLog.objects.filter(
        date__gte=effective_start,
        date__lte=yesterday,
    ).delete()

    logger.info(
        'Force resync: verwijderd %d entries, %d overuren, %d sync logs',
        deleted_entries, deleted_overtime, deleted_logs,
    )

    # Now run a fresh sync
    result = sync_tachograph_hours()
    result['force_resync'] = True
    result['deleted_entries'] = deleted_entries
    result['deleted_overtime'] = deleted_overtime
    result['deleted_logs'] = deleted_logs
    return result


def _build_driver_lookup():
    """
    Build a lookup dict mapping normalized FM-Track driver names to TMS Driver objects.
    Only includes drivers that have a gekoppelde_gebruiker (linked user account).
    """
    from apps.drivers.models import Driver

    lookup = {}
    for driver in Driver.objects.select_related('gekoppelde_gebruiker', 'voertuig').all():
        if not driver.gekoppelde_gebruiker:
            continue
        # Normalize: lowercase, strip whitespace
        normalized = driver.naam.strip().lower()
        lookup[normalized] = driver
        # Also add without middle parts for fuzzy matching
        # e.g. "Jan de Vries" -> also store "jan vries"
        parts = normalized.split()
        if len(parts) > 2:
            short = f"{parts[0]} {parts[-1]}"
            if short not in lookup:
                lookup[short] = driver
    return lookup


def _build_plate_lookup():
    """
    Build a lookup dict mapping normalized plate numbers to TMS Driver objects.
    Only includes drivers with auto_uren=True and tacho_kenteken set.
    """
    from apps.drivers.models import Driver

    lookup = {}
    for driver in Driver.objects.select_related('gekoppelde_gebruiker', 'voertuig').filter(
        auto_uren=True,
    ).exclude(tacho_kenteken=''):
        if not driver.gekoppelde_gebruiker:
            continue
        normalized = driver.tacho_kenteken.upper().replace('-', '').replace(' ', '')
        lookup[normalized] = driver
    return lookup


def _match_driver(fm_driver_name, driver_lookup):
    """
    Try to match an FM-Track driver name to a TMS driver.
    Tries exact match first, then fuzzy matching.
    """
    if not fm_driver_name or fm_driver_name == 'Onbekend':
        return None

    normalized = fm_driver_name.strip().lower()

    # Exact match
    if normalized in driver_lookup:
        return driver_lookup[normalized]

    # Try reversed name (FM-Track might have "Last First" instead of "First Last")
    parts = normalized.split()
    if len(parts) == 2:
        reversed_name = f"{parts[1]} {parts[0]}"
        if reversed_name in driver_lookup:
            return driver_lookup[reversed_name]

    # Try matching without middle parts
    if len(parts) > 2:
        short = f"{parts[0]} {parts[-1]}"
        if short in driver_lookup:
            return driver_lookup[short]

    # Try partial match (first + last name contained)
    for key, driver in driver_lookup.items():
        key_parts = key.split()
        if len(parts) >= 2 and len(key_parts) >= 2:
            if parts[0] == key_parts[0] and parts[-1] == key_parts[-1]:
                return driver

    return None


def _process_date(date_str, process_date, driver_lookup, plate_lookup):
    """Process a single date: fetch tachograph data and create TimeEntry records."""
    from apps.timetracking.models import TimeEntry
    from apps.tracking.models import TachographOvertime, TachographSyncLog
    from apps.tracking.tachograph_service import get_tachograph_overview

    overview = get_tachograph_overview(date_str)

    entries_created = 0
    overtime_created = 0
    errors = []

    for vehicle in overview:
        kenteken = vehicle.get('plate_number', vehicle.get('vehicle_name', ''))
        normalized_plate = kenteken.upper().replace('-', '').replace(' ', '')

        # Try plate-based matching first (for drivers with auto_uren enabled)
        tms_driver = plate_lookup.get(normalized_plate)

        if not tms_driver:
            # Fall back to name-based matching
            drivers = vehicle.get('drivers', [])
            if not drivers:
                continue
            fm_driver_name = drivers[0].get('name', '')
            tms_driver = _match_driver(fm_driver_name, driver_lookup)
        else:
            # Got plate match Ã¢â‚¬â€ get the FM driver name for logging
            drivers = vehicle.get('drivers', [])
            fm_driver_name = drivers[0].get('name', '') if drivers else ''

        if not tms_driver:
            continue

        # Only create entries for drivers with auto_uren enabled
        if not tms_driver.auto_uren:
            continue

        user = tms_driver.gekoppelde_gebruiker

        # Check if entry already exists for this user+date+kenteken
        # Only skip if an auto_import entry exists; manual entries are preserved
        existing_auto = TimeEntry.objects.filter(
            user=user,
            datum=process_date,
            kenteken=kenteken,
            bron='auto_import',
        ).exists()

        if existing_auto:
            continue

        # Extract trip data
        first_start = vehicle.get('first_start')
        last_end = vehicle.get('last_end')
        first_km = vehicle.get('first_km', 0)
        last_km = vehicle.get('last_km', 0)

        if not first_start or not last_end:
            continue

        try:
            tacho_aanvang = datetime.fromisoformat(
                first_start.replace('Z', '+00:00')
            ).astimezone(NL_TZ).time().replace(microsecond=0)
            eind = datetime.fromisoformat(
                last_end.replace('Z', '+00:00')
            ).astimezone(NL_TZ).time().replace(microsecond=0)
        except (ValueError, AttributeError):
            errors.append(f'Ongeldige tijden voor {kenteken}: {first_start} - {last_end}')
            continue

        # Use standaard_begintijd if set, otherwise use tachograph start time
        aanvang = tms_driver.standaard_begintijd if tms_driver.standaard_begintijd else tacho_aanvang

        # Use standaard_pauze from driver
        pauze_minutes = tms_driver.standaard_pauze or 30
        pauze = timedelta(minutes=pauze_minutes)

        # Get ritnummer from vehicle if linked
        ritnummer = ''
        if tms_driver.voertuig:
            ritnummer = tms_driver.voertuig.ritnummer or ''
        if not ritnummer:
            ritnummer = kenteken

        # Convert km from float (km) to integer
        km_start = int(round(first_km))
        km_eind = int(round(last_km))

        if km_eind <= km_start:
            continue

        try:
            entry = TimeEntry(
                user=user,
                datum=process_date,
                ritnummer=ritnummer,
                kenteken=kenteken,
                km_start=km_start,
                km_eind=km_eind,
                aanvang=aanvang,
                eind=eind,
                pauze=pauze,
                status='ingediend',
                bron='auto_import',
            )
            entry.save()  # save() auto-calculates weeknummer, totaal_km, totaal_uren
            entries_created += 1
        except Exception as e:
            errors.append(f'Fout bij aanmaken entry voor {kenteken}/{fm_driver_name}: {e}')
            continue

        # Create overtime record if applicable
        # If driver has standaard_begintijd, recalculate overtime based on adjusted hours
        overtime_hours = vehicle.get('overtime_hours', 0)
        if tms_driver.standaard_begintijd:
            from datetime import date as date_cls
            aanvang_dt = datetime.combine(date_cls.today(), aanvang)
            eind_dt = datetime.combine(date_cls.today(), eind)
            if eind_dt < aanvang_dt:
                eind_dt += timedelta(days=1)
            adjusted_work = (eind_dt - aanvang_dt - pauze).total_seconds() / 3600
            overtime_hours = max(0, round(adjusted_work - 8, 2))

        if overtime_hours > 0:
            TachographOvertime.objects.update_or_create(
                driver=tms_driver,
                date=process_date,
                defaults={
                    'overtime_hours': overtime_hours,
                    'vehicle_name': kenteken,
                    'fm_driver_name': fm_driver_name,
                },
            )
            overtime_created += 1

    # Update overtime/leave balance for users who got new entries
    if entries_created > 0:
        from apps.leave.signals import update_user_overtime

        weeknummer = process_date.isocalendar()[1]
        jaar = process_date.isocalendar()[0]

        # Collect unique users who got entries this date
        users_with_entries = set()
        for vehicle in overview:
            kenteken = vehicle.get('plate_number', vehicle.get('vehicle_name', ''))
            normalized_plate = kenteken.upper().replace('-', '').replace(' ', '')
            tms_driver = plate_lookup.get(normalized_plate)
            if tms_driver and tms_driver.auto_uren and tms_driver.gekoppelde_gebruiker:
                users_with_entries.add(tms_driver.gekoppelde_gebruiker)

        for user in users_with_entries:
            try:
                overtime = update_user_overtime(user, weeknummer, jaar)
                if overtime > 0:
                    logger.info(
                        'Overuren bijgewerkt voor %s: week %d/%d = %s uur',
                        user.get_full_name(), weeknummer, jaar, overtime,
                    )
            except Exception as e:
                errors.append(f'Fout bij overuren berekening voor {user}: {e}')

    # Log this date as processed
    TachographSyncLog.objects.create(
        date=process_date,
        vehicles_processed=len(overview),
        entries_created=entries_created,
        overtime_created=overtime_created,
        errors='\n'.join(errors) if errors else '',
    )

    return {
        'date': date_str,
        'vehicles_processed': len(overview),
        'entries_created': entries_created,
        'overtime_created': overtime_created,
        'errors': errors,
    }

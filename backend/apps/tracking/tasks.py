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
    from apps.tracking.tachograph_archive_service import upsert_tachograph_archive_for_date
    from apps.tracking.tachograph_service import FMTrackError

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
    total_archive_created = 0
    all_affected_users = set()
    results = []

    for process_date in dates_to_process:
        date_str = process_date.strftime('%Y-%m-%d')
        try:
            archive_result = upsert_tachograph_archive_for_date(date_str)
            total_archive_created += archive_result['created_count']
        except FMTrackError as e:
            logger.error('Tachograaf archief sync fout voor %s: %s', date_str, e)
        except Exception:
            logger.exception('Onverwachte fout bij tachograaf archief sync voor %s', date_str)

        try:
            result = _process_date(
                date_str, process_date, driver_lookup, plate_lookup
            )
            total_entries += result['entries_created']
            total_overtime += result['overtime_created']
            all_affected_users.update(result.get('users_with_new_entries', set()))
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

    # Recalculate overtime/leave balance for all affected users (idempotent)
    if all_affected_users:
        from apps.leave.signals import recalculate_user_overtime

        for user in all_affected_users:
            try:
                new_overtime = recalculate_user_overtime(user)
                logger.info(
                    'Overuren saldo voor %s: %s uur',
                    user.full_name, new_overtime,
                )
            except Exception as e:
                logger.error('Fout bij overuren berekening voor %s: %s', user, e)

    logger.info(
        'Tachograaf sync voltooid: %d datums, %d uren, %d overuren',
        len(dates_to_process), total_entries, total_overtime,
    )
    return {
        'status': 'completed',
        'dates_processed': len(dates_to_process),
        'entries_created': total_entries,
        'overtime_created': total_overtime,
        'archive_created': total_archive_created,
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

    # Only delete records within the FM-Track re-sync window (last 29 days).
    # Records older than 29 days cannot be re-fetched from FM-Track and would
    # be permanently lost — destroying overtime balances and leave calculations.
    MAX_HISTORY = 29
    earliest_allowed = date.today() - timedelta(days=MAX_HISTORY)
    effective_start = max(start_datum, earliest_allowed)

    # Delete auto-created TimeEntries (bron='auto_import') for these drivers
    # only within the re-syncable window - older entries are preserved
    deleted_entries, _ = TimeEntry.objects.filter(
        user_id__in=auto_user_ids,
        datum__gte=effective_start,
        datum__lte=yesterday,
        bron='auto_import',
    ).delete()

    # Delete overtime records only within the re-syncable window
    # and only for auto_uren drivers (not all drivers)
    deleted_overtime, _ = TachographOvertime.objects.filter(
        driver__in=auto_drivers,
        date__gte=effective_start,
        date__lte=yesterday,
    ).delete()

    deleted_logs, _ = TachographSyncLog.objects.filter(
        date__gte=effective_start,
        date__lte=yesterday,
    ).delete()

    logger.info(
        'Force resync: verwijderd %d entries, %d overuren, %d sync logs',
        deleted_entries, deleted_overtime, deleted_logs,
    )

    # Now run a fresh sync (which will also recalculate overtime for affected users)
    result = sync_tachograph_hours()

    # Recalculate overtime for ALL auto_uren users (in case some dates failed to sync)
    from apps.leave.signals import recalculate_user_overtime
    for driver in auto_drivers:
        try:
            recalculate_user_overtime(driver.gekoppelde_gebruiker)
        except Exception as e:
            logger.error('Fout bij overuren herberekening voor %s: %s', driver.naam, e)

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
    users_with_new_entries = set()

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

        # Check if auto_import entry already exists — skip if so
        existing_auto = TimeEntry.objects.filter(
            user=user,
            datum=process_date,
            kenteken=kenteken,
            bron='auto_import',
        ).exists()

        if existing_auto:
            continue

        # Delete any older entries (e.g. handmatig) for same user+date+kenteken
        # so the fresh auto_import entry replaces them
        old_entries = TimeEntry.objects.filter(
            user=user,
            datum=process_date,
            kenteken=kenteken,
        )
        if old_entries.exists():
            deleted_count, _ = old_entries.delete()
            logger.info(
                'Replaced %d old entry(ies) for %s on %s (%s)',
                deleted_count, user.email, process_date, kenteken,
            )

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
            users_with_new_entries.add(user)
        except Exception as e:
            errors.append(f'Fout bij aanmaken entry voor {kenteken}/{fm_driver_name}: {e}')
            continue

        # Create overtime record if applicable
        # Determine the daily hours threshold from the driver's uren_per_dag, with 8 as fallback
        daily_hours = float(tms_driver.uren_per_dag) if tms_driver.uren_per_dag is not None else 8

        # If driver has standaard_begintijd or uren_per_dag, recalculate overtime based on adjusted hours
        overtime_hours = vehicle.get('overtime_hours', 0)
        if tms_driver.standaard_begintijd or tms_driver.uren_per_dag is not None:
            from datetime import date as date_cls
            aanvang_dt = datetime.combine(date_cls.today(), aanvang)
            eind_dt = datetime.combine(date_cls.today(), eind)
            if eind_dt < aanvang_dt:
                eind_dt += timedelta(days=1)
            adjusted_work = (eind_dt - aanvang_dt - pauze).total_seconds() / 3600
            overtime_hours = max(0, round(adjusted_work - daily_hours, 2))

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
        'users_with_new_entries': users_with_new_entries,
    }

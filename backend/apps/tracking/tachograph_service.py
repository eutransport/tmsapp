"""
FM-Track / Linqo Tachograph API service.

Provides functions to fetch vehicle trips and driver data from the FM-Track API.
API docs: https://api.fm-track.com/swagger-ui.html
"""
import logging
from datetime import datetime, timedelta
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from zoneinfo import ZoneInfo

NL_TZ = ZoneInfo('Europe/Amsterdam')

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

FM_TRACK_BASE_URL = 'https://api.fm-track.com'
REQUEST_TIMEOUT = 30


class FMTrackError(Exception):
    """Custom exception for FM-Track API errors."""
    pass


def _get_api_key():
    """Get the Linqo API key from AppSettings."""
    from apps.core.models import AppSettings
    app_settings = AppSettings.get_settings()
    api_key = getattr(app_settings, 'linqo_api_key', '')
    if not api_key:
        raise FMTrackError('Linqo API key is niet geconfigureerd. Ga naar Instellingen om de API key in te stellen.')
    return api_key


def _api_get(endpoint, params=None):
    """Make a GET request to the FM-Track API."""
    api_key = _get_api_key()
    if params is None:
        params = {}
    params['api_key'] = api_key
    params['version'] = '1'

    url = f'{FM_TRACK_BASE_URL}{endpoint}'
    try:
        response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.HTTPError as e:
        logger.error('FM-Track API error: %s %s', e.response.status_code, e.response.text[:500])
        raise FMTrackError(f'FM-Track API fout: {e.response.status_code}')
    except requests.exceptions.RequestException as e:
        logger.error('FM-Track API connection error: %s', e)
        raise FMTrackError('Kan geen verbinding maken met FM-Track API.')


def get_objects():
    """Fetch all vehicles/objects from FM-Track."""
    data = _api_get('/objects')
    return data if isinstance(data, list) else data.get('value', [])


def get_drivers():
    """Fetch all drivers from FM-Track."""
    data = _api_get('/drivers')
    return data if isinstance(data, list) else data.get('value', [])


def get_trips(object_id, date_from, date_till):
    """
    Fetch trips for a specific vehicle/object.
    Auto-chunks requests into ≤25-day periods and clamps the start to
    max 29 days before *now* (FM-Track rejects from_datetime >30 days ago).

    Args:
        object_id: FM-Track object UUID
        date_from: datetime (start, tz-aware)
        date_till: datetime (end, tz-aware)

    Returns:
        list of trip dicts
    """
    MAX_DAYS = 25       # chunk size
    MAX_HISTORY = 29    # FM-Track rejects from_datetime > 30 days before now

    # Clamp start so it's never more than 29 days before the current moment
    now = datetime.now(date_from.tzinfo or ZoneInfo('UTC'))
    earliest_allowed = now - timedelta(days=MAX_HISTORY)
    if date_from < earliest_allowed:
        logger.info(
            'Clamping from_datetime from %s to %s (FM-Track 30-day history limit)',
            date_from, earliest_allowed,
        )
        date_from = earliest_allowed

    if date_from >= date_till:
        return []

    total_days = (date_till - date_from).days
    if total_days <= MAX_DAYS:
        return _get_trips_single(object_id, date_from, date_till)

    # Chunk into ≤MAX_DAYS periods
    all_trips = []
    chunk_start = date_from
    while chunk_start < date_till:
        chunk_end = min(chunk_start + timedelta(days=MAX_DAYS), date_till)
        try:
            trips = _get_trips_single(object_id, chunk_start, chunk_end)
            all_trips.extend(trips)
        except FMTrackError:
            logger.warning(
                'Chunk %s→%s failed for object %s, skipping',
                chunk_start, chunk_end, object_id,
            )
        chunk_start = chunk_end + timedelta(seconds=1)
    return all_trips


def _get_trips_single(object_id, date_from, date_till):
    """Fetch trips for a single ≤30-day period, handling pagination."""
    all_trips = []
    current_from = date_from

    for _ in range(50):  # safety limit on pages
        data = _api_get(f'/objects/{object_id}/trips', {
            'from_datetime': current_from.strftime('%Y-%m-%dT%H:%M:%SZ'),
            'till_datetime': date_till.strftime('%Y-%m-%dT%H:%M:%SZ'),
        })
        if isinstance(data, list):
            all_trips.extend(data)
            break
        if isinstance(data, dict):
            trips = data.get('trips', data.get('value', []))
            all_trips.extend(trips)
            cont = data.get('continuation_token')
            if cont:
                try:
                    current_from = datetime.strptime(cont, '%Y-%m-%dT%H:%M:%S.%fZ')
                    current_from = current_from.replace(tzinfo=ZoneInfo('UTC'))
                    if current_from > date_till:
                        break
                except ValueError:
                    break
            else:
                break
        else:
            break
    return all_trips


def get_raw_data(object_id, date_from, date_till):
    """
    Fetch raw GPS track data for a vehicle in a time range.

    Returns list of dicts with latitude, longitude, speed, timestamp etc.
    """
    data = _api_get(f'/objects/{object_id}/raw_data', {
        'from_datetime': date_from.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'till_datetime': date_till.strftime('%Y-%m-%dT%H:%M:%SZ'),
    })
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get('raw_data', data.get('items', data.get('value', [])))
    return []


def get_tachograph_overview(date_str):
    """
    Get a full tachograph overview for all vehicles on a given date.

    Args:
        date_str: date string 'YYYY-MM-DD'

    Returns:
        list of vehicle summaries with trips, drivers, km, hours, overtime
    """
    target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
    # Use timezone-aware boundaries: local midnight → local 23:59:59, converted to UTC
    local_start = datetime(target_date.year, target_date.month, target_date.day, 0, 0, 0, tzinfo=NL_TZ)
    local_end = datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59, tzinfo=NL_TZ)
    date_from = local_start.astimezone(ZoneInfo('UTC'))
    date_till = local_end.astimezone(ZoneInfo('UTC'))

    # Fetch objects and drivers
    objects = get_objects()
    fm_drivers = get_drivers()

    # Build driver lookup
    driver_map = {}
    for d in fm_drivers:
        driver_map[d['id']] = _format_driver_name(d)

    # Fetch trips for all vehicles in parallel
    def _fetch_trips(obj):
        try:
            trips = get_trips(obj['id'], date_from, date_till)
            # Filter trips to only include those on the target date
            filtered = []
            for trip in trips:
                trip_start_dt = trip.get('trip_start', {}).get('datetime', '')
                if trip_start_dt and trip_start_dt[:10] == date_str:
                    filtered.append(trip)
            return obj, filtered
        except FMTrackError:
            return obj, []

    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(_fetch_trips, obj): obj for obj in objects}
        for future in as_completed(futures):
            obj, trips = future.result()
            if not trips:
                continue
            vehicle_summary = _build_vehicle_summary(obj, trips, driver_map)
            results.append(vehicle_summary)

    # Sort by vehicle name
    results.sort(key=lambda x: x['vehicle_name'])
    return results


def _format_driver_name(driver):
    """Format driver name from FM-Track driver data."""
    first = (driver.get('first_name') or '').strip()
    last = (driver.get('last_name') or '').strip()
    # Skip card IDs (e.g. 'B000353355000002')
    if first and not last and (first[0].isdigit() or (len(first) > 5 and first[1:].isdigit())):
        return first  # Return as-is but it's a card ID
    if first and last:
        return f'{first} {last}'
    return first or last or 'Onbekend'


def _build_vehicle_summary(obj, trips, driver_map):
    """Build summary for a single vehicle's trips."""
    vehicle_params = obj.get('vehicle_params', {})

    # Determine first trip start and last trip end
    all_starts = []
    all_ends = []
    total_duration_seconds = 0
    trip_details = []
    drivers_seen = set()

    for trip in trips:
        start_info = trip.get('trip_start', {})
        end_info = trip.get('trip_end', {})
        duration = trip.get('trip_duration', 0)  # seconds
        total_duration_seconds += duration

        start_dt = start_info.get('datetime', '')
        end_dt = end_info.get('datetime', '')
        start_mileage = start_info.get('mileage', 0)
        end_mileage = end_info.get('mileage', 0)

        # Collect driver names for this trip
        trip_driver_ids = trip.get('driver_ids', [])
        trip_drivers = []
        for did in trip_driver_ids:
            name = driver_map.get(did, 'Onbekend')
            trip_drivers.append({'id': did, 'name': name})
            drivers_seen.add(did)

        if start_dt:
            all_starts.append(start_dt)
        if end_dt:
            all_ends.append(end_dt)

        trip_details.append({
            'start_time': start_dt,
            'end_time': end_dt,
            'start_km': round(start_mileage / 1000, 1) if start_mileage else 0,
            'end_km': round(end_mileage / 1000, 1) if end_mileage else 0,
            'distance_km': round(trip.get('mileage', 0) / 1000, 1),
            'duration_seconds': duration,
            'duration_display': _format_duration(duration),
            'drivers': trip_drivers,
            'start_address': _format_address(start_info.get('address')),
            'end_address': _format_address(end_info.get('address')),
        })

    # Overall stats
    first_start = min(all_starts) if all_starts else None
    last_end = max(all_ends) if all_ends else None

    total_hours = total_duration_seconds / 3600
    overtime_hours = max(0, total_hours - 8)

    # First and last mileage
    first_km = trip_details[0]['start_km'] if trip_details else 0
    last_km = trip_details[-1]['end_km'] if trip_details else 0
    total_km = round(last_km - first_km, 1) if last_km and first_km else 0

    # All unique drivers for this vehicle on this day
    all_drivers = []
    for did in drivers_seen:
        all_drivers.append({'id': did, 'name': driver_map.get(did, 'Onbekend')})

    return {
        'object_id': obj['id'],
        'vehicle_name': obj.get('name', ''),
        'vehicle_make': vehicle_params.get('make', ''),
        'vehicle_model': vehicle_params.get('model', ''),
        'plate_number': vehicle_params.get('plate_number') or obj.get('name', ''),
        'first_start': first_start,
        'last_end': last_end,
        'first_km': first_km,
        'last_km': last_km,
        'total_km': total_km,
        'total_duration_seconds': total_duration_seconds,
        'total_hours': round(total_hours, 2),
        'total_hours_display': _format_duration(total_duration_seconds),
        'overtime_hours': round(overtime_hours, 2),
        'overtime_display': _format_duration(int(overtime_hours * 3600)) if overtime_hours > 0 else None,
        'has_overtime': overtime_hours > 0,
        'drivers': all_drivers,
        'trips': trip_details,
        'trip_count': len(trip_details),
    }


def _format_duration(seconds):
    """Format seconds to HH:MM display."""
    if not seconds:
        return '00:00'
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    return f'{hours:02d}:{minutes:02d}'


def _format_address(address):
    """Format an address dict to a readable string."""
    if not address:
        return ''
    parts = []
    street = address.get('street', '')
    house = address.get('house_number', '')
    if street:
        parts.append(f'{street} {house}'.strip() if house else street)
    locality = address.get('locality', '')
    if locality:
        parts.append(locality)
    return ', '.join(parts) if parts else ''


def _calc_remaining_km(fd):
    """Calculate estimated remaining km from fuel data dict."""
    if not fd:
        return None
    fuel_level = fd.get('fuel_level', 0)
    tank = fd.get('fuel_tank_capacity', 0)
    consumption = fd.get('average_fuel_consumption', 0)
    if fuel_level > 0 and tank > 0 and consumption > 0:
        liters = tank * (fuel_level / 100.0)
        return round(liters / consumption * 100)
    return None


def get_vehicle_locations():
    """
    Get the current position of each vehicle from FM-Track.

    Uses GPS/IO data directly from the /objects endpoint for real-time info
    (position, speed, heading, ignition status). Falls back to last trip data
    for vehicles that don't have GPS data on the object.

    Returns:
        list of dicts with vehicle position info
    """
    from datetime import date as date_type

    objects = get_objects()
    positions = []
    objects_without_gps = []

    # Fetch last trip for each object to get fuel_level and mileage
    today = date_type.today()
    date_from = datetime(today.year, today.month, today.day, 0, 0, 0) - timedelta(days=7)
    date_till = datetime(today.year, today.month, today.day, 23, 59, 59)
    fuel_data = {}  # object_id -> {fuel_level, mileage}

    def _fetch_fuel_data(obj):
        try:
            trips = get_trips(obj['id'], date_from, date_till)
            if not trips:
                return None
            last_trip = max(trips, key=lambda t: t.get('trip_end', {}).get('datetime', ''), default=None)
            if not last_trip:
                return None
            end = last_trip.get('trip_end', {})
            vp = obj.get('vehicle_params', {})
            return {
                'object_id': obj['id'],
                'fuel_level': end.get('fuel_level', 0) or 0,
                'mileage': end.get('mileage', 0) or 0,
                'fuel_tank_capacity': vp.get('fuel_tank_capacity') or 0,
                'average_fuel_consumption': vp.get('average_fuel_consumption') or 0,
            }
        except FMTrackError:
            return None

    with ThreadPoolExecutor(max_workers=5) as executor:
        fuel_futures = {executor.submit(_fetch_fuel_data, o): o for o in objects}
        for future in as_completed(fuel_futures):
            result = future.result()
            if result:
                fuel_data[result['object_id']] = result

    for obj in objects:
        vehicle_params = obj.get('vehicle_params', {})
        plate = vehicle_params.get('plate_number') or obj.get('name', '')

        # Fuel info from last trip
        fd = fuel_data.get(obj['id'], {})
        fuel_level = fd.get('fuel_level', 0)
        fuel_tank_capacity = fd.get('fuel_tank_capacity') or vehicle_params.get('fuel_tank_capacity') or 0
        avg_consumption = fd.get('average_fuel_consumption') or vehicle_params.get('average_fuel_consumption') or 0

        # Estimate remaining km: fuel_level is percentage, tank capacity in liters, consumption in L/100km
        fuel_remaining_km = None
        if fuel_level > 0 and fuel_tank_capacity > 0 and avg_consumption > 0:
            liters_remaining = fuel_tank_capacity * (fuel_level / 100.0)
            fuel_remaining_km = round(liters_remaining / avg_consumption * 100)

        # Try real-time GPS data from object — FM-Track API can nest it under
        # various keys depending on API version / firmware
        gps = obj.get('gps') or obj.get('position') or obj.get('last_position') or {}
        lat = gps.get('latitude') or gps.get('lat')
        lon = gps.get('longitude') or gps.get('lng') or gps.get('lon')

        # Some FM-Track versions put lat/lon directly on the object
        if lat is None:
            lat = obj.get('latitude') or obj.get('lat')
        if lon is None:
            lon = obj.get('longitude') or obj.get('lng') or obj.get('lon')

        if lat is not None and lon is not None:
            speed = gps.get('speed', 0) or obj.get('speed', 0) or 0
            heading = gps.get('direction') or gps.get('heading') or gps.get('course', 0) or obj.get('heading', 0)
            timestamp = gps.get('datetime') or gps.get('timestamp', '') or obj.get('datetime', '')

            # IO data for ignition status
            io_data = obj.get('io') or obj.get('inputs') or {}
            ignition = io_data.get('ignition')
            if ignition is None:
                # Some FM-Track versions use different field names
                ignition = io_data.get('din1') or io_data.get('digital_input_1')

            # Determine vehicle status
            if speed and speed > 3:
                vehicle_status = 'driving'
            elif ignition:
                vehicle_status = 'idle'
            else:
                vehicle_status = 'parked'

            positions.append({
                'object_id': obj['id'],
                'vehicle_name': obj.get('name', ''),
                'plate_number': plate,
                'latitude': lat,
                'longitude': lon,
                'address': _format_address(gps.get('address')),
                'timestamp': timestamp,
                'speed': speed,
                'heading': heading or 0,
                'ignition': bool(ignition) if ignition is not None else None,
                'vehicle_status': vehicle_status,
                'fuel_level': fuel_level,
                'fuel_remaining_km': fuel_remaining_km,
            })
        else:
            objects_without_gps.append(obj)

    # Fall back to trip-based approach for vehicles without GPS data on object
    if objects_without_gps:
        today = date_type.today()
        date_from = datetime(today.year, today.month, today.day, 0, 0, 0) - timedelta(days=7)
        date_till = datetime(today.year, today.month, today.day, 23, 59, 59)

        def _fetch_last_position(obj):
            try:
                trips = get_trips(obj['id'], date_from, date_till)
                if not trips:
                    return None
                last_trip = max(
                    trips,
                    key=lambda t: t.get('trip_end', {}).get('datetime', ''),
                    default=None,
                )
                if not last_trip:
                    return None

                # Determine status from trip timing:
                # - If trip has no end time, or end time is very recent → driving
                # - If trip ended recently (< 5 min) → idle
                # - Otherwise → parked
                trip_end = last_trip.get('trip_end', {})
                trip_start = last_trip.get('trip_start', {})
                end_dt_str = trip_end.get('datetime', '')
                vehicle_status = 'parked'
                trip_speed = 0

                if end_dt_str:
                    try:
                        end_dt = datetime.fromisoformat(end_dt_str.replace('Z', '+00:00'))
                        from django.utils import timezone
                        now = timezone.now()
                        elapsed = (now - end_dt).total_seconds()
                        if elapsed < 120:  # Trip ended < 2 min ago
                            vehicle_status = 'driving'
                            trip_speed = last_trip.get('max_speed', 0) or 0
                        elif elapsed < 300:  # Trip ended < 5 min ago
                            vehicle_status = 'idle'
                    except (ValueError, TypeError):
                        pass
                else:
                    # No end time — trip is still active
                    vehicle_status = 'driving'
                    trip_speed = last_trip.get('max_speed', 0) or 0

                # Use last known position from trip end (or start if driving)
                pos_info = trip_end if end_dt_str else trip_start
                lat = pos_info.get('latitude')
                lon = pos_info.get('longitude')
                if lat is None or lon is None:
                    return None
                vp = obj.get('vehicle_params', {})
                return {
                    'object_id': obj['id'],
                    'vehicle_name': obj.get('name', ''),
                    'plate_number': vp.get('plate_number') or obj.get('name', ''),
                    'latitude': lat,
                    'longitude': lon,
                    'address': _format_address(pos_info.get('address')),
                    'timestamp': pos_info.get('datetime', ''),
                    'speed': trip_speed,
                    'heading': 0,
                    'ignition': None,
                    'vehicle_status': vehicle_status,
                    'fuel_level': fuel_data.get(obj['id'], {}).get('fuel_level', 0),
                    'fuel_remaining_km': _calc_remaining_km(fuel_data.get(obj['id'], {})),
                }
            except FMTrackError:
                return None

        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {executor.submit(_fetch_last_position, o): o for o in objects_without_gps}
            for future in as_completed(futures):
                result = future.result()
                if result:
                    positions.append(result)

    return positions

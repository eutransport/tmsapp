"""Dagdetail van een Navixy-voertuig.

Levert dezelfde structuur als het FM-Track-detailscherm, zodat de bestaande
frontend er zonder aanpassing mee overweg kan. Brandstofgegevens ontbreken:
Navixy levert die niet, dus die velden blijven leeg in plaats van dat we een
getal verzinnen.
"""
import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from apps.tracking import navixy_service
from apps.tracking.models import NavixyJourney, NavixyTracker

logger = logging.getLogger('tracking')

NL_TZ = ZoneInfo('Europe/Amsterdam')

# EU-verordening 561/2006: maximaal negen uur rijden per dag.
MAX_RIJTIJD_PER_DAG_SECONDEN = 9 * 3600


def is_navixy_object(object_id):
    return str(object_id or '').startswith('navixy:')


def tracker_van_object(object_id):
    """De tracker achter een object-id als ``navixy:3687634``, of None."""
    if not is_navixy_object(object_id):
        return None
    nummer = str(object_id).split(':', 1)[1].strip()
    if not nummer:
        return None
    return (NavixyTracker.objects
            .filter(tracker_id=nummer, actief=True, koppeling__actief=True)
            .select_related('koppeling')
            .first())


def _duur_tekst(seconden):
    seconden = int(seconden or 0)
    return f'{seconden // 3600}u {(seconden % 3600) // 60}m'


def dagdetail(tracker, datum, live_positie=None):
    """Bouw het dagoverzicht voor een Navixy-voertuig."""
    begin = datetime.combine(datum, time.min, tzinfo=NL_TZ)
    einde = begin + timedelta(days=1)

    ritten = list(
        NavixyJourney.objects
        .filter(tracker=tracker, start_time__gte=begin, start_time__lt=einde)
        .order_by('start_time')
    )

    details = []
    totaal_km = 0.0
    totaal_seconden = 0
    hoogste_snelheid = 0.0

    for rit in ritten:
        totaal_km += rit.distance_km or 0
        totaal_seconden += rit.duration_seconds or 0
        hoogste_snelheid = max(hoogste_snelheid, rit.max_speed or 0)

        details.append({
            'start_time': rit.start_time.astimezone(NL_TZ).strftime('%Y-%m-%d %H:%M:%S'),
            'end_time': (rit.end_time.astimezone(NL_TZ).strftime('%Y-%m-%d %H:%M:%S')
                         if rit.end_time else ''),
            'start_address': rit.start_address,
            'end_address': rit.end_address,
            'start_lat': rit.start_latitude,
            'start_lng': rit.start_longitude,
            'end_lat': rit.end_latitude,
            'end_lng': rit.end_longitude,
            # Navixy houdt geen kilometerstand bij, alleen de afstand per rit.
            'start_km': 0,
            'end_km': 0,
            'distance_km': round(rit.distance_km or 0, 1),
            'duration_seconds': rit.duration_seconds or 0,
            'duration_display': _duur_tekst(rit.duration_seconds),
            'max_speed': round(rit.max_speed or 0),
            'is_speeding': (rit.max_speed or 0) > 130,
            'start_fuel_level': 0,
            'end_fuel_level': 0,
            'fuel_used_liters': None,
        })

    route = []
    if ritten:
        try:
            route = navixy_service.get_track_points(tracker, begin, einde)
        except navixy_service.NavixyError as fout:
            # Zonder kaartlijn is het scherm nog steeds bruikbaar.
            logger.warning('Navixy-route niet beschikbaar voor tracker %s: %s',
                           tracker.tracker_id, fout)

    huidige_positie = None
    if live_positie:
        huidige_positie = {
            'latitude': live_positie.get('latitude'),
            'longitude': live_positie.get('longitude'),
            'speed': live_positie.get('speed', 0),
            'speed_source': 'live',
            'address': live_positie.get('address', ''),
            'vehicle_status': live_positie.get('vehicle_status', 'parked'),
            'fuel_level': 0,
            'fuel_remaining_km': None,
            'heading': live_positie.get('heading'),
            'timestamp': live_positie.get('timestamp', ''),
        }

    resterend = max(0, MAX_RIJTIJD_PER_DAG_SECONDEN - totaal_seconden)

    return {
        'object_id': f'navixy:{tracker.tracker_id}',
        'bron': 'navixy',
        'date': datum.isoformat(),
        'vehicle': {
            'name': tracker.omschrijving or tracker.kenteken,
            'plate_number': tracker.kenteken,
            'make': '',
            'model': '',
        },
        'current_position': huidige_positie,
        'odometer_km': 0,
        'total_distance_km': round(totaal_km, 1),
        'total_duration_seconds': totaal_seconden,
        'total_duration_display': _duur_tekst(totaal_seconden),
        'max_speed': round(hoogste_snelheid),
        'trip_count': len(details),
        'trips': details,
        'fuel_tank_capacity': 0,
        'total_fuel_used_liters': None,
        'total_fuel_used_pct': None,
        'avg_fuel_consumption': None,
        'avg_fuel_consumption_pct': None,
        'fuel_per_hour': None,
        'fuel_per_hour_pct': None,
        'remaining_drive_seconds': resterend,
        'remaining_drive_display': _duur_tekst(resterend),
        'fuel_chart_data': [],
        'route_coordinates': route,
    }

"""Dagdetail van een Radius-voertuig.

Levert dezelfde structuur als het FM-Track-detailscherm, zodat de bestaande
frontend er zonder aanpassing mee overweg kan.

Wat Radius niet levert, laten we leeg in plaats van een getal te verzinnen:
de ritgeschiedenis bevat geen brandstofniveau, geen kilometerstand en geen
maximumsnelheid. De tegels en de brandstofgrafiek blijven daardoor leeg; de
ritten, adressen, afstanden, rijtijd en stilstand zijn er wel.

Een voertuig wordt aangeduid als ``radius:<service_id>``. We koppelen bewust
op service_id en niet op kenteken, omdat Radius hetzelfde voertuig soms
anders spelt (31-BLN-8 tegenover 31-BNL-8).
"""
import logging
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from apps.tracking.models import RadiusJourney

logger = logging.getLogger('tracking')

NL_TZ = ZoneInfo('Europe/Amsterdam')

# EU-verordening 561/2006: maximaal negen uur rijden per dag.
MAX_RIJTIJD_PER_DAG_SECONDEN = 9 * 3600

VOORVOEGSEL = 'radius:'


def is_radius_object(object_id):
    return str(object_id or '').startswith(VOORVOEGSEL)


def service_id_van_object(object_id):
    """Het Radius service_id achter een object-id als ``radius:abc-123``."""
    if not is_radius_object(object_id):
        return None
    return str(object_id)[len(VOORVOEGSEL):].strip() or None


def _duur_tekst(seconden):
    seconden = int(seconden or 0)
    return f'{seconden // 3600}u {(seconden % 3600) // 60}m'


def _adres(straat, plaats):
    delen = [d for d in (straat, plaats) if d and str(d).strip()]
    return ', '.join(str(d).strip() for d in delen)


def _ritten_uit_archief(service_id, datum):
    """De ritten van die dag uit ons eigen archief."""
    begin = datetime.combine(datum, time.min, tzinfo=NL_TZ)
    einde = begin + timedelta(days=1)
    return [
        {
            'start_time': rit.start_time,
            'end_time': rit.end_time,
            'start_address': _adres(rit.start_address, rit.start_city),
            'end_address': _adres(rit.end_address, rit.end_city),
            'start_latitude': rit.start_latitude,
            'start_longitude': rit.start_longitude,
            'end_latitude': rit.end_latitude,
            'end_longitude': rit.end_longitude,
            'distance_km': rit.distance_km or 0,
            'duration_seconds': rit.duration_seconds or 0,
            'plate_number': rit.plate_number,
        }
        for rit in (
            RadiusJourney.objects
            .filter(service_id=service_id, start_time__gte=begin, start_time__lt=einde)
            .order_by('start_time')
        )
    ]


def _ritten_uit_api(service_id, datum):
    """
    De ritten rechtstreeks bij Radius ophalen.

    Het archief wordt eenmaal per dag bijgewerkt, dus voor vandaag staat er
    nog niets in. Radius bewaart zelf ongeveer dertig dagen.
    """
    from apps.tracking import radius_service
    from apps.tracking.radius_archive_service import bepaal_klant_id
    from django.utils import timezone as dj_tz

    if (dj_tz.localtime().date() - datum).days > radius_service.JOURNEYS_MAX_DAGEN:
        return []

    koppeling = radius_service.actieve_koppeling('telematics')
    klant_id = bepaal_klant_id(connection=koppeling)
    resultaat = radius_service.get_journeys(klant_id, datum, datum, connection=koppeling)

    ritten = []
    for rit in resultaat.get('journeys') or []:
        if rit.get('service_id') != service_id:
            continue
        start = rit.get('start_time')
        if not start:
            continue
        # Radius geeft de dag van de klant terug, maar we tonen de
        # Nederlandse kalenderdag; losse randgevallen filteren we hier weg.
        if start.astimezone(NL_TZ).date() != datum:
            continue
        ritten.append({
            'start_time': start,
            'end_time': rit.get('end_time'),
            'start_address': _adres(rit.get('start_address'), rit.get('start_city')),
            'end_address': _adres(rit.get('end_address'), rit.get('end_city')),
            'start_latitude': rit.get('start_latitude'),
            'start_longitude': rit.get('start_longitude'),
            'end_latitude': rit.get('end_latitude'),
            'end_longitude': rit.get('end_longitude'),
            'distance_km': rit.get('distance_km') or 0,
            'duration_seconds': rit.get('duration_seconds') or 0,
            'plate_number': rit.get('plate_number') or '',
        })
    ritten.sort(key=lambda r: r['start_time'])
    return ritten


def haal_ritten(service_id, datum):
    """
    De ritten van een dag, uit het archief of anders rechtstreeks bij Radius.

    Het archief is leidend omdat het sneller is en verder terug gaat dan de
    dertig dagen van Radius zelf. Alleen als het archief die dag nog niet
    kent, vragen we het bij Radius op.
    """
    ritten = _ritten_uit_archief(service_id, datum)
    if ritten:
        return ritten, 'archief'
    try:
        return _ritten_uit_api(service_id, datum), 'api'
    except Exception:
        # Zonder ritten is het scherm nog steeds bruikbaar; het toont dan
        # simpelweg een dag zonder ritten in plaats van een foutmelding.
        logger.warning('Radius-ritten niet beschikbaar voor %s op %s', service_id, datum)
        return [], 'onbekend'


def dagdetail(service_id, datum, live_positie=None, kenteken=''):
    """Bouw het dagoverzicht voor een Radius-voertuig."""
    ritten, bron_ritten = haal_ritten(service_id, datum)

    details = []
    totaal_km = 0.0
    totaal_seconden = 0
    stilstand_seconden = 0

    for rit in ritten:
        afstand = rit['distance_km'] or 0
        duur = rit['duration_seconds'] or 0
        # Geen afstand betekent dat de motor draaide zonder te rijden; dat is
        # geen rijtijd en telt niet mee voor de EU-rijtijd van 9 uur.
        stilstand = afstand <= 0
        totaal_km += afstand
        if stilstand:
            stilstand_seconden += duur
        else:
            totaal_seconden += duur

        if not kenteken and rit.get('plate_number'):
            kenteken = rit['plate_number']

        details.append({
            'start_time': rit['start_time'].astimezone(NL_TZ).strftime('%Y-%m-%d %H:%M:%S'),
            'end_time': (rit['end_time'].astimezone(NL_TZ).strftime('%Y-%m-%d %H:%M:%S')
                         if rit['end_time'] else ''),
            'start_address': rit['start_address'],
            'end_address': rit['end_address'],
            'start_lat': rit['start_latitude'],
            'start_lng': rit['start_longitude'],
            'end_lat': rit['end_latitude'],
            'end_lng': rit['end_longitude'],
            # Radius houdt geen kilometerstand bij, alleen de afstand per rit.
            'start_km': 0,
            'end_km': 0,
            'distance_km': round(afstand, 1),
            'duration_seconds': duur,
            'duration_display': _duur_tekst(duur),
            'is_idle': stilstand,
            # Radius levert geen maximumsnelheid per rit.
            'max_speed': 0,
            'is_speeding': False,
            'start_fuel_level': 0,
            'end_fuel_level': 0,
            'fuel_used_liters': None,
        })

    huidige_positie = None
    if live_positie:
        huidige_positie = {
            'latitude': live_positie.get('latitude'),
            'longitude': live_positie.get('longitude'),
            'speed': live_positie.get('speed') or 0,
            'speed_source': 'live',
            'address': live_positie.get('address') or '',
            'vehicle_status': 'driving' if (live_positie.get('speed') or 0) > 3 else 'parked',
            'fuel_level': 0,
            'fuel_remaining_km': None,
            'heading': live_positie.get('heading'),
            'timestamp': live_positie.get('timestamp') or '',
        }

    resterend = max(0, MAX_RIJTIJD_PER_DAG_SECONDEN - totaal_seconden)

    return {
        'object_id': f'{VOORVOEGSEL}{service_id}',
        'bron': 'radius',
        'bron_ritten': bron_ritten,
        'date': datum.isoformat(),
        'vehicle': {
            'name': kenteken,
            'plate_number': kenteken,
            'make': '',
            'model': '',
        },
        'current_position': huidige_positie,
        'odometer_km': 0,
        'total_distance_km': round(totaal_km, 1),
        'total_duration_seconds': totaal_seconden,
        'total_duration_display': _duur_tekst(totaal_seconden),
        'idle_duration_seconds': stilstand_seconden,
        'idle_duration_display': _duur_tekst(stilstand_seconden),
        'engine_duration_seconds': totaal_seconden + stilstand_seconden,
        'engine_duration_display': _duur_tekst(totaal_seconden + stilstand_seconden),
        'max_speed': 0,
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
        # Radius levert geen losse GPS-punten, alleen begin- en eindpunt per
        # rit. Een lijn daartussen zou een route suggereren die niet gemeten
        # is, dus die tekenen we niet.
        'route_coordinates': [],
    }

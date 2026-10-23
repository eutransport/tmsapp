"""Ritten voor het opdrachtgeversportaal, uit de bron die de wagen werkelijk volgt.

Linqo levert de GPS-ritten. Radius dient alleen als terugval voor wagens die
niet in Linqo staan; die gegevens komen daar uit de tolregistratie en geven een
grover beeld.
"""
import logging
from datetime import datetime, time, timedelta
from datetime import timezone as dt_timezone

from django.core.cache import cache
from django.utils import timezone

from apps.tracking.models import RadiusJourney

logger = logging.getLogger(__name__)

OBJECTEN_CACHE_SLEUTEL = 'portaal:linqo-objecten'
OBJECTEN_CACHE_SECONDEN = 300


def normaliseer(kenteken):
    return (kenteken or '').upper().replace('-', '').replace(' ', '')


def linqo_objecten():
    """Genormaliseerd kenteken naar het object-id waaronder Linqo de wagen kent."""
    gecachet = cache.get(OBJECTEN_CACHE_SLEUTEL)
    if gecachet is not None:
        return gecachet

    from apps.tracking.tachograph_service import FMTrackError, get_objects

    try:
        objecten = get_objects()
    except FMTrackError as fout:
        logger.warning('Portaal: Linqo-objecten niet op te halen: %s', fout)
        return {}
    except Exception:
        logger.exception('Portaal: onverwachte fout bij het ophalen van Linqo-objecten')
        return {}

    kaart = {}
    for obj in objecten:
        params = obj.get('vehicle_params') or {}
        plaat = params.get('plate_number') or obj.get('name') or ''
        sleutel = normaliseer(plaat)
        if sleutel and obj.get('id'):
            kaart[sleutel] = {'object_id': obj['id'], 'kenteken': plaat}

    cache.set(OBJECTEN_CACHE_SLEUTEL, kaart, OBJECTEN_CACHE_SECONDEN)
    return kaart


def _lokaal(waarde):
    """Linqo levert tijden in UTC; het portaal toont ze in de Nederlandse tijd."""
    if not waarde:
        return None
    tekst = str(waarde).replace('Z', '+00:00')
    try:
        moment = datetime.fromisoformat(tekst)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt_timezone.utc)
    return timezone.localtime(moment)


def _linqo_ritten(object_id, kenteken, vanaf, tot):
    from apps.tracking.tachograph_service import FMTrackError, _format_address, get_trips

    begin = timezone.make_aware(datetime.combine(vanaf, time.min))
    eind = timezone.make_aware(datetime.combine(tot, time.max))

    try:
        ruw = get_trips(object_id, begin.astimezone(dt_timezone.utc), eind.astimezone(dt_timezone.utc))
    except FMTrackError as fout:
        logger.warning('Portaal: Linqo-ritten van %s niet op te halen: %s', kenteken, fout)
        return []
    except Exception:
        logger.exception('Portaal: onverwachte fout bij Linqo-ritten van %s', kenteken)
        return []

    ritten = []
    for rit in ruw:
        start = rit.get('trip_start') or {}
        stop = rit.get('trip_end') or {}
        start_op = _lokaal(start.get('datetime'))
        if start_op is None:
            continue
        datum = start_op.date()
        if datum < vanaf or datum > tot:
            continue
        eind_op = _lokaal(stop.get('datetime'))
        ritten.append({
            'id': f'linqo-{object_id}-{start.get("datetime")}',
            'kenteken': kenteken,
            'datum': datum,
            'start_tijd': start_op,
            'eind_tijd': eind_op,
            'start_adres': _format_address(start.get('address')),
            'start_plaats': '',
            'eind_adres': _format_address(stop.get('address')),
            'eind_plaats': '',
            'start_latitude': start.get('latitude'),
            'start_longitude': start.get('longitude'),
            'eind_latitude': stop.get('latitude'),
            'eind_longitude': stop.get('longitude'),
            'afstand_km': round((rit.get('mileage') or 0) / 1000, 1),
            'km_start': round((start.get('mileage') or 0) / 1000, 1) or None,
            'km_eind': round((stop.get('mileage') or 0) / 1000, 1) or None,
            'bron': 'linqo',
        })
    return ritten


def _radius_ritten(kentekens, vanaf, tot):
    gevraagd = {normaliseer(k) for k in kentekens}
    rijen = (RadiusJourney.objects
             .filter(date__gte=vanaf, date__lte=tot)
             .order_by('date', 'plate_number', 'start_time'))
    return [{
        'id': f'radius-{rit.id}',
        'kenteken': rit.plate_number,
        'datum': rit.date,
        'start_tijd': rit.start_time,
        'eind_tijd': rit.end_time,
        'start_adres': rit.start_address,
        'start_plaats': rit.start_city,
        'eind_adres': rit.end_address,
        'eind_plaats': rit.end_city,
        'start_latitude': rit.start_latitude,
        'start_longitude': rit.start_longitude,
        'eind_latitude': rit.end_latitude,
        'eind_longitude': rit.end_longitude,
        'afstand_km': round(rit.distance_km or 0, 1),
        'km_start': None,
        'km_eind': None,
        'bron': 'radius',
    } for rit in rijen if normaliseer(rit.plate_number) in gevraagd]


def haal_ritten(kentekens, vanaf, tot):
    """Per wagen de ritten uit Linqo, en uit Radius voor wat Linqo niet kent."""
    objecten = linqo_objecten()
    ritten = []
    rest = []

    for kenteken in kentekens:
        object_info = objecten.get(normaliseer(kenteken))
        if object_info:
            ritten.extend(_linqo_ritten(object_info['object_id'], kenteken, vanaf, tot))
        else:
            rest.append(kenteken)

    if rest:
        ritten.extend(_radius_ritten(rest, vanaf, tot))

    ritten.sort(key=lambda r: (r['datum'], r['start_tijd']), reverse=True)
    return ritten


def _live_positie(object_id):
    from apps.tracking.tachograph_service import get_vehicle_locations

    try:
        posities = get_vehicle_locations()
    except Exception:
        logger.warning('Portaal: live positie niet beschikbaar voor %s', object_id)
        return None
    for positie in posities:
        if positie.get('object_id') == object_id:
            return positie
    return None


def dagoverzicht(kenteken, datum):
    """Wat de wagen die dag heeft gedaan, plus of hij nu rijdt of stilstaat."""
    ritten = haal_ritten([kenteken], datum, datum)
    op_volgorde = sorted(ritten, key=lambda r: r['start_tijd'])

    standen = [r['km_start'] for r in op_volgorde if r['km_start']]
    standen += [r['km_eind'] for r in op_volgorde if r['km_eind']]
    eindtijden = [r['eind_tijd'] for r in op_volgorde if r['eind_tijd']]

    object_info = linqo_objecten().get(normaliseer(kenteken))
    positie = _live_positie(object_info['object_id']) if object_info else None
    # De volgdienst laat de snelheid op nul staan; alleen vehicle_status is bruikbaar.
    toestand = (positie or {}).get('vehicle_status') or ''

    return {
        'kenteken': kenteken,
        'datum': datum,
        'bron': op_volgorde[0]['bron'] if op_volgorde else ('linqo' if object_info else 'radius'),
        'ritten': ritten,
        'aantal_ritten': len(ritten),
        'km_start': min(standen) if standen else None,
        'km_eind': max(standen) if standen else None,
        'km_gereden': round(sum(r['afstand_km'] or 0 for r in ritten), 1),
        'eerste_start': op_volgorde[0]['start_tijd'] if op_volgorde else None,
        'laatste_eind': max(eindtijden) if eindtijden else None,
        'rijdt': toestand == 'driving',
        'toestand': toestand,
        'positie_adres': (positie or {}).get('address') or '',
        'positie_moment': (positie or {}).get('timestamp'),
        'latitude': (positie or {}).get('latitude'),
        'longitude': (positie or {}).get('longitude'),
    }

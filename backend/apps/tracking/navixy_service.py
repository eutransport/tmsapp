"""Navixy-volgsysteem: actuele posities en ritgeschiedenis per tracker.

Navixy werkt met een permanente API-sleutel die als ``Authorization: NVX <sleutel>``
wordt meegestuurd. Een sessie-hash uit ``user/auth`` verloopt na dertig dagen en
is daarom ongeschikt voor een koppeling die blijft draaien.

Documentatie: https://www.navixy.com/docs/navixy-api/user-api
"""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import requests

logger = logging.getLogger('tracking')

NL_TZ = ZoneInfo('Europe/Amsterdam')

REQUEST_TIMEOUT = 20

STATES_ENDPOINT = '/tracker/get_states'
LIST_ENDPOINT = '/tracker/list'
TRACK_LIST_ENDPOINT = '/track/list'
TRACK_READ_ENDPOINT = '/track/read'

# Navixy geeft tijden terug in de tijdzone van het account, zonder zone erbij.
# Het account staat op Nederlandse tijd; we rekenen alles direct om naar een
# tijdzonebewuste waarde zodat er verderop nooit met losse tekst gerekend wordt.
NAVIXY_TIJD_FORMAAT = '%Y-%m-%d %H:%M:%S'

# Navixy weigert een te lange periode met foutcode 211. De documentatie noemt
# geen concreet maximum, dus vragen we per veertien dagen op.
MAX_DAGEN_PER_UITVRAAG = 14

# Navixy levert geen straatnaam mee. Die zoeken we er zelf bij, maar alleen
# voor voertuigen die stilstaan: een rijdende wagen is toch onderweg en elke
# meting zou dan een nieuwe opzoeking kosten bij een dienst die om hooguit
# een aanvraag per seconde vraagt.
MAX_ADRESSEN_PER_UITVRAAG = 5

# Foutcodes uit de Navixy-documentatie. Alles buiten deze lijst behandelen we
# als een algemene fout; we geven nooit de ruwe upstream-tekst door aan de
# gebruiker, om te voorkomen dat interne details uitlekken.
AUTH_CODES = {3, 4}          # sleutel ongeldig, herroepen of verlopen
ONBEKEND_CODES = {201, 204, 217}
GEBLOKKEERD_CODES = {208}
LIMIET_CODES = {15}
PERIODE_CODES = {211}        # opgevraagde periode is te lang


class NavixyError(Exception):
    """Fout bij het aanroepen van de Navixy API."""


def _basis_url(koppeling):
    return (koppeling.basis_url or 'https://api.navixy.com/v2').rstrip('/')


def _sleutel(koppeling):
    sleutel = (getattr(koppeling, 'api_key', '') or '').strip()
    if not sleutel:
        raise NavixyError(f"De koppeling '{koppeling.naam}' heeft geen API-sleutel.")
    return sleutel


def _aanroep(koppeling, endpoint, payload=None):
    """Doe een aanroep naar Navixy en geef de JSON terug, of gooi NavixyError."""
    url = f'{_basis_url(koppeling)}{endpoint}'
    try:
        antwoord = requests.post(
            url,
            json=payload or {},
            timeout=REQUEST_TIMEOUT,
            headers={
                # De sleutel hoort in de header, niet in de URL: een query
                # parameter belandt in logboeken en bij tussenliggende proxies.
                'Authorization': f'NVX {_sleutel(koppeling)}',
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        )
    except requests.exceptions.RequestException as fout:
        logger.error('Navixy verbindingsfout op %s: %s', endpoint, fout)
        raise NavixyError('Kan geen verbinding maken met Navixy.')

    try:
        gegevens = antwoord.json()
    except ValueError:
        logger.error('Navixy gaf een onleesbaar antwoord op %s (status %s)',
                     endpoint, antwoord.status_code)
        raise NavixyError('Navixy gaf een onverwacht antwoord.')

    if gegevens.get('success'):
        return gegevens

    status = gegevens.get('status') or {}
    code = status.get('code')
    logger.warning('Navixy weigerde %s met code %s', endpoint, code)

    if code in AUTH_CODES:
        raise NavixyError('De Navixy API-sleutel is ongeldig of ingetrokken.')
    if code in ONBEKEND_CODES:
        raise NavixyError('Navixy kent dit tracker-nummer niet op dit account.')
    if code in GEBLOKKEERD_CODES:
        raise NavixyError('De tracker is geblokkeerd bij Navixy; controleer het abonnement.')
    if code in LIMIET_CODES:
        raise NavixyError('Navixy weigert tijdelijk meer aanvragen; probeer het later opnieuw.')
    if code in PERIODE_CODES:
        raise NavixyError('De opgevraagde periode is te lang voor Navixy.')
    raise NavixyError('Navixy gaf een foutmelding terug.')


def get_trackers(koppeling):
    """De trackers die bij deze sleutel horen, met hun label."""
    gegevens = _aanroep(koppeling, LIST_ENDPOINT)
    resultaat = []
    for tracker in gegevens.get('list') or []:
        bron = tracker.get('source') or {}
        resultaat.append({
            'tracker_id': tracker.get('id'),
            'label': tracker.get('label') or '',
            'model': bron.get('model') or '',
            'geblokkeerd': bool(bron.get('blocked')),
        })
    return resultaat


def test_connection(koppeling):
    """Controleer of de sleutel werkt; geeft het aantal gevonden trackers terug."""
    trackers = get_trackers(koppeling)
    return {'trackers': len(trackers)}


def _status_naar_toestand(state, snelheid):
    """Vertaal de Navixy-toestand naar dezelfde woorden als de andere bronnen."""
    beweging = state.get('movement_status')
    if beweging == 'moving' or (snelheid or 0) > 3:
        return 'driving'
    if state.get('ignition'):
        return 'idle'
    return 'parked'


def _positie_van(state, tracker):
    """Zet één Navixy-toestand om naar het positieformaat van de applicatie."""
    gps = state.get('gps') or {}
    locatie = gps.get('location') or {}
    lat = locatie.get('lat')
    lng = locatie.get('lng')
    if lat is None or lng is None:
        return None

    snelheid = gps.get('speed') or 0
    ontsteking = state.get('ignition')
    return {
        # Eigen naamruimte, zodat een Navixy-nummer nooit verward wordt met
        # een object-id uit een ander volgsysteem.
        'object_id': f'navixy:{tracker.tracker_id}',
        'bron': 'navixy',
        'vehicle_name': tracker.omschrijving or tracker.kenteken,
        'plate_number': tracker.kenteken,
        'latitude': lat,
        'longitude': lng,
        'address': '',
        'timestamp': gps.get('updated') or state.get('last_update') or '',
        'speed': snelheid,
        'heading': gps.get('heading') or 0,
        'ignition': bool(ontsteking) if ontsteking is not None else None,
        'vehicle_status': _status_naar_toestand(state, snelheid),
        'fuel_level': 0,
        'fuel_remaining_km': None,
    }


def _tijd_van(tekst):
    """Zet een Navixy-tijd om naar een tijdzonebewuste waarde, of None."""
    if not tekst:
        return None
    try:
        naief = datetime.strptime(str(tekst).strip(), NAVIXY_TIJD_FORMAAT)
    except (ValueError, TypeError):
        logger.warning('Navixy gaf een onbegrijpelijke tijd: %r', tekst)
        return None
    return naief.replace(tzinfo=NL_TZ)


def _rit_van(track, tracker):
    """Zet één Navixy-track om naar het ritformaat van de applicatie.

    Alleen ritten met een eigen id, een begin en een eind zijn bruikbaar.
    Navixy geeft ook losse meldingen (``single_report``) en samengevoegde
    blokken zonder id terug; die slaan we over.
    """
    track_id = track.get('id')
    if track_id is None or track.get('type') != 'regular':
        return None

    start = _tijd_van(track.get('start_date'))
    eind = _tijd_van(track.get('end_date'))
    if start is None or eind is None:
        return None

    duur = int((eind - start).total_seconds())
    if duur < 0:
        logger.warning('Navixy-rit %s eindigt voor de start; overgeslagen', track_id)
        return None

    return {
        'track_id': int(track_id),
        'plate_number': tracker.kenteken,
        'date': start.date(),
        'start_time': start,
        'end_time': eind,
        'start_address': (track.get('start_address') or '')[:255],
        'end_address': (track.get('end_address') or '')[:255],
        # Navixy geeft bij een rit alleen een omhullende rechthoek, geen begin-
        # en eindpunt. Die hoekpunten zijn niet waar de wagen stond, dus laten
        # we de coordinaten leeg; de echte punten komen uit /track/read.
        'start_latitude': None,
        'start_longitude': None,
        'end_latitude': None,
        'end_longitude': None,
        # Navixy documenteert de lengte uitdrukkelijk in kilometers.
        'distance_km': float(track.get('length') or 0),
        'duration_seconds': duur,
        'max_speed': float(track.get('max_speed') or 0),
        'avg_speed': float(track.get('avg_speed') or 0),
    }


def get_journeys(tracker, van, tot):
    """Haal de ritten van één tracker op tussen twee tijdstippen.

    Lange periodes worden opgeknipt, omdat Navixy een te lange periode weigert
    met foutcode 211.
    """
    if van >= tot:
        return []

    ritten = []
    gezien = set()
    blok_start = van
    while blok_start < tot:
        blok_eind = min(blok_start + timedelta(days=MAX_DAGEN_PER_UITVRAAG), tot)
        gegevens = _aanroep(tracker.koppeling, TRACK_LIST_ENDPOINT, {
            'tracker_id': int(tracker.tracker_id),
            'from': blok_start.astimezone(NL_TZ).strftime(NAVIXY_TIJD_FORMAAT),
            'to': blok_eind.astimezone(NL_TZ).strftime(NAVIXY_TIJD_FORMAAT),
            # Losse ritten in plaats van een samengevoegd blok; alleen zo
            # krijgen we per rit een eigen id om dubbelen te herkennen.
            'split': True,
            'filter': True,
            # Adressen laten we juist wel komen: die hoeven we dan niet zelf
            # op te zoeken bij een externe dienst.
            'omit_addresses': False,
        })

        if gegevens.get('limit_exceeded'):
            logger.warning(
                'Navixy kortte de periode in voor tracker %s; het abonnement '
                'bewaart niet zo ver terug.', tracker.tracker_id,
            )

        for track in gegevens.get('list') or []:
            rit = _rit_van(track, tracker)
            if rit and rit['track_id'] not in gezien:
                gezien.add(rit['track_id'])
                ritten.append(rit)

        blok_start = blok_eind

    return ritten


def controleer_accountstijd(gegevens):
    """Waarschuw als het Navixy-account niet op onze tijdzone staat.

    Navixy geeft tijden zonder zone-aanduiding, in de tijdzone van het account.
    Wij lezen ze als Nederlandse tijd. Staat het account anders ingesteld, dan
    schuiven alle ritten stilletjes; dat willen we in het logboek zien.
    """
    accountstijd = _tijd_van(gegevens.get('user_time'))
    if accountstijd is None:
        return None
    afwijking = abs((accountstijd - datetime.now(NL_TZ)).total_seconds())
    if afwijking > 3600:
        logger.error(
            'De Navixy-accountklok wijkt %.1f uur af van de Nederlandse tijd. '
            'Controleer de tijdzone van het Navixy-account; ritten kunnen '
            'anders verschoven worden opgeslagen.', afwijking / 3600,
        )
    return afwijking


def get_track_points(tracker, van, tot, point_limit=2000):
    """De ruwe GPS-punten van een tracker in een periode.

    Gebruikt voor de kaartlijn in het voertuigdetailscherm. Navixy kent geen
    eigen id per punt, dus deze punten worden niet opgeslagen maar per keer
    opgehaald.
    """
    if van >= tot:
        return []

    gegevens = _aanroep(tracker.koppeling, TRACK_READ_ENDPOINT, {
        'tracker_id': int(tracker.tracker_id),
        'from': van.astimezone(NL_TZ).strftime(NAVIXY_TIJD_FORMAAT),
        'to': tot.astimezone(NL_TZ).strftime(NAVIXY_TIJD_FORMAAT),
        'simplify': True,
        'point_limit': max(2, min(int(point_limit), 3000)),
    })

    punten = []
    for punt in gegevens.get('list') or []:
        lat = punt.get('lat')
        lng = punt.get('lng')
        if lat is None or lng is None:
            continue
        tijd = _tijd_van(punt.get('get_time'))
        punten.append({
            'lat': float(lat),
            'lng': float(lng),
            'speed': punt.get('speed') or 0,
            'timestamp': tijd.isoformat() if tijd else '',
        })
    return punten


def _adressen_aanvullen(posities):
    """Zoek de straatnaam erbij voor voertuigen die stilstaan.

    Een mislukte of trage adresdienst mag de posities nooit tegenhouden; in dat
    geval blijft het adres gewoon leeg.
    """
    from apps.loadlist.services.geocoding import reverse_geocode

    gedaan = 0
    for positie in posities:
        if gedaan >= MAX_ADRESSEN_PER_UITVRAAG:
            break
        if positie.get('address') or positie.get('vehicle_status') == 'driving':
            continue
        try:
            adres = reverse_geocode(positie['latitude'], positie['longitude'])
        except Exception:
            logger.exception('Adres opzoeken mislukt voor %s', positie.get('plate_number'))
            continue
        gedaan += 1
        if adres:
            positie['address'] = adres
    return posities


def get_vehicle_locations(koppeling=None):
    """Actuele posities van alle ingestelde Navixy-trackers.

    Geeft dezelfde velden terug als de andere volgsystemen, zodat de rest van
    de applicatie geen onderscheid hoeft te maken. Zonder actieve koppeling of
    trackers is het resultaat leeg en wordt Navixy niet aangeroepen.
    """
    from .models import NavixyConnection, NavixyTracker

    if koppeling is None:
        koppelingen = list(NavixyConnection.objects.filter(actief=True))
    else:
        koppelingen = [koppeling]

    posities = []
    for verbinding in koppelingen:
        trackers = list(
            NavixyTracker.objects.filter(koppeling=verbinding, actief=True)
            .exclude(kenteken='')
        )
        if not trackers:
            continue

        per_nummer = {str(t.tracker_id): t for t in trackers}
        gegevens = _aanroep(verbinding, STATES_ENDPOINT, {
            'trackers': [t.tracker_id for t in trackers],
            # Een geblokkeerde of verwijderde tracker mag de hele uitvraag niet
            # laten mislukken; die komt dan apart terug en slaan we over.
            'list_blocked': True,
            'allow_not_exist': True,
        })

        controleer_accountstijd(gegevens)

        for nummer, state in (gegevens.get('states') or {}).items():
            tracker = per_nummer.get(str(nummer))
            if tracker is None or not state:
                continue
            positie = _positie_van(state, tracker)
            if positie is not None:
                posities.append(positie)

        for ontbrekend in (gegevens.get('not_exist') or []):
            logger.warning('Navixy kent tracker %s niet (koppeling %s)',
                           ontbrekend, verbinding.naam)
        for geblokkeerd in (gegevens.get('blocked') or []):
            logger.warning('Navixy-tracker %s is geblokkeerd (koppeling %s)',
                           geblokkeerd, verbinding.naam)

    return _adressen_aanvullen(posities)

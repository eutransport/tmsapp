"""Navixy-volgsysteem: actuele posities per tracker.

Navixy werkt met een permanente API-sleutel die als ``Authorization: NVX <sleutel>``
wordt meegestuurd. Een sessie-hash uit ``user/auth`` verloopt na dertig dagen en
is daarom ongeschikt voor een koppeling die blijft draaien.

Documentatie: https://www.navixy.com/docs/navixy-api/user-api
"""
import logging

import requests

logger = logging.getLogger('tracking')

REQUEST_TIMEOUT = 20

STATES_ENDPOINT = '/tracker/get_states'
LIST_ENDPOINT = '/tracker/list'

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

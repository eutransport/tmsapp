"""
Radius Velocity (VelocityFleet) telematics API service.

De koppeling werkt met een refresh token dat de klant uit het Radius Velocity
Portal haalt (Account > API integratie). Dat refresh token wordt ingewisseld
voor een kortlevend JWT access token, dat als ``Authorization: Bearer <token>``
wordt meegestuurd bij alle verdere aanroepen.

API docs: https://api-docs.velocityfleet.com/
"""
import base64
import json
import logging
import re
import time
from datetime import date, datetime

import requests
from django.core.cache import cache
from django.utils import timezone
from django.utils.dateparse import parse_datetime

logger = logging.getLogger(__name__)

RADIUS_HOST = 'https://www.velocityfleet.com'
RADIUS_BASE_URL = f'{RADIUS_HOST}/vapi/v1'
REQUEST_TIMEOUT = 30
# Live posities kunnen bij grote wagenparken traag zijn.
LIVE_TIMEOUT = 90

VERIFY_ENDPOINT = '/accounts/users/oauth2/verify/'
REFRESH_ENDPOINT = '/accounts/users/oauth2/refresh/'
CUSTOMERS_ENDPOINT = '/accounts/users/customers/'
JOURNEYS_ENDPOINT = '/telematics/journeys/summary/'
LIVE_POSITIONS_PATH = '/api/mobile/kinesis/device-live-positions/'

# Het ophalen van ritten over een lange periode duurt langer.
JOURNEYS_TIMEOUT = 180
# Radius accepteert grote pagina's; 1000 houdt de responses hanteerbaar.
JOURNEYS_PAGE_SIZE = 1000
# Harde bovengrens zodat een onverwacht antwoord nooit een oneindige lus geeft.
JOURNEYS_MAX_PAGES = 50
# Radius bewaart ongeveer 30 dagen ritgeschiedenis. Ruimere periodes leveren
# niet meer op, dus we begrenzen het verzoek.
JOURNEYS_MAX_DAGEN = 31

# Cachesleutel voor het access token.
_ACCESS_TOKEN_CACHE_KEY = 'radius_access_token'
# Marge in seconden waarmee we het token vóór het verlopen vernieuwen.
_EXPIRY_MARGIN = 300

# Klant-id's zijn numerieke strings; we staan niets anders toe in een URL.
_CUSTOMER_ID_RE = re.compile(r'^\d{1,32}$')


class RadiusError(Exception):
    """Fout bij het aanroepen van de Radius Velocity API."""
    pass


def _get_refresh_token():
    """Haal het Radius refresh token uit de app-instellingen."""
    from apps.core.models import AppSettings
    app_settings = AppSettings.get_settings()
    token = getattr(app_settings, 'radius_api_token', '') or ''
    token = token.strip()
    if not token:
        raise RadiusError(
            'Radius API token is niet geconfigureerd. '
            'Ga naar Instellingen > Koppelingen om het token in te stellen.'
        )
    return token


def _post(endpoint, payload):
    """Doe een POST naar de Radius API zonder authenticatieheader."""
    url = f'{RADIUS_BASE_URL}{endpoint}'
    try:
        response = requests.post(
            url,
            json=payload,
            timeout=REQUEST_TIMEOUT,
            headers={'Accept': 'application/json'},
        )
    except requests.exceptions.RequestException as exc:
        logger.error('Radius API verbindingsfout op %s: %s', endpoint, exc)
        raise RadiusError('Kan geen verbinding maken met de Radius API.')

    if response.status_code in (401, 403):
        raise RadiusError('Het Radius API token is ongeldig of verlopen.')
    if response.status_code >= 400:
        # Bewust geen upstream-body doorgeven aan de gebruiker.
        logger.error(
            'Radius API fout op %s: %s %s',
            endpoint, response.status_code, response.text[:500],
        )
        raise RadiusError(f'Radius API gaf een fout ({response.status_code}).')

    try:
        return response.json()
    except ValueError:
        logger.error('Radius API gaf geen JSON terug op %s', endpoint)
        raise RadiusError('Onverwacht antwoord van de Radius API.')


def _jwt_expiry(token):
    """Lees het ``exp``-veld uit een JWT. Geeft None bij een onleesbaar token."""
    try:
        payload = token.split('.')[1]
        payload += '=' * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload).decode('utf-8'))
        return float(data.get('exp')) if data.get('exp') else None
    except Exception:
        return None


def get_access_token(force_refresh=False):
    """
    Wissel het refresh token in voor een access token.

    Het access token wordt gecachet tot kort voor het verloopt, zodat niet elke
    aanroep een extra netwerkrondje kost.
    """
    if not force_refresh:
        cached = cache.get(_ACCESS_TOKEN_CACHE_KEY)
        if cached:
            return cached

    refresh_token = _get_refresh_token()
    data = _post(REFRESH_ENDPOINT, {'token': refresh_token})
    access_token = data.get('token')
    if not access_token:
        raise RadiusError('Radius API gaf geen access token terug.')

    expiry = _jwt_expiry(access_token)
    ttl = int(expiry - time.time() - _EXPIRY_MARGIN) if expiry else 3600
    if ttl > 0:
        cache.set(_ACCESS_TOKEN_CACHE_KEY, access_token, ttl)
    return access_token


def api_get(endpoint, params=None, timeout=REQUEST_TIMEOUT):
    """
    Doe een geauthenticeerde GET naar de Radius API (``/vapi/v1``).

    Let op: de Radius API eist een afsluitende slash; zonder slash volgt een 401.
    """
    return _api_request('GET', f'{RADIUS_BASE_URL}{_veilig_pad(endpoint)}', params=params, timeout=timeout)


def api_post(url_pad, params=None, timeout=REQUEST_TIMEOUT):
    """Doe een geauthenticeerde POST naar een pad op de Radius host."""
    return _api_request('POST', f'{RADIUS_HOST}{_veilig_pad(url_pad)}', params=params, timeout=timeout)


def _veilig_pad(pad):
    """Controleer dat een pad geen padmanipulatie of hostwissel bevat."""
    if not pad.startswith('/') or '..' in pad or '//' in pad or '\\' in pad:
        raise RadiusError('Ongeldig Radius endpoint.')
    return pad


def _api_request(methode, url, params=None, timeout=REQUEST_TIMEOUT):
    """
    Voer een geauthenticeerde aanroep uit.

    Bij een 401 wordt het access token eenmalig vernieuwd en de aanroep herhaald.
    """
    for poging in range(2):
        token = get_access_token(force_refresh=(poging == 1))
        try:
            response = requests.request(
                methode,
                url,
                params=params or {},
                timeout=timeout,
                headers={
                    'Authorization': f'Bearer {token}',
                    'Accept': 'application/json',
                },
            )
        except requests.exceptions.RequestException as exc:
            logger.error('Radius API verbindingsfout op %s: %s', url, exc)
            raise RadiusError('Kan geen verbinding maken met de Radius API.')

        if response.status_code == 401 and poging == 0:
            cache.delete(_ACCESS_TOKEN_CACHE_KEY)
            continue

        if response.status_code in (401, 403):
            raise RadiusError('Geen toegang tot dit onderdeel van de Radius API.')
        if response.status_code >= 400:
            logger.error(
                'Radius API fout op %s: %s %s',
                url, response.status_code, response.text[:500],
            )
            raise RadiusError(f'Radius API gaf een fout ({response.status_code}).')

        try:
            return response.json()
        except ValueError:
            logger.error('Radius API gaf geen JSON terug op %s', url)
            raise RadiusError('Onverwacht antwoord van de Radius API.')

    raise RadiusError('Authenticatie bij de Radius API is mislukt.')


def test_connection():
    """
    Controleer of het ingestelde token geldig is.

    Geeft een dict terug met het tokentype zoals Radius dat rapporteert.
    """
    refresh_token = _get_refresh_token()
    data = _post(VERIFY_ENDPOINT, {'token': refresh_token})

    # Het access token meteen ophalen zodat we ook die stap controleren.
    get_access_token(force_refresh=True)

    return {
        'ok': True,
        'token_type': data.get('token_type') or 'onbekend',
        'is_distributor': bool(data.get('is_distributor')),
    }


def get_customers():
    """
    Haal de klanten op die aan het token gekoppeld zijn.

    De API geeft een dict terug met het klant-id als sleutel. We maken er een
    platte lijst van en voegen een ``products``-lijst toe.
    """
    data = api_get(CUSTOMERS_ENDPOINT)
    if not isinstance(data, dict):
        raise RadiusError('Onverwacht antwoord bij het ophalen van Radius klanten.')

    klanten = []
    for klant_id, klant in data.items():
        if not isinstance(klant, dict):
            continue
        producten = klant.get('product') or {}
        klanten.append({
            'id': str(klant.get('id') or klant_id),
            'name': klant.get('name') or '',
            'number': klant.get('number') or '',
            'country': klant.get('country') or '',
            'contact_name': klant.get('contact_name') or '',
            'parent_name': klant.get('parent_name') or '',
            'products': sorted(str(v) for v in producten.values()) if isinstance(producten, dict) else [],
        })
    klanten.sort(key=lambda k: k['name'])
    return klanten


def get_telematics_customers():
    """Alleen de klanten waar het Telematics-product actief is."""
    return [k for k in get_customers() if 'Telematics' in k['products']]


def _valideer_klant_id(customer_id):
    klant_id = str(customer_id or '').strip()
    if not _CUSTOMER_ID_RE.match(klant_id):
        raise RadiusError('Ongeldig Radius klant-id.')
    return klant_id


def get_live_positions(customer_id):
    """
    Haal de laatst bekende positie van alle telematics-apparaten van een klant.

    Geeft de ruwe respons van Radius terug; gebruik :func:`get_vehicles` voor
    een opgeschoonde lijst.
    """
    klant_id = _valideer_klant_id(customer_id)
    return api_post(
        LIVE_POSITIONS_PATH,
        params={'customer': klant_id, 'useUTC': ''},
        timeout=LIVE_TIMEOUT,
    )


def _verzamel_devices(data):
    """Haal alle apparaten uit de respons, zowel los als uit groepen."""
    gezien = set()
    devices = []
    for device in (data.get('devices') or []):
        if isinstance(device, dict) and device.get('id') not in gezien:
            gezien.add(device.get('id'))
            devices.append(device)
    for groep in (data.get('device_groups') or []):
        for device in (groep.get('devices') or []):
            if isinstance(device, dict) and device.get('id') not in gezien:
                gezien.add(device.get('id'))
                devices.append(device)
    return devices


def _naar_float(waarde):
    try:
        return float(waarde)
    except (TypeError, ValueError):
        return None


def _adres(device):
    delen = [device.get('street'), device.get('post_code'), device.get('town'), device.get('country')]
    return ', '.join(str(d).strip() for d in delen if d and str(d).strip())


def get_devices(customer_id):
    """
    Geef een opgeschoonde lijst van alle telematics-apparaten met hun laatst
    bekende positie. Een voertuig kan meerdere apparaten hebben.

    Chauffeursnamen die Radius zelf verzint ("Driver of 06-BZF-5") worden
    leeggelaten, zodat de app niet doet alsof er een chauffeur bekend is.
    """
    data = get_live_positions(customer_id)

    apparaten = []
    for device in _verzamel_devices(data):
        kenteken = (device.get('vehicle_registration') or '').strip()
        chauffeur = (device.get('driver_name') or '').strip()
        if kenteken and chauffeur.lower() == f'driver of {kenteken}'.lower():
            chauffeur = ''

        tijdstip = device.get('timestamp')
        try:
            tijdstip = int(tijdstip) if tijdstip not in (None, '') else None
        except (TypeError, ValueError):
            tijdstip = None

        apparaten.append({
            'device_id': device.get('id'),
            'service_id': device.get('service_id') or '',
            'plate_number': kenteken,
            'driver_name': chauffeur,
            'driver_id': device.get('driver_id') or '',
            'latitude': _naar_float(device.get('lat')),
            'longitude': _naar_float(device.get('lon')),
            'speed': _naar_float(device.get('speed')) or 0,
            'speed_unit': device.get('speed_measure_text') or 'KM/H',
            'heading': _naar_float(device.get('direction')) or 0,
            'ignition': (device.get('ignition') or '').upper() == 'Y',
            'street': device.get('street') or '',
            'town': device.get('town') or '',
            'post_code': device.get('post_code') or '',
            'country': device.get('country') or '',
            'address': _adres(device),
            'timestamp': tijdstip,
            'group_color': device.get('group_color') or '',
            'is_private': bool(device.get('private')),
        })

    apparaten.sort(key=lambda d: (d['plate_number'] == '', d['plate_number'], -(d['timestamp'] or 0)))
    return {
        'devices': apparaten,
        'device_count': data.get('device_count'),
        # Radius geeft de ververssnelheid in milliseconden (30000 = 30 seconden).
        'refresh_rate_ms': data.get('KINESIS_LIVE_MAP_REFRESH_RATE'),
    }


def get_vehicles(customer_id):
    """
    Geef één regel per voertuig (kenteken) met de meest recente positie.

    Een voertuig kan meerdere trackers hebben; die worden onder ``devices``
    meegegeven zodat er geen gegevens verloren gaan.
    """
    ruw = get_devices(customer_id)

    per_kenteken = {}
    zonder_kenteken = []
    for apparaat in ruw['devices']:
        kenteken = apparaat['plate_number']
        if not kenteken:
            zonder_kenteken.append(apparaat)
            continue
        per_kenteken.setdefault(kenteken, []).append(apparaat)

    voertuigen = []
    for kenteken, apparaten in per_kenteken.items():
        apparaten.sort(key=lambda d: d['timestamp'] or 0, reverse=True)
        nieuwste = dict(apparaten[0])
        nieuwste['devices'] = apparaten
        nieuwste['device_count'] = len(apparaten)
        voertuigen.append(nieuwste)

    for apparaat in zonder_kenteken:
        los = dict(apparaat)
        los['devices'] = [apparaat]
        los['device_count'] = 1
        voertuigen.append(los)

    voertuigen.sort(key=lambda v: (v['plate_number'] == '', v['plate_number']))
    return {
        'vehicles': voertuigen,
        'count': len(voertuigen),
        'device_count': ruw['device_count'],
        'refresh_rate_ms': ruw['refresh_rate_ms'],
    }


# ---------------------------------------------------------------------------
# Ritgeschiedenis
# ---------------------------------------------------------------------------

def valideer_datum(waarde, naam):
    """Accepteer alleen een date of een strikte YYYY-MM-DD string."""
    if isinstance(waarde, datetime):
        return waarde.date()
    if isinstance(waarde, date):
        return waarde
    tekst = str(waarde or '').strip()
    try:
        return datetime.strptime(tekst, '%Y-%m-%d').date()
    except ValueError:
        raise RadiusError(f'Ongeldige {naam}; gebruik het formaat JJJJ-MM-DD.')


def _valideer_periode(van, tot):
    """Controleer de periode en begrens hem op wat Radius bewaart."""
    van = valideer_datum(van, 'begindatum')
    tot = valideer_datum(tot, 'einddatum')
    if van > tot:
        raise RadiusError('De begindatum ligt na de einddatum.')
    if (tot - van).days + 1 > JOURNEYS_MAX_DAGEN:
        raise RadiusError(
            f'De periode mag maximaal {JOURNEYS_MAX_DAGEN} dagen beslaan; '
            'Radius bewaart niet meer geschiedenis.'
        )
    return van, tot


def _naar_tijdstip(waarde):
    """Zet een naïeve ISO-tijd van Radius om naar een aware datetime."""
    if not waarde:
        return None
    tijdstip = parse_datetime(str(waarde))
    if tijdstip is None:
        return None
    if timezone.is_naive(tijdstip):
        tijdstip = timezone.make_aware(tijdstip, timezone.get_current_timezone())
    return tijdstip


def _normaliseer_rit(rit):
    """
    Zet één rit van Radius om naar onze veldnamen.

    Let op: het veld heet ``milesTravelled`` maar bevat kilometers. Dat is
    geverifieerd tegen het Radius-portaal, waar dezelfde getallen onder de
    kolom "Afstand (kilometers)" staan.
    """
    kenteken = (rit.get('vehicleRegistration') or '').strip()
    chauffeur = (rit.get('driverName') or '').strip()
    if kenteken and chauffeur.lower() == f'driver of {kenteken}'.lower():
        chauffeur = ''

    return {
        'service_id': (rit.get('serviceId') or '').strip(),
        'plate_number': kenteken,
        'driver_name': chauffeur,
        'start_time': _naar_tijdstip(rit.get('startDateTime')),
        'end_time': _naar_tijdstip(rit.get('endDateTime')),
        'start_latitude': _naar_float(rit.get('startLatitude')),
        'start_longitude': _naar_float(rit.get('startLongitude')),
        'end_latitude': _naar_float(rit.get('endLatitude')),
        'end_longitude': _naar_float(rit.get('endLongitude')),
        'start_address': (rit.get('startLocation') or '').strip(),
        'start_city': (rit.get('startLocationCity') or rit.get('startLocationState') or '').strip(),
        'start_country': (rit.get('startLocationCountry') or '').strip(),
        'end_address': (rit.get('endLocation') or '').strip(),
        'end_city': (rit.get('endLocationCity') or rit.get('endLocationState') or '').strip(),
        'end_country': (rit.get('endLocationCountry') or '').strip(),
        'distance_km': _naar_float(rit.get('milesTravelled')) or 0.0,
        'duration_seconds': int(_naar_float(rit.get('journeyTime')) or 0),
    }


def get_journeys(customer_id, van, tot):
    """
    Haal alle ritten van een klant op tussen twee datums (beide inclusief).

    Radius pagineert; we lopen de pagina's af tot alles binnen is. Ritten
    zonder bruikbaar starttijdstip worden overgeslagen.
    """
    klant_id = _valideer_klant_id(customer_id)
    van, tot = _valideer_periode(van, tot)

    ritten = []
    totalen = {}
    # Let op: de paginering van Radius is 0-gebaseerd. ``page=0`` is de eerste
    # pagina; ``page=1`` levert al de tweede pagina.
    pagina = 0
    while pagina < JOURNEYS_MAX_PAGES:
        data = api_get(JOURNEYS_ENDPOINT, params={
            'customer': klant_id,
            'from': van.isoformat(),
            'to': tot.isoformat(),
            'page': pagina,
            'pageSize': JOURNEYS_PAGE_SIZE,
        }, timeout=JOURNEYS_TIMEOUT)

        if not isinstance(data, dict):
            raise RadiusError('Onverwacht antwoord van Radius bij het ophalen van ritten.')

        if pagina == 0:
            totalen = data.get('summary') or {}

        pagina_ritten = data.get('journeys') or []
        for rit in pagina_ritten:
            if not isinstance(rit, dict):
                continue
            genormaliseerd = _normaliseer_rit(rit)
            if genormaliseerd['start_time'] and genormaliseerd['service_id']:
                ritten.append(genormaliseerd)

        totaal_paginas = data.get('totalPages') or 1
        try:
            totaal_paginas = int(totaal_paginas)
        except (TypeError, ValueError):
            totaal_paginas = 1
        pagina += 1
        if pagina >= totaal_paginas or not pagina_ritten:
            break
    else:
        logger.warning(
            'Radius ritgeschiedenis afgekapt op %s pagina\'s voor klant %s',
            JOURNEYS_MAX_PAGES, klant_id,
        )

    ritten.sort(key=lambda r: (r['start_time'], r['plate_number']), reverse=True)
    return {
        'journeys': ritten,
        'count': len(ritten),
        'total_distance_km': round(_naar_float(totalen.get('totalDistance')) or 0.0, 1),
        'total_duration_seconds': int(_naar_float(totalen.get('totalTravelTime')) or 0),
        'date_from': van.isoformat(),
        'date_to': tot.isoformat(),
    }


def get_journey_summary_per_vehicle(customer_id, van, tot):
    """
    Vat de ritten samen per voertuig, zoals het overzicht in het Radius-portaal:
    afstand, aantal ritten en totale duur per kenteken.
    """
    resultaat = get_journeys(customer_id, van, tot)

    per_kenteken = {}
    for rit in resultaat['journeys']:
        kenteken = rit['plate_number'] or '-'
        regel = per_kenteken.setdefault(kenteken, {
            'plate_number': kenteken,
            'driver_name': rit['driver_name'],
            'distance_km': 0.0,
            'duration_seconds': 0,
            'journey_count': 0,
            'first_start': rit['start_time'],
            'last_end': rit['end_time'],
        })
        regel['distance_km'] += rit['distance_km']
        regel['duration_seconds'] += rit['duration_seconds']
        regel['journey_count'] += 1
        if rit['start_time'] and (not regel['first_start'] or rit['start_time'] < regel['first_start']):
            regel['first_start'] = rit['start_time']
        if rit['end_time'] and (not regel['last_end'] or rit['end_time'] > regel['last_end']):
            regel['last_end'] = rit['end_time']
        if not regel['driver_name'] and rit['driver_name']:
            regel['driver_name'] = rit['driver_name']

    voertuigen = sorted(per_kenteken.values(), key=lambda v: -v['distance_km'])
    for regel in voertuigen:
        regel['distance_km'] = round(regel['distance_km'], 1)

    return {
        'vehicles': voertuigen,
        'count': len(voertuigen),
        'total_distance_km': resultaat['total_distance_km'],
        'total_duration_seconds': resultaat['total_duration_seconds'],
        'journey_count': resultaat['count'],
        'date_from': resultaat['date_from'],
        'date_to': resultaat['date_to'],
    }

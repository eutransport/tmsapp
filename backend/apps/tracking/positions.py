"""Actuele voertuigposities uit alle gekoppelde volgsystemen.

De applicatie haalde posities altijd rechtstreeks bij FM-Track op. Nu er een
tweede bron bij kan komen (Navixy), loopt alles via deze laag, zodat elke
plek die een positie nodig heeft automatisch beide systemen ziet.

Het foutgedrag van vroeger blijft staan: kan FM-Track niets leveren en heeft
Navixy ook niets, dan komt de oorspronkelijke FM-Track-fout gewoon naar boven.
Levert Navixy wél posities, dan is een storing bij FM-Track geen reden om de
hele kaart leeg te laten.
"""
import logging

logger = logging.getLogger('tracking')


def adres_van(positie):
    """Het adres van een positie; ontbreekt het, dan zoeken we het op.

    De lijsten met alle posities slaan rijdende wagens bewust over om de
    adresdienst te sparen. Wie één wagen aanklikt, wil wel weten waar hij is.
    """
    if not positie:
        return ''
    if positie.get('address'):
        return positie['address']
    if positie.get('latitude') is None or positie.get('longitude') is None:
        return ''
    from apps.loadlist.services.geocoding import reverse_geocode
    try:
        return reverse_geocode(positie['latitude'], positie['longitude']) or ''
    except Exception:
        logger.exception('Adres opzoeken mislukt voor %s', positie.get('plate_number'))
        return ''


def locatie_van(positie):
    """Adresdetails plus een Google Maps-link op de exacte coordinaten.

    De link gebruikt altijd de coordinaten zelf, niet het adres: zo opent
    Google Maps precies op de plek waar de wagen staat.
    """
    if not positie or positie.get('latitude') is None or positie.get('longitude') is None:
        return None
    lat, lng = float(positie['latitude']), float(positie['longitude'])
    from apps.loadlist.services.geocoding import reverse_geocode_detail
    try:
        detail = reverse_geocode_detail(lat, lng) or {}
    except Exception:
        logger.exception('Adresdetail opzoeken mislukt voor %s', positie.get('plate_number'))
        detail = {}
    return {
        **detail,
        'op_weg': bool(detail.get('op_weg')),
        'latitude': round(lat, 6),
        'longitude': round(lng, 6),
        'google_maps_url': f'https://www.google.com/maps/search/?api=1&query={lat:.6f},{lng:.6f}',
    }


def get_vehicle_locations(met_radius=False):
    """Posities uit alle bronnen samen, in het formaat van FM-Track.

    Radius alleen op verzoek: de beheerkaart haalt Radius zelf apart op en zou
    die wagens anders dubbel tonen. Het klantportaal heeft alles hier nodig.
    """
    from .navixy_service import NavixyError
    from .navixy_service import get_vehicle_locations as navixy_posities
    from .tachograph_service import FMTrackError
    from .tachograph_service import get_vehicle_locations as fmtrack_posities

    posities = []
    fmtrack_fout = None

    try:
        posities.extend(fmtrack_posities())
    except FMTrackError as fout:
        fmtrack_fout = fout
    except Exception as fout:
        logger.exception('Onverwachte fout bij het ophalen van FM-Track posities')
        fmtrack_fout = FMTrackError(str(fout) or 'FM-Track gaf een onverwachte fout.')

    bekende_kentekens = {
        (p.get('plate_number') or '').upper().replace('-', '').replace(' ', '')
        for p in posities
    }

    try:
        for positie in navixy_posities():
            sleutel = (positie.get('plate_number') or '').upper().replace('-', '').replace(' ', '')
            # Staat de wagen al in een ander systeem, dan is dat de bron die de
            # rest van de applicatie al kent; dubbel tonen zou verwarren.
            if sleutel and sleutel in bekende_kentekens:
                logger.debug('Navixy-positie voor %s overgeslagen: al bekend via FM-Track',
                             positie.get('plate_number'))
                continue
            posities.append(positie)
    except NavixyError as fout:
        logger.warning('Navixy-posities niet beschikbaar: %s', fout)
    except Exception:
        logger.exception('Onverwachte fout bij het ophalen van Navixy-posities')

    if met_radius:
        bekende_kentekens = {
            (p.get('plate_number') or '').upper().replace('-', '').replace(' ', '')
            for p in posities
        }
        for positie in _radius_posities():
            sleutel = (positie.get('plate_number') or '').upper().replace('-', '').replace(' ', '')
            if sleutel and sleutel not in bekende_kentekens:
                posities.append(positie)
                bekende_kentekens.add(sleutel)

    if fmtrack_fout is not None and not posities:
        raise fmtrack_fout

    return posities


def _radius_posities():
    """Radius-posities in hetzelfde formaat als FM-Track; bij storing leeg."""
    from datetime import datetime, timezone as dt_timezone

    from . import radius_service
    from .radius_archive_service import bepaal_klant_id
    from .radius_detail import VOORVOEGSEL

    try:
        koppeling = radius_service.actieve_koppeling('telematics')
        if koppeling is None:
            return []
        voertuigen = radius_service.get_vehicles(
            bepaal_klant_id(connection=koppeling), connection=koppeling)['vehicles']
    except Exception:
        logger.warning('Radius-posities niet beschikbaar', exc_info=True)
        return []

    resultaat = []
    for v in voertuigen:
        if not v.get('plate_number') or v.get('latitude') is None or v.get('longitude') is None:
            continue
        tijdstip = v.get('timestamp')
        if tijdstip:
            # Radius levert epoch-tijd, soms in milliseconden.
            seconden = tijdstip / 1000 if tijdstip > 10**11 else tijdstip
            tijdstip = datetime.fromtimestamp(seconden, tz=dt_timezone.utc).isoformat()
        snelheid = v.get('speed') or 0
        if snelheid > 3:
            toestand = 'driving'
        elif v.get('ignition'):
            toestand = 'idle'
        else:
            toestand = 'parked'
        resultaat.append({
            'object_id': f"{VOORVOEGSEL}{v.get('service_id') or ''}",
            'bron': 'radius',
            'vehicle_name': v['plate_number'],
            'plate_number': v['plate_number'],
            'latitude': v['latitude'],
            'longitude': v['longitude'],
            'address': v.get('address') or '',
            'timestamp': tijdstip or '',
            'speed': snelheid,
            'heading': v.get('heading') or 0,
            'ignition': v.get('ignition'),
            'vehicle_status': toestand,
            'fuel_level': 0,
            'fuel_remaining_km': None,
        })
    return resultaat

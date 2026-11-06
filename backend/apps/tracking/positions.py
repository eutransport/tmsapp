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


def get_vehicle_locations():
    """Posities uit alle bronnen samen, in het formaat van FM-Track."""
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

    if fmtrack_fout is not None and not posities:
        raise fmtrack_fout

    return posities

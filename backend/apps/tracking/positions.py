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

"""Verwachte aankomsttijd van een gestarte opdracht.

Geen Google Maps: het project heeft al gratis geocoding (Nominatim) en een
routeplanner (OSRM), die geen sleutel of abonnement nodig hebben.
"""
import logging
from datetime import timedelta
from math import asin, cos, radians, sin, sqrt

from django.conf import settings
from django.utils import timezone

from apps.loadlist.services.geocoding import geocode
from apps.loadlist.services.osrm import road_matrix

from .models import OpdrachtFase, OpdrachtStatus

logger = logging.getLogger(__name__)

VERVERS_NA_MINUTEN = 10

# Hemelsbreed, niet over de weg: een vrachtwagen die het terrein op rijdt is er,
# ook als de routeplanner nog een stuk eenrichtingsverkeer telt.
AANKOMST_STRAAL_METER = getattr(settings, 'OPDRACHT_AANKOMST_STRAAL_METER', 300)


def _afstand_meter(punt_a, punt_b):
    """Hemelsbrede afstand tussen twee (lat, lng)-punten."""
    straal = 6371000.0
    lat1, lng1 = radians(punt_a[0]), radians(punt_a[1])
    lat2, lng2 = radians(punt_b[0]), radians(punt_b[1])
    deel = sin((lat2 - lat1) / 2) ** 2 + cos(lat1) * cos(lat2) * sin((lng2 - lng1) / 2) ** 2
    return 2 * straal * asin(sqrt(deel))


def _aankomst_bijwerken(opdracht, positie, bestemming):
    """Zet de fase op 'aangekomen' zodra de wagen dicht genoeg bij het adres staat.

    Alleen vooruit: een chauffeur die al wacht of laadt wordt nooit teruggezet.
    """
    if opdracht.fase != OpdrachtFase.ONDERWEG:
        return False
    try:
        afstand = _afstand_meter(
            (float(positie['latitude']), float(positie['longitude'])), bestemming
        )
    except (TypeError, ValueError, KeyError):
        return False
    if afstand > AANKOMST_STRAAL_METER:
        return False

    opdracht.fase = OpdrachtFase.AANGEKOMEN
    opdracht.aangekomen_op = timezone.now()
    opdracht.aangekomen_automatisch = True
    opdracht.save(update_fields=[
        'fase', 'aangekomen_op', 'aangekomen_automatisch', 'updated_at'
    ])
    try:
        from . import push

        push.meld_aangekomen(opdracht)
    except Exception:
        logger.exception('Aankomstmelding kon niet verstuurd worden')
    return True


def _normaliseer(kenteken):
    return (kenteken or '').upper().replace('-', '').replace(' ', '')


def _bestemming(opdracht):
    if opdracht.bestemming_lat is not None and opdracht.bestemming_lng is not None:
        return opdracht.bestemming_lat, opdracht.bestemming_lng

    adres = ' '.join(x for x in [opdracht.adres, opdracht.postcode, opdracht.plaats] if x).strip()
    if not adres:
        return None
    resultaat = geocode(adres, country_hint='nl')
    if resultaat is None:
        return None
    opdracht.bestemming_lat = resultaat.lat
    opdracht.bestemming_lng = resultaat.lng
    opdracht.save(update_fields=['bestemming_lat', 'bestemming_lng'])
    return resultaat.lat, resultaat.lng


def _posities_per_kenteken():
    from apps.tracking.tachograph_service import get_vehicle_locations

    gevonden = {}
    for positie in get_vehicle_locations():
        sleutel = _normaliseer(positie.get('plate_number'))
        if sleutel and positie.get('latitude') is not None:
            gevonden[sleutel] = positie
    return gevonden


def _kenteken_van(opdracht):
    if opdracht.kenteken:
        return opdracht.kenteken
    voertuig = getattr(opdracht.chauffeur, 'voertuig', None)
    return getattr(voertuig, 'kenteken', '') or ''


def _bewaar(opdracht, **velden):
    velden['eta_bijgewerkt_op'] = timezone.now()
    for naam, waarde in velden.items():
        setattr(opdracht, naam, waarde)
    opdracht.save(update_fields=[*velden.keys()])


def ververs(opdrachten, geforceerd=False):
    """Werk de ETA bij van gestarte opdrachten die ouder zijn dan tien minuten."""
    nu = timezone.now()
    te_doen = [
        o for o in opdrachten
        if o.status == OpdrachtStatus.GESTART and (
            geforceerd
            or o.eta_bijgewerkt_op is None
            or (nu - o.eta_bijgewerkt_op).total_seconds() >= VERVERS_NA_MINUTEN * 60
        )
    ]
    if not te_doen:
        return 0

    try:
        posities = _posities_per_kenteken()
    except Exception as fout:
        logger.warning('ETA: GPS-posities niet beschikbaar: %s', fout)
        for opdracht in te_doen:
            _bewaar(opdracht, eta_fout='gps_niet_beschikbaar')
        return 0

    bijgewerkt = 0
    for opdracht in te_doen:
        positie = posities.get(_normaliseer(_kenteken_van(opdracht)))
        if positie is None:
            _bewaar(opdracht, eta_fout='geen_positie')
            continue

        bestemming = _bestemming(opdracht)
        if bestemming is None:
            _bewaar(opdracht, eta_fout='adres_onbekend')
            continue

        _aankomst_bijwerken(opdracht, positie, bestemming)

        punten = [(float(positie['latitude']), float(positie['longitude'])), bestemming]
        try:
            afstanden, duren, _bron = road_matrix(punten)
            seconden = duren[0][1]
            meters = afstanden[0][1]
        except Exception as fout:
            logger.warning('ETA: route mislukt voor %s: %s', opdracht.ritnummer, fout)
            _bewaar(opdracht, eta_fout='route_mislukt')
            continue

        minuten = max(int(round(seconden / 60)), 0)
        _bewaar(
            opdracht,
            eta_minuten=minuten,
            eta_start_minuten=opdracht.eta_start_minuten or minuten,
            eta_afstand_km=round(meters / 1000, 1),
            eta_aankomst=timezone.now() + timedelta(minutes=minuten),
            eta_fout='',
        )
        bijgewerkt += 1

    return bijgewerkt

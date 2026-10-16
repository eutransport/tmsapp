"""Bepaal in welk land een tolpassage plaatsvond.

De bron is het Radius-ritarchief (`RadiusJourney`). Radius levert per rit zelf
het start- en eindland, dus we hoeven niet uit co\u00f6rdinaten of uit het
tolproduct af te leiden waar de wagen reed.

Een rit die de grens oversteekt heeft twee verschillende landen. Omdat Radius
geen tussenliggende posities geeft, schatten we het overgangsmoment naar rato
van de tijd binnen de rit. Zo'n passage krijgt herkomst ``grens`` in plaats van
``gps``, zodat zichtbaar blijft dat het een schatting is en hij handmatig
overschreven kan worden.
"""
import re
from datetime import timedelta

# Radius schrijft landnamen voluit en in de eigen taal.
_LANDCODES = {
    'nederland': 'NL',
    'netherlands': 'NL',
    'holland': 'NL',
    'deutschland': 'DE',
    'germany': 'DE',
    'duitsland': 'DE',
    'belgie': 'BE',
    'belgium': 'BE',
    'belgique': 'BE',
    'luxembourg': 'LU',
    'luxemburg': 'LU',
    'france': 'FR',
    'frankrijk': 'FR',
}

BRON_GPS = 'gps'
BRON_GRENS = 'grens'
BRON_FACTUUR = 'factuur'
BRON_STATION = 'station'
BRON_HANDMATIG = 'handmatig'

LANDNAMEN = {
    'NL': 'Nederland',
    'DE': 'Duitsland',
    'BE': 'Belgie',
    'LU': 'Luxemburg',
    'FR': 'Frankrijk',
}

# De stationsnaam op een Radius-factuur noemt het land vaak zelf. Nederlandse
# passages heten 'Vrachtwagenheffing - NL'; Duitse noemen het wegvak, met
# herkenbare markeringen als 'Bundesgrenze' of een Bundesstrasse-nummer.
_STATION_LANDSUFFIX = re.compile(r'[-\u2013]\s*([A-Z]{2})\s*$')
_STATION_DUITS = re.compile(
    r'bundesgrenze|bundesstra|\bautobahn\b|\b[AB]\d{1,3}\b\s*,', re.IGNORECASE)


def expliciete_landcode(station: str) -> str:
    """De landcode die letterlijk in de stationsnaam staat, zoals '... - NL'."""
    treffer = _STATION_LANDSUFFIX.search((station or '').strip())
    return treffer.group(1) if treffer else ''


def land_uit_station(station: str) -> str:
    """Leid het land af uit de stationsnaam op de factuur; leeg als het onzeker is."""
    tekst = (station or '').strip()
    if not tekst:
        return ''

    expliciet = expliciete_landcode(tekst)
    if expliciet:
        return expliciet

    if 'vrachtwagenheffing' in tekst.lower():
        return 'NL'
    if _STATION_DUITS.search(tekst):
        return 'DE'
    return ''


def normaliseer_kenteken(waarde: str) -> str:
    if not waarde:
        return ''
    return re.sub(r'[^A-Z0-9]', '', waarde.upper())


def landcode(naam: str) -> str:
    """Zet een landnaam van Radius om naar een tweeletterige code."""
    if not naam:
        return ''
    sleutel = naam.strip().lower()
    if sleutel in _LANDCODES:
        return _LANDCODES[sleutel]
    # Soms staat er al een code in het veld.
    kaal = re.sub(r'[^A-Z]', '', naam.upper())
    return kaal if len(kaal) == 2 else ''


def _fractie(rit, moment) -> float:
    """Hoe ver de wagen in de tijd gevorderd was binnen de rit (0..1)."""
    if not rit.end_time or rit.end_time <= rit.start_time:
        return 0.0
    verstreken = (moment - rit.start_time).total_seconds()
    totaal = (rit.end_time - rit.start_time).total_seconds()
    return min(max(verstreken / totaal, 0.0), 1.0)


def land_van_rit(rit, moment):
    """Geef (landcode, herkomst) voor een moment binnen een rit."""
    start = landcode(rit.start_country)
    eind = landcode(rit.end_country)

    if start and eind and start == eind:
        return start, BRON_GPS
    if start and not eind:
        return start, BRON_GPS
    if eind and not start:
        return eind, BRON_GPS
    if not start and not eind:
        return '', ''

    # Grensovergang: voor de helft van de rijtijd rekenen we het vertrekland,
    # daarna het aankomstland. Zonder tussenposities is dit de beste schatting.
    return (start if _fractie(rit, moment) < 0.5 else eind), BRON_GRENS


def zoek_rit(kenteken_genormaliseerd: str, moment, speling_minuten: int = 0):
    """De GPS-rit waarbinnen het moment valt, of None.

    Met `speling_minuten` mag een passage net buiten de rit toch meetellen; dat
    vangt kleine afrondingsverschillen tussen de tolprovider en de tracker op.
    """
    from apps.tracking.models import RadiusJourney

    if not kenteken_genormaliseerd or moment is None:
        return None

    speling = timedelta(minutes=max(0, speling_minuten))
    # Op kenteken filteren kan niet in de database omdat daar streepjes in
    # staan; we beperken eerst op tijd en vergelijken daarna genormaliseerd.
    kandidaten = RadiusJourney.objects.filter(
        start_time__lte=moment + speling,
        end_time__gte=moment - speling,
    ).only(
        'plate_number', 'start_time', 'end_time',
        'start_country', 'end_country', 'distance_km',
    )
    for rit in kandidaten:
        if normaliseer_kenteken(rit.plate_number) == kenteken_genormaliseerd:
            return rit
    return None


def bepaal_land(kenteken_genormaliseerd: str, moment, speling_minuten: int = 0):
    """Geef (landcode, herkomst) voor een tolpassage. Leeg als er geen rit is."""
    rit = zoek_rit(kenteken_genormaliseerd, moment, speling_minuten)
    if rit is None:
        return '', ''
    return land_van_rit(rit, moment)

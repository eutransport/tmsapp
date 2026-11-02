"""
Tolregels lezen uit de Radius fuel-API.

Het kenteken komt uit ``registration``. Dat veld draagt het voertuig van de
passage zelf en is als enige per transactie verschillend.

De graveervelden (``card_embossed_detail_*``) zijn een eigenschap van de
*kaart*, niet van de rit. Dat gaat goed zolang elke wagen een eigen kaart
heeft, maar E&U boekt de hele vloot op één verzamelkaart (54593) waarop
``51-BXN-5`` gegraveerd staat. Wie op die velden vertrouwt, schrijft de tol
van vijftien wagens op één kenteken. Daarom:

* ``registration`` is leidend;
* de graveervelden zijn alleen terugval, en nooit voor een kaart waarop
  meerdere kentekens blijken te rijden (zie :func:`verzamelkaarten`).

Levert dat niets op, dan laten we het kenteken liever leeg: de transactie
komt dan als overgeslagen in het verslag te staan in plaats van stilletjes op
de verkeerde wagen.
"""
import re
from collections import defaultdict

from .models import normalize_plate

EMBOSSED_VELDEN = (
    'card_embossed_detail_1',
    'card_embossed_detail_2',
    'card_embossed_detail_3',
)
EMBOSSED_KAARTVELDEN = ('embossed_line_3', 'embossed_line_4', 'embossed_line_5')

# Minstens twee letters en twee cijfers; zo vallen '.', 'None' en lege
# plaatshouders af, terwijl 'BB-625-L' en '51-BXN-5' blijven staan.
_KENTEKEN = re.compile(r'^[A-Z0-9\-\s]{5,12}$')


def _is_kenteken(waarde) -> bool:
    tekst = str(waarde or '').strip().upper()
    if not tekst or tekst in {'.', 'NONE', '-'}:
        return False
    if not _KENTEKEN.match(tekst):
        return False
    kaal = tekst.replace('-', '').replace(' ', '')
    return sum(c.isalpha() for c in kaal) >= 2 and sum(c.isdigit() for c in kaal) >= 2


def verzamelkaarten(transacties) -> set:
    """Kaartnummers waarop meer dan één kenteken rijdt.

    Zo'n kaart draagt de tol van een hele vloot; het gegraveerde kenteken is
    dan niet meer dan een etiket en mag nooit als terugval dienen.
    """
    per_kaart = defaultdict(set)
    for transactie in transacties:
        kenteken = _registratie(transactie)
        if kenteken:
            per_kaart[transactie.get('card_no')].add(kenteken)
    return {kaart for kaart, kentekens in per_kaart.items() if len(kentekens) > 1}


def _registratie(transactie: dict) -> str:
    """Het kenteken van de transactie zelf, genormaliseerd."""
    waarde = transactie.get('registration')
    return normalize_plate(str(waarde)) if _is_kenteken(waarde) else ''


def kenteken_uit_transactie(transactie: dict, kaarten: dict | None = None,
                            gedeelde_kaarten=()) -> str:
    """
    Geef het kenteken van een transactie, genormaliseerd.

    ``kaarten`` is optioneel een map van kaartnummer naar de kaartgegevens uit
    ``/fuel/cards/``; die wordt gebruikt als de transactie zelf geen bruikbaar
    kenteken bevat. ``gedeelde_kaarten`` bevat de kaartnummers waarop meerdere
    wagens rijden; daarvoor slaan we de graveervelden over.
    """
    kenteken = _registratie(transactie)
    if kenteken:
        return kenteken

    if transactie.get('card_no') in set(gedeelde_kaarten):
        return ''

    for veld in EMBOSSED_VELDEN:
        waarde = transactie.get(veld)
        if _is_kenteken(waarde):
            return normalize_plate(str(waarde))

    kaart = (kaarten or {}).get(transactie.get('card_no'))
    if kaart:
        for veld in EMBOSSED_KAARTVELDEN:
            waarde = kaart.get(veld)
            if _is_kenteken(waarde):
                return normalize_plate(str(waarde))
    return ''


def is_tolregel(transactie: dict) -> bool:
    """Tol herkennen we aan het product, niet aan de kaartnaam."""
    return 'toll' in str(transactie.get('product_description') or '').lower()


def land_uit_transactie(transactie: dict) -> str:
    """Radius levert het land zelf aan; ``site_data`` is de terugval."""
    land = str(transactie.get('country') or '').strip().upper()
    if not land:
        land = str((transactie.get('site_data') or {}).get('country') or '').strip().upper()
    return land if len(land) == 2 else ''


def kaart_index(kaarten: list) -> dict:
    """Map kaartnummer naar kaart, voor het opzoeken van een ontbrekend kenteken."""
    return {kaart.get('card_no'): kaart for kaart in kaarten if kaart.get('card_no') is not None}

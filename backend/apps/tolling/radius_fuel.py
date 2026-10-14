"""
Tolregels lezen uit de Radius fuel-API.

De twee tankkaartaccounts leveren hun kenteken niet op dezelfde plek aan:
Almen zet het in ``card_embossed_detail_1``, E&U in ``card_embossed_detail_2``.
Daarom kijken we naar alle embossed-velden en nemen we de eerste waarde die
een kenteken kan zijn. Het veld ``registration`` wordt bewust genegeerd: bij
E&U staat daar een andere waarde dan op de kaart gegraveerd is.
"""
import re

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


def kenteken_uit_transactie(transactie: dict, kaarten: dict | None = None) -> str:
    """
    Geef het kenteken van een transactie, genormaliseerd.

    ``kaarten`` is optioneel een map van kaartnummer naar de kaartgegevens uit
    ``/fuel/cards/``; die wordt gebruikt als de transactie zelf geen bruikbaar
    kenteken bevat.
    """
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

"""Wekelijks de officiele tariefpagina's nakijken op wijzigingen.

De drie heffingen hebben elk hun eigen site. Die pagina's uitlezen en de
tarieven er blind uit overnemen is te riskant: verandert de opmaak, dan komt
er stilletjes een verkeerd bedrag op een factuur. Daarom bewaren we alleen
een vingerafdruk van de regels waar een tarief in staat. Verandert die, dan
komt er een melding en kijkt iemand na wat er precies anders is.
"""
from __future__ import annotations

import hashlib
import logging
import re

import requests
from django.utils import timezone

logger = logging.getLogger(__name__)

BRONNEN = [
    {
        'land': 'NL',
        'naam': 'Vrachtwagenheffing',
        'url': 'https://www.vrachtwagenheffing.nl/dit-gaat-u-betalen',
    },
    {
        'land': 'DE',
        'naam': 'Toll Collect',
        'url': ('https://www.toll-collect.de/nl/toll_collect/bezahlen/'
                'maut_tarife/p1745_mauttarife_07_2024.html'),
    },
    {
        'land': 'BE',
        'naam': 'Viapass',
        'url': 'https://www.viapass.be/nl/tarieven/',
    },
]

TIJDSLIMIET = 30
# Een regel telt mee als er een bedrag in staat: "0,348" of "34,8 cent".
_BEDRAG = re.compile(r'\d+[.,]\d{1,4}')
_SCRIPT = re.compile(r'<(script|style)[^>]*>.*?</\1>', re.I | re.S)
_TAG = re.compile(r'<[^>]+>')
_WITRUIMTE = re.compile(r'[ \t\u00a0]+')


def _tariefregels(html: str) -> list[str]:
    """Haal uit de pagina de regels waar een bedrag in staat."""
    tekst = _SCRIPT.sub(' ', html)
    tekst = _TAG.sub('\n', tekst)
    regels = []
    for ruw in tekst.split('\n'):
        regel = _WITRUIMTE.sub(' ', ruw).strip()
        if len(regel) < 3 or len(regel) > 200:
            continue
        if not _BEDRAG.search(regel):
            continue
        regels.append(regel)
    return regels


def _vingerafdruk(regels: list[str]) -> str:
    return hashlib.sha256('\n'.join(regels).encode('utf-8')).hexdigest()


def zorg_voor_bronnen() -> None:
    """Zet de drie vaste bronnen klaar, zonder bestaande te overschrijven."""
    from .models import TariefBron

    for bron in BRONNEN:
        TariefBron.objects.get_or_create(
            land=bron['land'], naam=bron['naam'],
            defaults={'url': bron['url']},
        )


def controleer_bronnen() -> dict:
    """Haal alle tariefpagina's op en noteer welke zijn gewijzigd."""
    from .models import TariefBron

    zorg_voor_bronnen()

    gewijzigd, mislukt, bekeken = [], [], 0
    for bron in TariefBron.objects.all():
        bekeken += 1
        try:
            antwoord = requests.get(
                bron.url, timeout=TIJDSLIMIET,
                headers={'User-Agent': 'TMS tariefcontrole'})
            antwoord.raise_for_status()
            regels = _tariefregels(antwoord.text)
        except Exception as exc:
            bron.fout = str(exc)[:255]
            bron.laatst_gecontroleerd = timezone.now()
            bron.save(update_fields=['fout', 'laatst_gecontroleerd'])
            mislukt.append(bron.naam)
            logger.warning('Tariefpagina %s niet gelezen: %s', bron.naam, exc)
            continue

        if not regels:
            # Een lege uitkomst is bijna altijd een blokkade of een
            # omleiding, geen tariefwijziging. Dan liever niets melden.
            bron.fout = 'Geen tariefregels gevonden op de pagina.'
            bron.laatst_gecontroleerd = timezone.now()
            bron.save(update_fields=['fout', 'laatst_gecontroleerd'])
            mislukt.append(bron.naam)
            continue

        nieuw = _vingerafdruk(regels)
        velden = ['fout', 'laatst_gecontroleerd', 'tariefregels', 'vingerafdruk']
        bron.fout = ''
        bron.laatst_gecontroleerd = timezone.now()
        if bron.vingerafdruk and bron.vingerafdruk != nieuw:
            bron.laatst_gewijzigd = timezone.now()
            velden.append('laatst_gewijzigd')
            gewijzigd.append(bron.naam)
            logger.info('Tarieven gewijzigd op %s (%s)', bron.naam, bron.url)
        bron.vingerafdruk = nieuw
        bron.tariefregels = regels[:400]
        bron.save(update_fields=velden)

    return {'bekeken': bekeken, 'gewijzigd': gewijzigd, 'mislukt': mislukt}

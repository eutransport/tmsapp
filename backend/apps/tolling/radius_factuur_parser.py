"""Lees een Radius-factuur (tank- en laadkaarten) met tolregels uit.

Werkt op twee bronnen die dezelfde regels opleveren:

* de PDF zoals Radius die verstuurt (``parse_pdf``);
* de ruwe tekst die uit zo'n PDF geplakt is (``parse_tekst``).

Een transactieregel in de PDF staat verticaal uitgeklapt, in deze vaste
volgorde::

    21/09/2026  07:55  BB 625 L  EETS TOLL CHARGE  EETS Toll Charge 0%
    1.00  21.1700  21.17  0%  0.00  21.17

Bij geplakte tekst staat alles achter elkaar op \u00e9\u00e9n regel. Daarom knippen we in
beide gevallen op het patroon datum + tijd, en lezen we de zes bedragen vanaf
het einde van het blok. Dat is bestand tegen stationsnamen met spaties.

Deze module heeft bewust geen Django-afhankelijkheid, zodat hij los te testen is.
"""
import re
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal, InvalidOperation

# Datum en tijd waarop we een nieuwe transactieregel herkennen.
_SPLITS = re.compile(r'(\d{2}/\d{2}/\d{4})\s+(\d{2}:\d{2})')
# Het bedragenblok: hoeveelheid, eenheidsprijs (4 decimalen), totaal,
# btw-tarief, btw-bedrag en brutobedrag.
_BEDRAGEN = re.compile(
    r'(\d+[.,]\d{2})\s+(\d+[.,]\d{3,4})\s+(-?\d+[.,]\d{2})\s+'
    r'(\d{1,2}%)\s+(-?\d+[.,]\d{2})\s+(-?\d+[.,]\d{2})'
)
_FACTUURNUMMER = re.compile(r'Factuurn(?:r|ummer)\.?\s+([A-Z]{2}\d{8,})')
_KAARTNUMMER = re.compile(r'Kaartnummer\s+([A-Za-z0-9\-]+)')
_KENTEKEN = re.compile(r'^([A-Z]{1,3}[\s\-]?\d{1,3}[\s\-]?[A-Z]{1,3}|\d{2}[\s\-]?[A-Z]{3}[\s\-]?\d)\b')

# Producten die een tolpassage zijn. Abonnementen en servicekosten horen niet
# bij een rit en mogen dus nooit als passage ge\u00efmporteerd worden.
TOLPRODUCTEN = ('toll charge', 'toll disbursement', 'maut', 'peage', 'p\u00e9age')


@dataclass
class FactuurRegel:
    datum: str
    tijdstip: str
    kenteken: str
    station: str
    product: str
    hoeveelheid: Decimal
    eenheidsprijs: Decimal
    totaal: Decimal
    btw_tarief: str
    btw_bedrag: Decimal
    bruto: Decimal
    kaartnummer: str = ''
    # Alleen de API levert het land aan; bij een PDF blijft dit leeg en wordt
    # het land uit de GPS afgeleid.
    land: str = ''

    @property
    def tijdstempel(self) -> datetime:
        return datetime.strptime(f'{self.datum} {self.tijdstip}', '%d/%m/%Y %H:%M')

    @property
    def is_tol(self) -> bool:
        # Alleen op het product kijken: de kaartnaam is vaak 'EETS TOLL CHARGE',
        # ook op de regel voor het abonnement of de servicekosten.
        return any(p in self.product.lower() for p in TOLPRODUCTEN)


@dataclass
class Factuur:
    factuurnummer: str = ''
    factuurdatum: str = ''
    klantnummer: str = ''
    regels: list = field(default_factory=list)

    @property
    def tolregels(self) -> list:
        return [r for r in self.regels if r.is_tol]

    @property
    def totaal_tol(self) -> Decimal:
        return sum((r.totaal for r in self.tolregels), Decimal('0'))


class FactuurLeesFout(Exception):
    """De aangeleverde factuur kon niet gelezen worden."""


def _decimaal(waarde: str):
    try:
        return Decimal(waarde.replace(',', '.'))
    except (InvalidOperation, AttributeError):
        return None


def _lees_blok(datum: str, tijdstip: str, rest: str, kaartnummer: str):
    """Maak een regel uit de tekst die tussen twee datum/tijd-koppen staat.

    We zoeken het eerste bedragenblok in plaats van de laatste velden te nemen.
    Op een paginaovergang loopt namelijk de kolomkop of een kaarttotaal achter
    de transactie aan, en dat zou anders als bedrag gelezen worden.
    """
    treffer = _BEDRAGEN.search(rest)
    if treffer is None:
        return None

    hoeveelheid = _decimaal(treffer.group(1))
    eenheidsprijs = _decimaal(treffer.group(2))
    totaal = _decimaal(treffer.group(3))
    btw_tarief = treffer.group(4)
    btw_bedrag = _decimaal(treffer.group(5))
    bruto = _decimaal(treffer.group(6))
    if None in (hoeveelheid, eenheidsprijs, totaal, btw_bedrag, bruto):
        return None

    kopregel = ' '.join(rest[:treffer.start()].split())
    kenteken_treffer = _KENTEKEN.match(kopregel)
    kenteken = kenteken_treffer.group(1).strip() if kenteken_treffer else ''
    omschrijving = kopregel[len(kenteken):].strip() if kenteken else kopregel

    # De omschrijving is 'NAAM STATION' gevolgd door het product. Het product
    # begint bij het laatste voorkomen van 'EETS'; staat dat er niet, dan houden
    # we de hele tekst aan als product.
    station, product = omschrijving, omschrijving
    knip = omschrijving.rfind('EETS')
    if knip > 0:
        station = omschrijving[:knip].strip()
        product = omschrijving[knip:].strip()

    return FactuurRegel(
        datum=datum, tijdstip=tijdstip, kenteken=kenteken,
        station=station, product=product,
        hoeveelheid=hoeveelheid, eenheidsprijs=eenheidsprijs, totaal=totaal,
        btw_tarief=btw_tarief, btw_bedrag=btw_bedrag, bruto=bruto,
        kaartnummer=kaartnummer,
    )


def _kaartnummer_voor(tekst: str, positie: int) -> str:
    """Het kaartnummer dat na deze transactie volgt.

    In de PDF staat 'Kaartnummer ...' onder het blok transacties waar het bij
    hoort, dus we kijken vooruit in plaats van achteruit.
    """
    treffer = _KAARTNUMMER.search(tekst, positie)
    return treffer.group(1) if treffer else ''


def parse_tekst(tekst: str) -> Factuur:
    """Lees de factuurregels uit platte tekst."""
    if not tekst or not tekst.strip():
        raise FactuurLeesFout('De aangeleverde tekst is leeg.')

    # Nieuwe regels zijn betekenisloos: in de PDF staat elk veld op een eigen
    # regel, in geplakte tekst juist alles achter elkaar.
    plat = ' '.join(tekst.split())

    factuur = Factuur()
    nummer = _FACTUURNUMMER.search(plat)
    if nummer:
        factuur.factuurnummer = nummer.group(1)
    datum = re.search(r'Factuurdatum\s+(\d{2}/\d{2}/\d{4})', plat) or \
        re.search(r'(\d{2}/\d{2}/\d{4})\s+Factuurdatum', plat)
    if datum:
        factuur.factuurdatum = datum.group(1)
    klant = re.search(r'(\d+/\d+)\s+Klantnr', plat)
    if klant:
        factuur.klantnummer = klant.group(1)

    treffers = list(_SPLITS.finditer(plat))
    for i, treffer in enumerate(treffers):
        begin = treffer.end()
        einde = treffers[i + 1].start() if i + 1 < len(treffers) else len(plat)
        regel = _lees_blok(
            treffer.group(1), treffer.group(2), plat[begin:einde],
            _kaartnummer_voor(plat, einde),
        )
        if regel is not None:
            factuur.regels.append(regel)

    if not factuur.regels:
        raise FactuurLeesFout(
            'Geen transactieregels gevonden. Controleer of dit een Radius-factuur is.'
        )
    return factuur


def parse_pdf(inhoud: bytes) -> Factuur:
    """Lees de factuurregels uit een PDF."""
    try:
        import fitz
    except ImportError:  # pragma: no cover - afhankelijk van de omgeving
        raise FactuurLeesFout('PDF-ondersteuning is niet beschikbaar op de server.')

    try:
        document = fitz.open(stream=inhoud, filetype='pdf')
    except Exception:
        raise FactuurLeesFout('Het PDF-bestand kon niet geopend worden.')

    with document:
        tekst = '\n'.join(pagina.get_text() for pagina in document)
    return parse_tekst(tekst)

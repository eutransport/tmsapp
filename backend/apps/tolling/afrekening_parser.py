"""Inlezen van de tolafrekening die we van een opdrachtgever ontvangen.

De opdrachtgever (bijvoorbeeld DACHSER) stuurt per afrekeningsperiode een PDF
met een samenvatting per voertuig en daarachter per voertuig een blok met
dagtotalen. Onderaan zo'n blok staat de regel ``Maut (RT-ondernemerafrekening)``
met het bedrag dat de opdrachtgever ons voor tolheffing vergoedt. Dat bedrag
vergelijken we later met wat wij zelf aan tolheffing betaald hebben.

Het voertuig staat in de PDF als ritnummer ("791/E&U"). Via de vloot komen we
van dat ritnummer bij het kenteken en daarmee bij onze eigen tolregels.

Opbouw van de PDF (zoals PyMuPDF de tekst teruggeeft):

    Afrekeningsperiode van 01.09.2026 tot 15.09.2026
    ...
    001            <- regelnummer
    791/E&U        <- voertuiglabel
    11             <- inzetdagen
    19             <- ritten
    8.345,81       <- netto bedrag
    A              <- belastingcode

en per voertuigblok op de detailpagina's:

    791/E&U
    00001 01.09.2026
          15.293  3.963  2  1  306  0,00  758,71  001
    ...
    Totaal ...
    Dagforfait                      7.194,00   001
    Brandstoftoeslag                  828,85   001
    Maut (RT-ondernemerafrekening)    322,96   001

Bedragen staan in Nederlandse notatie: punt als duizendtal, komma als decimaal.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

# Een afrekening is een tekstueel PDF'je van hooguit een paar honderd kilobyte.
# Deze grenzen houden een kwaadaardig of kapot bestand buiten de deur.
MAX_BESTAND_BYTES = 25 * 1024 * 1024
MAX_PAGINAS = 300

_PDF_MAGIC = b'%PDF-'

_PERIODE = re.compile(
    r'Afrekeningsperiode\s+van\s+(\d{2}[.\-/]\d{2}[.\-/]\d{4})'
    r'\s+tot\s+(\d{2}[.\-/]\d{2}[.\-/]\d{4})',
    re.IGNORECASE,
)
_BONNUMMER = re.compile(r'Bonnr\.?\s*:\s*([A-Za-z0-9._\-/]+)', re.IGNORECASE)
_KLANTNUMMER = re.compile(r'Klantnr\.?\s*:\s*([A-Za-z0-9._\-/]+)', re.IGNORECASE)
_FACTUURDATUM = re.compile(r'Datum\s*:\s*(\d{2}[.\-/]\d{2}[.\-/]\d{4})', re.IGNORECASE)

_REGELNUMMER = re.compile(r'^\d{1,4}$')
_VOERTUIGLABEL = re.compile(r'^[0-9A-Za-z][0-9A-Za-z._\-]{0,19}/[0-9A-Za-z&._\-]{1,20}$')
_DAGREGEL = re.compile(r'^(\d{3,7})\s+(\d{2}[.\-/]\d{2}[.\-/]\d{4})$')
_DATUM_TOKEN = re.compile(r'^\d{2}[.\-/]\d{2}[.\-/]\d{4}$')
_GETAL_TOKEN = re.compile(r'^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^-?\d+(?:,\d+)?$')

# De toeslagregels onder een voertuigblok. De sleutel is het veld waarin we het
# bedrag bewaren, de waarde het begin van de regel in de PDF.
_TOESLAGEN = (
    ('maut', 'maut'),
    ('dagforfait', 'dagforfait'),
    ('brandstoftoeslag', 'brandstoftoeslag'),
)


class AfrekeningFout(ValueError):
    """Het bestand is geen leesbare afrekening."""


@dataclass
class Dagregel:
    datum: date
    kilometers: Decimal
    netto_bedrag: Decimal


@dataclass
class Voertuigregel:
    regelnummer: str
    voertuig_label: str
    ritnummer: str
    inzetdagen: int = 0
    ritten: int = 0
    netto_bedrag: Decimal = Decimal('0')
    dagforfait: Decimal = Decimal('0')
    brandstoftoeslag: Decimal = Decimal('0')
    maut: Decimal = Decimal('0')
    maut_gevonden: bool = False
    kilometers: Decimal = Decimal('0')
    dagen: list[Dagregel] = field(default_factory=list)


@dataclass
class Afrekening:
    periode_van: date
    periode_tot: date
    bonnummer: str = ''
    klantnummer: str = ''
    factuurdatum: date | None = None
    regels: list[Voertuigregel] = field(default_factory=list)
    waarschuwingen: list[str] = field(default_factory=list)

    @property
    def totaal_maut(self) -> Decimal:
        return sum((r.maut for r in self.regels), Decimal('0'))

    @property
    def totaal_netto(self) -> Decimal:
        return sum((r.netto_bedrag for r in self.regels), Decimal('0'))


def _decimaal(tekst: str) -> Decimal:
    """Zet een bedrag in Nederlandse notatie om: '8.345,81' -> 8345.81."""
    schoon = str(tekst or '').strip().replace(' ', '')
    if not schoon:
        return Decimal('0')
    # Alleen punten betekent duizendtallen ('15.293'); een komma is de decimaal.
    schoon = schoon.replace('.', '').replace(',', '.')
    try:
        return Decimal(schoon)
    except InvalidOperation:
        return Decimal('0')


def _geheel(tekst: str) -> int:
    try:
        return int(_decimaal(tekst))
    except (ValueError, TypeError):
        return 0


def _datum(tekst: str) -> date | None:
    schoon = str(tekst or '').strip().replace('-', '.').replace('/', '.')
    try:
        return datetime.strptime(schoon, '%d.%m.%Y').date()
    except ValueError:
        return None


def _is_getal(token: str) -> bool:
    """Een los getal, maar nadrukkelijk geen datum (die lijkt erop)."""
    if _DATUM_TOKEN.match(token):
        return False
    return bool(_GETAL_TOKEN.match(token))


def lees_paginas(inhoud: bytes) -> list[list[str]]:
    """Haal de tekstregels per pagina uit het PDF-bestand.

    Er wordt alleen tekst gelezen; PyMuPDF voert geen JavaScript uit en volgt
    geen externe verwijzingen uit het document.
    """
    if not inhoud:
        raise AfrekeningFout('Het bestand is leeg.')
    if len(inhoud) > MAX_BESTAND_BYTES:
        raise AfrekeningFout(
            f'Het bestand is groter dan {MAX_BESTAND_BYTES // (1024 * 1024)} MB.')
    if not inhoud.startswith(_PDF_MAGIC):
        raise AfrekeningFout('Het bestand is geen PDF.')

    try:
        import pymupdf
    except ImportError:  # pragma: no cover - oudere PyMuPDF
        import fitz as pymupdf

    try:
        document = pymupdf.open(stream=inhoud, filetype='pdf')
    except Exception as fout:  # noqa: BLE001 - bibliotheekfout afschermen
        raise AfrekeningFout('De PDF kan niet gelezen worden.') from fout

    try:
        if document.page_count > MAX_PAGINAS:
            raise AfrekeningFout(
                f'De PDF heeft meer dan {MAX_PAGINAS} pagina\'s.')
        if document.needs_pass:
            raise AfrekeningFout('De PDF is met een wachtwoord beveiligd.')
        paginas = []
        for pagina in document:
            tekst = pagina.get_text() or ''
            paginas.append([regel.rstrip() for regel in tekst.splitlines()])
        return paginas
    finally:
        document.close()


def _lees_kop(paginas: list[list[str]]) -> tuple[date, date, str, str, date | None]:
    """Periode en factuurgegevens staan op de eerste pagina."""
    alles = '\n'.join(regel for pagina in paginas[:2] for regel in pagina)

    periode = _PERIODE.search(alles)
    if not periode:
        raise AfrekeningFout(
            'De afrekeningsperiode staat niet in het bestand. '
            'Is dit wel een afrekening van de opdrachtgever?')
    van = _datum(periode.group(1))
    tot = _datum(periode.group(2))
    if not van or not tot:
        raise AfrekeningFout('De afrekeningsperiode is onleesbaar.')
    if van > tot:
        van, tot = tot, van

    bon = _BONNUMMER.search(alles)
    klant = _KLANTNUMMER.search(alles)
    factuurdatum = _FACTUURDATUM.search(alles)
    return (
        van,
        tot,
        bon.group(1).strip() if bon else '',
        klant.group(1).strip() if klant else '',
        _datum(factuurdatum.group(1)) if factuurdatum else None,
    )


def _lees_samenvatting(pagina: list[str]) -> list[Voertuigregel]:
    """De tabel op pagina 1: regelnummer, voertuig, inzetdagen, ritten, bedrag."""
    regels: list[Voertuigregel] = []
    gezien: set[str] = set()
    i = 0
    while i < len(pagina) - 4:
        nummer = pagina[i].strip()
        label = pagina[i + 1].strip()
        if not _REGELNUMMER.match(nummer) or not _VOERTUIGLABEL.match(label):
            i += 1
            continue
        dagen = pagina[i + 2].strip()
        ritten = pagina[i + 3].strip()
        bedrag = pagina[i + 4].strip()
        if not (_is_getal(dagen) and _is_getal(ritten) and _is_getal(bedrag)):
            i += 1
            continue
        sleutel = f'{nummer}|{label}'
        if sleutel not in gezien:
            gezien.add(sleutel)
            regels.append(Voertuigregel(
                regelnummer=nummer.lstrip('0') or '0',
                voertuig_label=label,
                ritnummer=label.split('/')[0].strip(),
                inzetdagen=_geheel(dagen),
                ritten=_geheel(ritten),
                netto_bedrag=_decimaal(bedrag),
            ))
        i += 5
    return regels


def _verzamel_getallen(pagina: list[str], start: int) -> tuple[list[str], int]:
    """Lees vanaf ``start`` alle regels die uitsluitend uit getallen bestaan."""
    tokens: list[str] = []
    i = start
    while i < len(pagina):
        regel = pagina[i]
        if not regel.strip():
            i += 1
            continue
        if _DAGREGEL.match(regel.strip()):
            break
        delen = regel.split()
        if delen and all(_is_getal(d) for d in delen):
            tokens.extend(delen)
            i += 1
            continue
        break
    return tokens, i


def _lees_details(paginas: list[list[str]], regels: list[Voertuigregel]) -> list[str]:
    """Vul per voertuig de dagregels en de toeslagen (waaronder de Maut) aan."""
    per_regelnummer = {r.regelnummer: r for r in regels}
    per_label = {r.voertuig_label: r for r in regels}
    waarschuwingen: list[str] = []
    huidig: Voertuigregel | None = None

    for pagina in paginas[1:]:
        i = 0
        while i < len(pagina):
            regel = pagina[i].strip()

            # Nieuw voertuigblok: alleen labels die ook in de samenvatting staan.
            if regel in per_label:
                huidig = per_label[regel]
                i += 1
                continue

            dag = _DAGREGEL.match(regel)
            if dag and huidig is not None:
                datum = _datum(dag.group(2))
                tokens, volgende = _verzamel_getallen(pagina, i + 1)
                # Van rechts gelezen: kilometers, inzeturen, netto, regelnummer.
                if datum and len(tokens) >= 4:
                    doel = per_regelnummer.get(tokens[-1].lstrip('0') or '0', huidig)
                    doel.dagen.append(Dagregel(
                        datum=datum,
                        kilometers=_decimaal(tokens[-4]),
                        netto_bedrag=_decimaal(tokens[-2]),
                    ))
                i = max(volgende, i + 1)
                continue

            laag = regel.lower()
            gevonden_toeslag = next(
                (veld for veld, voorvoegsel in _TOESLAGEN if laag.startswith(voorvoegsel)),
                None,
            )
            if gevonden_toeslag:
                tokens, volgende = _verzamel_getallen(pagina, i + 1)
                if tokens:
                    # Achter het bedrag staat het regelnummer van het voertuig.
                    doel = huidig
                    if len(tokens) >= 2 and _REGELNUMMER.match(tokens[-1]):
                        doel = per_regelnummer.get(tokens[-1].lstrip('0') or '0', huidig)
                        bedrag = _decimaal(tokens[-2])
                    else:
                        bedrag = _decimaal(tokens[-1])
                    if doel is not None:
                        setattr(doel, gevonden_toeslag, bedrag)
                        if gevonden_toeslag == 'maut':
                            doel.maut_gevonden = True
                    else:
                        waarschuwingen.append(
                            f'Toeslag "{regel}" hoort niet bij een voertuig en is overgeslagen.')
                i = max(volgende, i + 1)
                continue

            if laag.startswith('totaal') and huidig is not None:
                tokens, volgende = _verzamel_getallen(pagina, i + 1)
                # Van rechts: kilometers, inzeturen, netto.
                if len(tokens) >= 3:
                    huidig.kilometers = _decimaal(tokens[-3])
                i = max(volgende, i + 1)
                continue

            i += 1

    return waarschuwingen


def parse_afrekening(inhoud: bytes) -> Afrekening:
    """Lees een afrekening-PDF en geef de voertuigregels terug."""
    paginas = lees_paginas(inhoud)
    if not paginas:
        raise AfrekeningFout('De PDF bevat geen pagina\'s.')

    van, tot, bonnummer, klantnummer, factuurdatum = _lees_kop(paginas)
    regels = _lees_samenvatting(paginas[0])
    if not regels:
        raise AfrekeningFout(
            'Er staan geen voertuigregels in het bestand. '
            'Controleer of dit de volledige afrekening is.')

    waarschuwingen = _lees_details(paginas, regels)

    for regel in regels:
        if not regel.maut_gevonden:
            waarschuwingen.append(
                f'Voertuig {regel.voertuig_label}: geen tolvergoeding (Maut) op de afrekening.')
        # De opgetelde dagkilometers horen gelijk te zijn aan het totaal; wijkt
        # dat af, dan is er een regel gemist en kloppen de cijfers niet.
        som_dagen = sum((d.kilometers for d in regel.dagen), Decimal('0'))
        if regel.kilometers and abs(som_dagen - regel.kilometers) > Decimal('1'):
            waarschuwingen.append(
                f'Voertuig {regel.voertuig_label}: dagkilometers ({som_dagen}) wijken af '
                f'van het totaal op de afrekening ({regel.kilometers}).')

    return Afrekening(
        periode_van=van,
        periode_tot=tot,
        bonnummer=bonnummer,
        klantnummer=klantnummer,
        factuurdatum=factuurdatum,
        regels=regels,
        waarschuwingen=waarschuwingen,
    )

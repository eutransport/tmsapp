"""Inlezen van het verbruikenbestand (Radius 'mijn verbruiken'-export).

Dit bestand heeft een andere opzet dan de gewone tol-CSV: er staan twaalf
filterregels boven de kopregel, de kolommen liggen anders, en er is geen
afstandskolom. De kilometers worden daarom afgeleid uit het bedrag.

Let op: de stationskolommen bevatten niet-aangehaalde komma's ("A67, Mol,
Belgium"), waardoor het aantal velden per regel verschilt. De kolommen worden
daarom op inhoud herkend en niet op positie.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from decimal import Decimal, InvalidOperation

# Vast tarief per kilometer waarmee de afstand uit het bedrag wordt afgeleid.
TARIEF_PER_KM = Decimal('0.21')

KOPREGEL = 'pan / reservering,registratie'
_DATUM = re.compile(r'^\d{1,2}/\d{1,2}/\d{4} \d{2}:\d{2}:\d{2} [+-]\d{2}:\d{2}$')
# Veld -6 is het bedrag: erachter staan altijd vijf vaste kolommen.
_BEDRAG_VANAF_ACHTER = 6


LEGE_RIJ = {'start date': '', 'end date': '', 'distance': '',
            'amount': '', 'license plate': '', 'obu': ''}


def _maak_rij(pan: str, kenteken: str, tijden: list[str], bedrag: Decimal | None) -> dict:
    if len(tijden) != 2 or bedrag is None or not kenteken:
        # Onleesbare regel: leeg doorgeven zodat de import hem als ongeldig
        # telt in plaats van hem stilzwijgend te laten vallen.
        return dict(LEGE_RIJ)

    binnen = datetime.strptime(tijden[0], '%m/%d/%Y %H:%M:%S %z')
    vrijgave = datetime.strptime(tijden[1], '%m/%d/%Y %H:%M:%S %z')
    afstand = (bedrag / TARIEF_PER_KM).quantize(Decimal('0.001')) if bedrag else Decimal('0')
    return {
        'start date': binnen.isoformat(),
        'end date': vrijgave.isoformat(),
        'distance': str(afstand),
        'amount': str(bedrag),
        'license plate': kenteken,
        'obu': pan,
    }


def is_verbruiken_bestand(tekst: str) -> bool:
    return any(r.strip().lower().startswith(KOPREGEL) for r in tekst.splitlines()[:40])


def is_verbruiken_xlsx(raw: bytes) -> bool:
    return raw[:2] == b'PK'


def lees_verbruiken_xlsx(raw: bytes) -> list[dict]:
    """Zelfde uitkomst als lees_verbruiken, maar uit de Excel-export.

    Excel bewaart de stationsnamen netjes per cel, dus hier kunnen de kolommen
    wel op naam worden opgezocht.
    """
    import openpyxl

    blad = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True).worksheets[0]
    kolom: dict[str, int] = {}
    rijen: list[dict] = []

    for cellen in blad.iter_rows(values_only=True):
        waarden = ['' if c is None else str(c).strip() for c in cellen]
        if not kolom:
            namen = [w.lower() for w in waarden]
            if namen[:2] == ['pan / reservering', 'registratie']:
                kolom = {naam: i for i, naam in enumerate(namen)}
            continue
        if not any(waarden):
            continue

        def veld(naam):
            i = kolom.get(naam)
            return waarden[i] if i is not None and i < len(waarden) else ''

        try:
            bedrag = Decimal(veld('bedrag exclusief btw'))
        except InvalidOperation:
            bedrag = None
        tijden = [t for t in (veld('ingangsdatum/tijd'), veld('vrijgavedatum/tijd'))
                  if _DATUM.match(t)]
        rijen.append(_maak_rij(veld('pan / reservering'), veld('registratie'), tijden, bedrag))
    return rijen



def _ontleed_bedrag(velden: list[str]) -> Decimal | None:
    kandidaten = []
    if len(velden) >= _BEDRAG_VANAF_ACHTER:
        kandidaten.append(velden[-_BEDRAG_VANAF_ACHTER])
    kandidaten.extend(velden)
    for ruw in kandidaten:
        tekst = (ruw or '').strip()
        if not tekst:
            continue
        try:
            return Decimal(tekst)
        except InvalidOperation:
            continue
    return None


def lees_verbruiken(tekst: str) -> list[dict]:
    """Zet het verbruikenbestand om naar rijen zoals de gewone import die kent."""
    regels = tekst.splitlines()
    begin = None
    for i, regel in enumerate(regels):
        if regel.strip().lower().startswith(KOPREGEL):
            begin = i + 1
            break
    if begin is None:
        return []

    rijen: list[dict] = []
    for regel in regels[begin:]:
        if not regel.strip():
            continue
        velden = next(csv.reader(io.StringIO(regel)), [])
        if len(velden) < 8:
            continue

        tijden = [v.strip() for v in velden if _DATUM.match(v.strip())]
        bedrag = _ontleed_bedrag(velden)
        rijen.append(_maak_rij(velden[0].strip(), velden[1].strip(), tijden, bedrag))
    return rijen

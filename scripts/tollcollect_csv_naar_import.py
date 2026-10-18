"""Zet een Toll Collect 'Einzelfahrtennachweis' om naar een TMS-importbestand.

Toll Collect levert per afrekenperiode een CSV met alle losse passages in
Duitsland. Dat bestand heeft Duitse kopteksten, puntkomma's, Europese getallen
en een datum en tijd in twee aparte kolommen. De tolheffing-import van het TMS
verwacht de kolommen `start date`, `end date`, `distance`, `amount`,
`license plate` en optioneel `country`. Dit script vertaalt het ene naar het
andere en zet `country` op DE, zodat de regels meteen als Duitse tol in het
systeem staan.

Gebruik:
    python scripts/tollcollect_csv_naar_import.py <bestand.csv> [meer.csv ...]
    python scripts/tollcollect_csv_naar_import.py <bestand.csv> -u uitvoer.csv

Zonder `-u` komt het resultaat naast het bronbestand te staan met het
achtervoegsel `_tms_import.csv`. Het script print per kenteken het aantal
regels, de kilometers en het bedrag, zodat je dat kunt vergelijken met de
'Mautaufstellung' op de factuur. De eindtijd is gelijk aan de starttijd: Toll
Collect geeft geen duur van de passage.
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
from collections import defaultdict
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

LAND = 'DE'
UITVOER_KOPPEN = ['start date', 'end date', 'distance', 'amount',
                  'license plate', 'country', 'obu']

# Kolomnamen in het Toll Collect-bestand. De eerste kolom heet naar het
# factuurnummer, dus op naam zoeken in plaats van op volgnummer.
KOP_KENTEKEN = 'Kfz-Kennz.'
KOP_DATUM = 'Datum'
KOP_START = 'Start'
KOP_ART = 'Art'
KOP_BOEKING = 'Buchungsnummer'
KOP_KM = 'km'
KOP_EUR = 'EUR'


class Fout(Exception):
    """Het bestand ziet er niet uit als een Einzelfahrtennachweis."""


def _lees_tekst(pad: Path) -> str:
    raw = pad.read_bytes()
    for codering in ('utf-8-sig', 'cp1252'):
        try:
            return raw.decode(codering)
        except UnicodeDecodeError:
            continue
    return raw.decode('utf-8', errors='replace')


def _getal(waarde: str) -> Decimal | None:
    """Europees getal (1.234,56) naar Decimal."""
    tekst = (waarde or '').replace('\u00a0', ' ').strip()
    if not tekst:
        return None
    tekst = tekst.replace('.', '').replace(',', '.')
    try:
        return Decimal(tekst)
    except InvalidOperation:
        return None


def _kop_index(kop: list[str]) -> dict[str, int]:
    plaatsen: dict[str, int] = {}
    for index, naam in enumerate(kop):
        sleutel = (naam or '').strip()
        # 'km' en 'EUR' komen maar één keer voor; de eerste treffer wint.
        if sleutel and sleutel not in plaatsen:
            plaatsen[sleutel] = index
    ontbreekt = [k for k in (KOP_KENTEKEN, KOP_DATUM, KOP_START, KOP_KM, KOP_EUR)
                 if k not in plaatsen]
    if ontbreekt:
        raise Fout(f"kolommen niet gevonden: {', '.join(ontbreekt)}")
    return plaatsen


def lees_passages(pad: Path) -> tuple[list[dict], list[str]]:
    """Lees de passageregels; geeft ook de overgeslagen regels terug."""
    rijen = list(csv.reader(io.StringIO(_lees_tekst(pad)), delimiter=';'))
    if not rijen:
        raise Fout('het bestand is leeg')

    plaatsen = _kop_index(rijen[0])
    kentekenkolom = plaatsen[KOP_KENTEKEN]
    datumkolom = plaatsen[KOP_DATUM]
    startkolom = plaatsen[KOP_START]
    kmkolom = plaatsen[KOP_KM]
    eurkolom = plaatsen[KOP_EUR]
    artkolom = plaatsen.get(KOP_ART)
    boekingkolom = plaatsen.get(KOP_BOEKING)

    passages: list[dict] = []
    overgeslagen: list[str] = []
    # Op de factuur staat het kenteken alleen op de eerste regel van een blok;
    # lege kentekens horen bij de wagen daarboven.
    laatste_kenteken = ''

    for nummer, rij in enumerate(rijen[1:], start=2):
        if len(rij) <= eurkolom:
            if any((veld or '').strip() for veld in rij):
                overgeslagen.append(f'regel {nummer}: te weinig kolommen')
            continue

        kenteken = (rij[kentekenkolom] or '').strip()
        if kenteken:
            laatste_kenteken = kenteken
        else:
            kenteken = laatste_kenteken

        datum = (rij[datumkolom] or '').strip()
        tijd = (rij[startkolom] or '').strip() or '00:00'
        if not (kenteken and datum):
            if any((veld or '').strip() for veld in rij):
                overgeslagen.append(f'regel {nummer}: geen kenteken of datum')
            continue

        soort = (rij[artkolom] or '').strip() if artkolom is not None else 'Maut'
        if soort and soort.lower() != 'maut':
            overgeslagen.append(f'regel {nummer}: soort "{soort}"')
            continue

        try:
            tijdstip = datetime.strptime(f'{datum} {tijd}', '%d.%m.%Y %H:%M')
        except ValueError:
            overgeslagen.append(f'regel {nummer}: datum "{datum} {tijd}" onleesbaar')
            continue

        km = _getal(rij[kmkolom])
        bedrag = _getal(rij[eurkolom])
        if km is None or bedrag is None:
            overgeslagen.append(f'regel {nummer}: km of bedrag onleesbaar')
            continue

        passages.append({
            'tijdstip': tijdstip,
            'kenteken': kenteken,
            'km': km,
            'bedrag': bedrag,
            # Toll Collect boekt eenzelfde passage soms twee keer, via de OBU
            # en via de app. Zonder boekingsnummer valt de tweede weg.
            'boeking': ((rij[boekingkolom] or '').strip()
                        if boekingkolom is not None else ''),
        })

    if not passages:
        raise Fout('geen passageregels gevonden')
    return passages, overgeslagen


def schrijf_import(passages: list[dict], doel: Path) -> None:
    """Schrijf het bestand dat de tolheffing-import verwacht."""
    with doel.open('w', encoding='utf-8-sig', newline='') as bestand:
        schrijver = csv.writer(bestand, delimiter=';')
        schrijver.writerow(UITVOER_KOPPEN)
        for passage in sorted(passages, key=lambda p: (p['kenteken'], p['tijdstip'])):
            stempel = passage['tijdstip'].strftime('%Y-%m-%d %H:%M:%S')
            schrijver.writerow([
                stempel,
                # Toll Collect geeft geen eindtijd; de passage is een moment.
                stempel,
                f"{passage['km']:.1f}".replace('.', ','),
                f"{passage['bedrag']:.2f}".replace('.', ','),
                passage['kenteken'],
                LAND,
                passage['boeking'],
            ])


def toon_totalen(passages: list[dict]) -> None:
    """Print de totalen per kenteken om tegen de factuur te leggen."""
    per_kenteken: dict[str, dict] = defaultdict(
        lambda: {'regels': 0, 'km': Decimal('0'), 'bedrag': Decimal('0')})
    for passage in passages:
        blok = per_kenteken[passage['kenteken']]
        blok['regels'] += 1
        blok['km'] += passage['km']
        blok['bedrag'] += passage['bedrag']

    print(f"  {'Kenteken':<12}{'Regels':>7}{'Km':>12}{'Bedrag':>12}")
    for kenteken in sorted(per_kenteken):
        blok = per_kenteken[kenteken]
        print(f"  {kenteken:<12}{blok['regels']:>7}"
              f"{blok['km']:>12,.1f}{blok['bedrag']:>12,.2f}")

    dagen = sorted(p['tijdstip'].date() for p in passages)
    totaal_km = sum((b['km'] for b in per_kenteken.values()), Decimal('0'))
    totaal_bedrag = sum((b['bedrag'] for b in per_kenteken.values()), Decimal('0'))
    print(f"  {'TOTAAL':<12}{len(passages):>7}"
          f"{totaal_km:>12,.1f}{totaal_bedrag:>12,.2f}")
    print(f"  Periode: {dagen[0]:%d-%m-%Y} t/m {dagen[-1]:%d-%m-%Y}")


def verwerk(bron: Path, doel: Path | None) -> int:
    print(f'\n{bron.name}')
    try:
        passages, overgeslagen = lees_passages(bron)
    except Fout as fout:
        print(f'  OVERGESLAGEN: {fout}')
        return 1

    uitvoer = doel or bron.with_name(f'{bron.stem}_tms_import.csv')
    schrijf_import(passages, uitvoer)
    toon_totalen(passages)
    if overgeslagen:
        print(f'  {len(overgeslagen)} regel(s) niet meegenomen:')
        for melding in overgeslagen[:10]:
            print(f'    - {melding}')
        if len(overgeslagen) > 10:
            print(f'    - en nog {len(overgeslagen) - 10}')
    print(f'  Geschreven: {uitvoer}')
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('bestanden', nargs='+', type=Path,
                        help='een of meer Einzelfahrtennachweis-CSV-bestanden')
    parser.add_argument('-u', '--uitvoer', type=Path,
                        help='doelbestand (alleen bij één bronbestand)')
    argumenten = parser.parse_args()

    if argumenten.uitvoer and len(argumenten.bestanden) > 1:
        parser.error('--uitvoer kan alleen bij één bronbestand')

    fouten = 0
    for bron in argumenten.bestanden:
        if not bron.exists():
            print(f'\n{bron}\n  OVERGESLAGEN: bestand bestaat niet')
            fouten += 1
            continue
        fouten += verwerk(bron, argumenten.uitvoer)
    return 1 if fouten else 0


if __name__ == '__main__':
    sys.exit(main())

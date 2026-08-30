"""Ritnummers per dag, zoals ze in de urenregistratie zijn ingediend.

Voor de facturatie telt niet het ritnummer dat op dit moment aan de wagen
hangt, maar het ritnummer dat voor die dag is ingevuld: door de chauffeur in
zijn urenregistratie, of via de urenimport van het planbureau. Een wagen kan
op een dag namelijk meer dan een rit draaien en kan later aan een ander
ritnummer gekoppeld worden; de factuur en de tolbijlage moeten de situatie
van toen laten zien.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date

from .models import normalize_plate

# De urenimport zet meerdere ritten soms in een veld: "111 - 222" of
# "111, 222". Op die scheidingstekens splitsen we; een streepje midden in een
# ritnummer ("R-123") blijft staan omdat er spaties omheen moeten staan.
_SCHEIDING = re.compile(r'\s+[-/]\s+|[,;]|\s{2,}')


def _losse_nummers(waarde) -> list[str]:
    """Haal de losse ritnummers uit een ingevuld veld."""
    tekst = str(waarde or '').strip()
    if not tekst:
        return []
    return [deel.strip() for deel in _SCHEIDING.split(tekst) if deel.strip()]


def _kentekenindex() -> dict[str, str]:
    """Genormaliseerd kenteken of planbureau-label -> genormaliseerd kenteken.

    De urenregistratie gebruikt soms het label van het planbureau
    ('E&UTRANS1') in plaats van het echte kenteken. Via deze index komen
    beide op hetzelfde kenteken uit als de tolregels.
    """
    from apps.fleet.models import Vehicle

    labels: dict[str, str] = {}
    echte: dict[str, str] = {}
    for v in Vehicle.objects.order_by('actief', 'created_at'):
        echt = normalize_plate(v.kenteken)
        if not echt:
            continue
        echte[echt] = echt
        label = normalize_plate(v.ritnummer)
        if label:
            labels[label] = echt
    # Een echt kenteken wint altijd van een label dat er toevallig op lijkt.
    return {**labels, **echte}


def ritnummers_per_dag(kentekens, datums) -> dict[tuple[str, date], list[str]]:
    """Zoek per (genormaliseerd kenteken, datum) de ingediende ritnummers.

    Reed een wagen op een dag meerdere ritten, dan komen alle nummers terug
    in de volgorde waarin ze gevonden zijn. Dubbele nummers worden
    samengevoegd.
    """
    from apps.timetracking.models import ImportedTimeEntry, TimeEntry

    kentekens = {k for k in kentekens if k}
    datums = {d for d in datums if d}
    if not kentekens or not datums:
        return {}

    index = _kentekenindex()
    gevonden: dict[tuple[str, date], list[str]] = defaultdict(list)

    def voeg_toe(ruw_kenteken, datum, ritnummer) -> None:
        nummers = _losse_nummers(ritnummer)
        if not nummers:
            return
        norm = normalize_plate(ruw_kenteken)
        norm = index.get(norm, norm)
        if norm not in kentekens:
            return
        sleutel = (norm, datum)
        for nummer in nummers:
            if nummer not in gevonden[sleutel]:
                gevonden[sleutel].append(nummer)

    # Ingediende uren van de chauffeur zelf.
    for kenteken, datum, ritnummer in (
        TimeEntry.objects.filter(datum__in=datums)
        .values_list('kenteken', 'datum', 'ritnummer')
    ):
        voeg_toe(kenteken, datum, ritnummer)

    # Uren die via het planbureau zijn geimporteerd; daar heet het 'ritlijst'.
    for kenteken, datum, ritlijst in (
        ImportedTimeEntry.objects.filter(datum__in=datums)
        .values_list('kenteken_import', 'datum', 'ritlijst')
    ):
        voeg_toe(kenteken, datum, ritlijst)

    return dict(gevonden)


def _sorteersleutel(nummer: str) -> tuple[int, int, str]:
    """Getallen op volgorde, de rest daarachter op alfabet."""
    tekst = nummer.strip()
    if tekst.isdigit():
        return (0, int(tekst), tekst)
    return (1, 0, tekst.lower())


def als_label(nummers) -> str:
    """Meerdere ritnummers op dezelfde dag komen naast elkaar te staan."""
    return ' / '.join(sorted(nummers or [], key=_sorteersleutel))

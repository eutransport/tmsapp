"""Tekst geschikt maken voor de PDF-generatie met ReportLab.

De PDF's worden opgebouwd met de ingebouwde lettertypen van ReportLab
(Helvetica, Times, Courier). Die kennen uitsluitend de tekens uit
WinAnsi (codepagina 1252). Komt er een teken voorbij dat daar niet in
zit, dan tekent ReportLab een zwart blokje in plaats van de letter.

Zo ontstond in een factuur de regel "Rit DHO LOG?ST?CS": een chauffeur
had de bedrijfsnaam met de Turkse hoofdletter I-met-punt (U+0130)
ingevuld en die letter bestaat niet in WinAnsi.

Daarom zetten we zulke tekens hier om naar hun gewone tegenhanger
voordat de tekst in de PDF belandt. De opmaak blijft daarmee exact
hetzelfde als voorheen; alleen onleesbare blokjes verdwijnen.
"""
from __future__ import annotations

import unicodedata

from reportlab.platypus import Paragraph as _ReportLabParagraph
from reportlab.platypus import Table as _ReportLabTable

# Tekens die geen bruikbare ontleding hebben en die we dus zelf benoemen.
_VERVANGINGEN = {
    '\u0130': 'I',    # Turkse hoofdletter I met punt
    '\u0131': 'i',    # Turkse kleine letter i zonder punt
    '\u0141': 'L',    # Poolse L met streep
    '\u0142': 'l',
    '\u0110': 'D',    # D met streep (Kroatisch, Vietnamees)
    '\u0111': 'd',
    '\u0126': 'H',    # H met streep (Maltees)
    '\u0127': 'h',
    '\u0166': 'T',    # T met streep
    '\u0167': 't',
    '\u2011': '-',    # niet-afbrekend koppelteken
    '\u2212': '-',    # minteken
    '\u2044': '/',    # breukstreep
    '\u2116': 'No',   # nummerteken
}


def _is_renderbaar(tekst: str) -> bool:
    """Kan ReportLab dit met een ingebouwd lettertype tekenen?"""
    try:
        tekst.encode('cp1252')
    except UnicodeEncodeError:
        return False
    return True


def pdf_veilig(waarde) -> str:
    """Geef de tekst terug zonder tekens die als blokje zouden verschijnen.

    Tekens die WinAnsi wel kent blijven ongemoeid, dus accenten als e,
    o-umlaut of het euroteken veranderen niet. Van de rest pakken we de
    basisletter (s-cedille wordt s), en lukt ook dat niet dan zetten we
    er een vraagteken neer zodat zichtbaar blijft dat er iets stond.
    """
    if waarde is None:
        return ''
    tekst = str(waarde)
    if _is_renderbaar(tekst):
        return tekst

    resultaat = []
    for teken in tekst:
        if _is_renderbaar(teken):
            resultaat.append(teken)
            continue
        vervanging = _VERVANGINGEN.get(teken)
        if vervanging is None:
            # Haal het grondteken uit de ontleding en gooi de accenten weg.
            vervanging = ''.join(
                los for los in unicodedata.normalize('NFKD', teken)
                if not unicodedata.combining(los) and _is_renderbaar(los)
            )
        resultaat.append(vervanging or '?')
    return ''.join(resultaat)


def pdf_veilige_tabeldata(data):
    """Schoon alle losse teksten in tabeldata op.

    Cellen die geen tekst zijn (een Paragraph, een afbeelding, een getal)
    laten we ongemoeid; die gaan onveranderd door naar ReportLab.
    """
    if not data:
        return data
    return [
        [pdf_veilig(cel) if isinstance(cel, str) else cel for cel in rij]
        for rij in data
    ]


def VeiligeParagraph(tekst, *args, **kwargs):
    """Een Paragraph van ReportLab met opgeschoonde tekst."""
    return _ReportLabParagraph(pdf_veilig(tekst), *args, **kwargs)


def VeiligeTable(data, *args, **kwargs):
    """Een Table van ReportLab met opgeschoonde teksten in de cellen."""
    return _ReportLabTable(pdf_veilige_tabeldata(data), *args, **kwargs)

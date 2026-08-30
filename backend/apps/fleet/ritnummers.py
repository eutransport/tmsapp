"""Hulpfuncties rond het ritnummer van een wagen door de tijd heen.

Het ritnummer van een wagen kan wisselen. ``VehicleRitnummer`` legt vast
vanaf welke datum welk ritnummer geldt. Alles wat een historische waarde
nodig heeft (tolheffing-import, planning) vraagt het ritnummer op met een
datum; alles wat de waarde van nu wil, blijft gewoon ``Vehicle.ritnummer``
lezen.
"""
from __future__ import annotations

import datetime as _dt

from django.db.models import F
from django.utils import timezone

from .models import Vehicle, VehicleRitnummer


def _volgorde():
    """Oudste periode eerst; de open periode (zonder datum) helemaal vooraan."""
    return F('geldig_vanaf').asc(nulls_first=True)


def _vandaag() -> _dt.date:
    """Datum van vandaag in de tijdzone van de applicatie."""
    return timezone.now().astimezone(timezone.get_current_timezone()).date()


def periodes_van(vehicle_id) -> list[VehicleRitnummer]:
    """Alle periodes van een wagen, oudste eerst."""
    return list(
        VehicleRitnummer.objects
        .filter(vehicle_id=vehicle_id)
        .order_by(_volgorde(), 'created_at')
    )


def _kies(periodes, datum: _dt.date) -> str:
    """Kies uit een (oplopend gesorteerde) lijst periodes die op ``datum`` geldt."""
    gekozen = ''
    gevonden = False
    for vanaf, ritnummer in periodes:
        if vanaf is None or vanaf <= datum:
            gekozen = ritnummer
            gevonden = True
        else:
            break
    if not gevonden and periodes:
        # Datum ligt voor de oudste periode: gebruik de oudst bekende waarde.
        gekozen = periodes[0][1]
    return gekozen


def ritnummer_op(vehicle, datum: _dt.date | None = None) -> str:
    """Geef het ritnummer dat voor deze wagen op ``datum`` gold.

    Valt terug op ``Vehicle.ritnummer`` wanneer er nog geen periodes zijn,
    zodat bestaand gedrag ongewijzigd blijft.
    """
    if vehicle is None:
        return ''
    datum = datum or _vandaag()
    periodes = [
        (p.geldig_vanaf, (p.ritnummer or '').strip())
        for p in VehicleRitnummer.objects.filter(vehicle_id=vehicle.pk)
        .order_by(_volgorde(), 'created_at')
    ]
    if not periodes:
        return (getattr(vehicle, 'ritnummer', '') or '').strip()
    return _kies(periodes, datum)


def bouw_ritnummer_index(vehicle_ids=None) -> dict:
    """Bouw ``{vehicle_id: [(geldig_vanaf, ritnummer), ...]}`` in een query.

    Bedoeld voor imports en overzichten die duizenden regels verwerken; zo
    hoeft er niet per regel een query te gebeuren.
    """
    qs = VehicleRitnummer.objects.all()
    if vehicle_ids is not None:
        qs = qs.filter(vehicle_id__in=list(vehicle_ids))
    index: dict = {}
    for vid, vanaf, rit in qs.order_by(
        'vehicle_id', _volgorde(), 'created_at'
    ).values_list('vehicle_id', 'geldig_vanaf', 'ritnummer'):
        index.setdefault(vid, []).append((vanaf, (rit or '').strip()))
    return index


def zoek_in_index(index: dict, vehicle, datum: _dt.date) -> str:
    """Zoek het ritnummer op in een index van :func:`bouw_ritnummer_index`."""
    if vehicle is None:
        return ''
    periodes = index.get(vehicle.pk)
    if not periodes:
        return (getattr(vehicle, 'ritnummer', '') or '').strip()
    return _kies(periodes, datum)


def synchroniseer_huidig_ritnummer(vehicle_ids=None) -> int:
    """Zet ``Vehicle.ritnummer`` gelijk aan de periode die vandaag geldt.

    Wordt aangeroepen na het wijzigen van periodes en dagelijks door een
    achtergrondtaak, zodat een periode met een toekomstige ingangsdatum op
    de juiste dag vanzelf actief wordt.
    """
    vandaag = _vandaag()
    index = bouw_ritnummer_index(vehicle_ids)
    if not index:
        return 0

    wagens = Vehicle.objects.filter(id__in=list(index))
    aangepast = []
    for wagen in wagens:
        nieuw = _kies(index[wagen.pk], vandaag)
        if (wagen.ritnummer or '') != nieuw:
            wagen.ritnummer = nieuw
            aangepast.append(wagen)
    if aangepast:
        Vehicle.objects.bulk_update(aangepast, ['ritnummer'])
    return len(aangepast)

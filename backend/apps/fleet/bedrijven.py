"""Hulpfuncties rond het bedrijf waarvoor een wagen rijdt door de tijd heen.

Een wagen kan van bedrijf wisselen. ``VehicleBedrijf`` legt vast vanaf welke
datum welk bedrijf geldt. Alles wat een historische waarde nodig heeft (de
tolheffing-import) vraagt het bedrijf op met een datum; alles wat de waarde
van nu wil, blijft gewoon ``Vehicle.bedrijf`` lezen.

Opgezet als tweelingbroer van :mod:`apps.fleet.ritnummers`; het verschil is
dat hier een bedrijf-id wordt teruggegeven in plaats van een tekst.
"""
from __future__ import annotations

import datetime as _dt

from django.db.models import F
from django.utils import timezone

from .models import Vehicle, VehicleBedrijf


def _volgorde():
    """Oudste periode eerst; de open periode (zonder datum) helemaal vooraan."""
    return F('geldig_vanaf').asc(nulls_first=True)


def _vandaag() -> _dt.date:
    """Datum van vandaag in de tijdzone van de applicatie."""
    return timezone.now().astimezone(timezone.get_current_timezone()).date()


def _kies(periodes, datum: _dt.date):
    """Kies uit een (oplopend gesorteerde) lijst periodes die op ``datum`` geldt."""
    gekozen = None
    gevonden = False
    for vanaf, bedrijf_id in periodes:
        if vanaf is None or vanaf <= datum:
            gekozen = bedrijf_id
            gevonden = True
        else:
            break
    if not gevonden and periodes:
        # Datum ligt voor de oudste periode: gebruik het oudst bekende bedrijf.
        gekozen = periodes[0][1]
    return gekozen


def bedrijf_id_op(vehicle, datum: _dt.date | None = None):
    """Geef het bedrijf-id waarvoor deze wagen op ``datum`` reed.

    Valt terug op ``Vehicle.bedrijf_id`` wanneer er nog geen periodes zijn,
    zodat bestaand gedrag ongewijzigd blijft.
    """
    if vehicle is None:
        return None
    datum = datum or _vandaag()
    periodes = [
        (p.geldig_vanaf, p.bedrijf_id)
        for p in VehicleBedrijf.objects.filter(vehicle_id=vehicle.pk)
        .order_by(_volgorde(), 'created_at')
    ]
    if not periodes:
        return getattr(vehicle, 'bedrijf_id', None)
    return _kies(periodes, datum)


def bouw_bedrijf_index(vehicle_ids=None) -> dict:
    """Bouw ``{vehicle_id: [(geldig_vanaf, bedrijf_id), ...]}`` in een query.

    Bedoeld voor imports en overzichten die duizenden regels verwerken; zo
    hoeft er niet per regel een query te gebeuren.
    """
    qs = VehicleBedrijf.objects.all()
    if vehicle_ids is not None:
        qs = qs.filter(vehicle_id__in=list(vehicle_ids))
    index: dict = {}
    for vid, vanaf, bedrijf_id in qs.order_by(
        'vehicle_id', _volgorde(), 'created_at'
    ).values_list('vehicle_id', 'geldig_vanaf', 'bedrijf_id'):
        index.setdefault(vid, []).append((vanaf, bedrijf_id))
    return index


def zoek_bedrijf_in_index(index: dict, vehicle, datum: _dt.date):
    """Zoek het bedrijf-id op in een index van :func:`bouw_bedrijf_index`."""
    if vehicle is None:
        return None
    periodes = index.get(vehicle.pk)
    if not periodes:
        return getattr(vehicle, 'bedrijf_id', None)
    return _kies(periodes, datum)


def synchroniseer_huidig_bedrijf(vehicle_ids=None) -> int:
    """Zet ``Vehicle.bedrijf`` gelijk aan de periode die vandaag geldt.

    Wordt aangeroepen na het wijzigen van periodes en dagelijks door een
    achtergrondtaak, zodat een periode met een toekomstige ingangsdatum op
    de juiste dag vanzelf actief wordt.
    """
    vandaag = _vandaag()
    index = bouw_bedrijf_index(vehicle_ids)
    if not index:
        return 0

    wagens = Vehicle.objects.filter(id__in=list(index))
    aangepast = []
    for wagen in wagens:
        nieuw = _kies(index[wagen.pk], vandaag)
        if nieuw is not None and wagen.bedrijf_id != nieuw:
            wagen.bedrijf_id = nieuw
            aangepast.append(wagen)
    if aangepast:
        Vehicle.objects.bulk_update(aangepast, ['bedrijf'])
    return len(aangepast)

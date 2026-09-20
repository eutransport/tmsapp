"""Administratief overzicht: tolheffing buiten de gewerkte uren.

Achteraf terugkijken: welke tolregels vallen niet binnen de tijd die voor die
wagen op die dag geregistreerd is? Gegroepeerd per bedrijf en per wagen, zodat
de administratie in een oogopslag ziet waar tol is gereden zonder dat er uren
tegenover staan.

Welke uren gelden er? Dezelfde regel als bij de facturatie: staan er voor die
wagen en dag uren uit de urenimport, dan tellen alleen die. Anders de uren die
de chauffeur zelf heeft ingediend. Zie `factuur_detail.vensters_per_dag`.

Deze module leest alleen; er wordt niets gewijzigd of gefactureerd.
"""
from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, time, timedelta

from django.db.models import Q
from django.utils import timezone

from . import factuur_detail
from .models import TollingEvent, normalize_plate
from .services import build_vehicle_lookup

logger = logging.getLogger(__name__)

# Meer dan dit aantal losse regels teruggeven maakt het scherm onwerkbaar en
# de response traag. De totalen blijven wel over de hele periode kloppen.
MAX_REGELS = 3000


def _dag(tijdstip) -> date:
    return factuur_detail._lokaal(tijdstip).date()


def _getal(waarde) -> float:
    return float(waarde or 0)


def overzicht(
    datum_van: date,
    datum_tot: date,
    *,
    bedrijf_id=None,
    kenteken: str = '',
    marge_minuten: int = factuur_detail.MARGE_MINUTEN,
    alleen_open: bool = False,
    alleen_buiten: bool = True,
    alleen_definitief: bool = False,
) -> dict:
    """Tolregels die buiten de geregistreerde rittijd vallen.

    ``datum_van`` en ``datum_tot`` zijn beide inclusief, in lokale tijd.
    Met ``alleen_open`` blijven al gefactureerde regels buiten beschouwing.
    Staat ``alleen_buiten`` uit, dan komen ook de randregels (binnen de marge)
    in de lijst; de regels die netjes binnen de tijd vallen nooit — die staan
    alleen in de totalen.
    """
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(datum_van, time.min), tz)
    eind = timezone.make_aware(datetime.combine(datum_tot + timedelta(days=1), time.min), tz)

    # Oudere tolregels hebben geen bedrijf-momentopname. Voor een eerlijk beeld
    # per bedrijf leiden we dat dan af uit de vloot van nu.
    vloot = build_vehicle_lookup()

    events = (
        TollingEvent.objects
        .filter(start_at__gte=start, start_at__lt=eind, is_private=False)
        .select_related('bedrijf', 'vehicle')
        .order_by('license_plate_normalized', 'start_at')
    )
    if bedrijf_id:
        # Filter op het vastgelegde bedrijf en op regels zonder bedrijf waarvan
        # de wagen nu bij dit bedrijf hoort; anders vallen die regels weg en
        # telt het gefilterde beeld lager uit dan het totaaloverzicht.
        platen = {
            plaat for plaat, wagen in vloot.items()
            if str(getattr(wagen, 'bedrijf_id', '') or '') == str(bedrijf_id)
        }
        keuze = Q(bedrijf_id=bedrijf_id)
        if platen:
            keuze |= Q(bedrijf__isnull=True, license_plate_normalized__in=platen)
        events = events.filter(keuze)
    if kenteken:
        genormaliseerd = normalize_plate(kenteken)
        if genormaliseerd:
            events = events.filter(license_plate_normalized=genormaliseerd)
    if alleen_open:
        events = events.filter(invoiced_at__isnull=True)

    events = list(events)
    if not events:
        return {
            'date_from': datum_van.isoformat(),
            'date_to': datum_tot.isoformat(),
            'marge_minuten': marge_minuten,
            'gegenereerd_op': timezone.now().isoformat(),
            'totalen': _lege_totalen(),
            'bedrijven': [],
            'afgekapt': False,
        }

    statussen = factuur_detail.tijdstatus(events, marge_minuten, alleen_definitief)

    # Groeperen: bedrijf -> wagen -> regels.
    per_bedrijf: dict = defaultdict(lambda: {
        'bedrijf_id': None,
        'bedrijf_naam': 'Zonder bedrijf',
        'totalen': _lege_totalen(),
        'afgeleid_events': 0,
        'afgeleid_bedrag': 0.0,
        '_wagens': defaultdict(lambda: {
            'plate_normalized': '',
            'plate_display': '',
            'ritnummer': '',
            'totalen': _lege_totalen(),
            'regels': [],
        }),
    })
    totalen = _lege_totalen()
    afgekapt = False
    getoond = 0

    for ev in events:
        info = statussen.get(ev.id) or {}
        status = info.get('status') or 'onbekend'
        km = _getal(ev.distance_km)
        bedrag = _getal(ev.amount)
        gefactureerd = bool(ev.invoiced_at)

        # Bedrijf van de tolregel zelf; ontbreekt dat, dan dat van de wagen in
        # de huidige vloot. Zo belandt niets onterecht op 'Zonder bedrijf'.
        uit_vloot = vloot.get(ev.license_plate_normalized)
        bedrijf_id = ev.bedrijf_id
        bedrijf_naam = ev.bedrijf.naam if ev.bedrijf else ''
        afgeleid = False
        if not bedrijf_id and uit_vloot and uit_vloot.bedrijf_id:
            bedrijf_id = uit_vloot.bedrijf_id
            bedrijf_naam = uit_vloot.bedrijf.naam
            afgeleid = True

        sleutel = str(bedrijf_id) if bedrijf_id else '__geen__'
        vak = per_bedrijf[sleutel]
        if vak['bedrijf_id'] is None and bedrijf_id:
            vak['bedrijf_id'] = str(bedrijf_id)
            vak['bedrijf_naam'] = bedrijf_naam or 'Zonder bedrijf'
        if afgeleid:
            vak['afgeleid_events'] += 1
            vak['afgeleid_bedrag'] += bedrag

        wagen = vak['_wagens'][ev.license_plate_normalized]
        if not wagen['plate_normalized']:
            wagen['plate_normalized'] = ev.license_plate_normalized
            wagen['plate_display'] = (
                ev.vehicle.kenteken if ev.vehicle
                else (uit_vloot.kenteken if uit_vloot else ev.license_plate_raw)
            )
            wagen['ritnummer'] = (ev.ritnummer or '').strip()

        for doel in (totalen, vak['totalen'], wagen['totalen']):
            _tel_op(doel, status, km, bedrag, gefactureerd)

        toon = status == 'buiten' or (not alleen_buiten and status in ('marge', 'onbekend'))
        if status == 'onbekend':
            toon = True  # geen uren gevonden: juist interessant voor de administratie
        if not toon:
            continue
        if getoond >= MAX_REGELS:
            afgekapt = True
            continue
        getoond += 1

        lokaal = factuur_detail._lokaal(ev.start_at)
        wagen['regels'].append({
            'id': str(ev.id),
            'start_at': ev.start_at.isoformat(),
            'datum': lokaal.date().isoformat(),
            'tijd': lokaal.strftime('%H:%M'),
            'weekend': lokaal.weekday() >= 5,
            'distance_km': km,
            'amount': bedrag,
            'ritnummer': (ev.ritnummer or '').strip(),
            'status': status,
            'dag_uren': info.get('dag_uren', ''),
            'dag_chauffeur': info.get('dag_chauffeur', ''),
            'dag_bron': info.get('dag_bron', ''),
            'dag_definitief': bool(info.get('dag_definitief', True)),
            'dag_ritnummers': info.get('dag_ritnummers', ''),
            # Van welke dag komen de getoonde uren? Bij een nachtrit kan dat de
            # dag ervoor zijn.
            'dag_datum': info.get('dag_datum', ''),
            'afwijking_minuten': info.get('afwijking_minuten'),
            'afwijking_richting': info.get('afwijking_richting', ''),
            'invoiced': bool(ev.invoiced_at),
        })

    bedrijven = []
    for vak in per_bedrijf.values():
        wagens = [w for w in vak['_wagens'].values()]
        wagens.sort(key=lambda w: (-w['totalen']['buiten_bedrag'], w['plate_display']))
        bedrijven.append({
            'bedrijf_id': vak['bedrijf_id'],
            'bedrijf_naam': vak['bedrijf_naam'],
            'totalen': vak['totalen'],
            'afgeleid_events': vak['afgeleid_events'],
            'afgeleid_bedrag': vak['afgeleid_bedrag'],
            'wagens': wagens,
        })
    bedrijven.sort(key=lambda b: (-b['totalen']['buiten_bedrag'], b['bedrijf_naam']))

    return {
        'date_from': datum_van.isoformat(),
        'date_to': datum_tot.isoformat(),
        'marge_minuten': marge_minuten,
        'gegenereerd_op': timezone.now().isoformat(),
        'totalen': totalen,
        'bedrijven': bedrijven,
        'afgekapt': afgekapt,
    }


def _lege_totalen() -> dict:
    return {
        'events': 0, 'km': 0.0, 'bedrag': 0.0,
        'binnen_events': 0, 'binnen_km': 0.0, 'binnen_bedrag': 0.0,
        'marge_events': 0, 'marge_km': 0.0, 'marge_bedrag': 0.0,
        'buiten_events': 0, 'buiten_km': 0.0, 'buiten_bedrag': 0.0,
        'onbekend_events': 0, 'onbekend_km': 0.0, 'onbekend_bedrag': 0.0,
        # Wel of niet op een factuur gezet, over alle passages.
        'gefactureerd_events': 0, 'gefactureerd_km': 0.0, 'gefactureerd_bedrag': 0.0,
        'open_events': 0, 'open_km': 0.0, 'open_bedrag': 0.0,
        # Idem, maar alleen voor wat buiten de uren valt of geen uren heeft.
        'afwijkend_gefactureerd_events': 0, 'afwijkend_gefactureerd_km': 0.0,
        'afwijkend_gefactureerd_bedrag': 0.0,
        'afwijkend_open_events': 0, 'afwijkend_open_km': 0.0, 'afwijkend_open_bedrag': 0.0,
    }


def _tel_op(doel: dict, status: str, km: float, bedrag: float, gefactureerd: bool) -> None:
    doel['events'] += 1
    doel['km'] += km
    doel['bedrag'] += bedrag
    if status in ('binnen', 'marge', 'buiten', 'onbekend'):
        doel[f'{status}_events'] += 1
        doel[f'{status}_km'] += km
        doel[f'{status}_bedrag'] += bedrag
    kant = 'gefactureerd' if gefactureerd else 'open'
    doel[f'{kant}_events'] += 1
    doel[f'{kant}_km'] += km
    doel[f'{kant}_bedrag'] += bedrag
    if status in ('buiten', 'onbekend'):
        doel[f'afwijkend_{kant}_events'] += 1
        doel[f'afwijkend_{kant}_km'] += km
        doel[f'afwijkend_{kant}_bedrag'] += bedrag

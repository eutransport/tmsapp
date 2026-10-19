"""Betaalde tolheffing naast alles wat wij ervoor terugkregen.

Leest alleen. Een opdrachtgever vergoedt tol op twee manieren, en welke van de
twee geldt verschilt per klant: als tolregel op onze eigen factuur (Mainfreight)
of als Maut-vergoeding op een afrekening die de klant stuurt (Dachser). Beide
staan hier naast de betaalde tol, anders lijkt de ene klant structureel te
weinig gefactureerd.

De bronnen zijn niet op dezelfde dag geboekt: een passage telt op zijn rijdatum,
een factuurregel op de factuurdatum en een afrekening op het begin van de bon.
Over een hele periode horen de totalen gelijk te zijn, per maand niet.
"""
from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from decimal import Decimal

from django.db.models import Count, Q, Sum
from django.db.models.functions import TruncMonth

from apps.fleet.models import Vehicle
from apps.invoicing.models import InvoiceLine

from .models import TolAfrekeningRegel, TollingEvent, normalize_plate
from .reconcile import bekende_kentekens, is_creditregel, is_tolregel, kenteken_van_regel

ZONDER_KENTEKEN = ''

# Tolregels heetten niet altijd "Tolheffing": er staat ook "Tol", "TOL: <rit>",
# "Tolfactuur" en "Tolkosten" op oudere facturen. Die horen hier allemaal mee.
_TOL_RE = re.compile(r'\btol\w*\b', re.IGNORECASE)
# Een BTW-correctie staat op dezelfde factuur maar is geen doorbelaste tol.
_GEEN_TOL_RE = re.compile(r'\bbtw\b', re.IGNORECASE)


def _is_doorbelasting(line: InvoiceLine) -> bool:
    omschrijving = line.omschrijving or ''
    if is_tolregel(line):
        return True
    return bool(_TOL_RE.search(omschrijving)) and not _GEEN_TOL_RE.search(omschrijving)


def _euro(waarde) -> float:
    return float(round(Decimal(waarde or 0), 2))


def _lege_rij() -> dict:
    return {
        'betaald': Decimal('0'), 'betaald_aantal': 0, 'open_bedrag': Decimal('0'),
        'doorbelast': Decimal('0'), 'doorbelast_aantal': 0,
        'vergoed': Decimal('0'), 'vergoed_aantal': 0,
    }


def _events(van: date, tot: date, bedrijf_id: str | None):
    qs = TollingEvent.objects.filter(
        afsluiting__isnull=True,
        is_private=False, start_at__date__gte=van, start_at__date__lte=tot,
    )
    if bedrijf_id:
        qs = qs.filter(bedrijf_id=bedrijf_id)
    return qs


def _tolregels(van: date, tot: date, bedrijf_id: str | None) -> list[InvoiceLine]:
    qs = (
        InvoiceLine.objects
        .select_related('invoice')
        .filter(invoice__factuurdatum__gte=van, invoice__factuurdatum__lte=tot)
        .filter(Q(extra_data__source='tolling')
                | Q(omschrijving__icontains='tol')
                | Q(omschrijving__icontains='maut'))
    )
    if bedrijf_id:
        qs = qs.filter(invoice__bedrijf_id=bedrijf_id)
    return [line for line in qs if _is_doorbelasting(line)]


def _regelbedrag(line: InvoiceLine) -> Decimal:
    """Een creditregel haalt eerder gefactureerde tol er weer af."""
    bedrag = Decimal(line.totaal or 0)
    return -abs(bedrag) if is_creditregel(line) else bedrag


def _afrekeningregels(van: date, tot: date, bedrijf_id: str | None):
    """Maut-vergoedingen uit de bonnen die in deze periode beginnen.

    Een bon telt mee in de periode waarin hij begint, net als op de
    tolafrekening-pagina, zodat hij nooit over twee perioden verdeeld wordt.
    """
    qs = (
        TolAfrekeningRegel.objects
        .select_related('afrekening', 'vehicle')
        .filter(afrekening__afsluiting__isnull=True,
                afrekening__periode_van__gte=van, afrekening__periode_van__lte=tot)
    )
    if bedrijf_id:
        qs = qs.filter(afrekening__bedrijf_id=bedrijf_id)
    return qs


def _bonnen_zonder_bedrijf(van: date, tot: date) -> int:
    """Bonnen die nergens in meetellen omdat ze geen opdrachtgever hebben."""
    return (
        TolAfrekeningRegel.objects
        .filter(afrekening__afsluiting__isnull=True,
                afrekening__periode_van__gte=van, afrekening__periode_van__lte=tot,
                afrekening__bedrijf__isnull=True)
        .values('afrekening_id').distinct().count()
    )


def _regelkenteken(regel) -> str:
    for bron in (
        getattr(regel.vehicle, 'kenteken', '') if regel.vehicle_id else '',
        regel.kenteken,
        (regel.kentekens or [None])[0] if regel.kentekens else '',
    ):
        genormaliseerd = normalize_plate(bron or '')
        if genormaliseerd:
            return genormaliseerd
    return ZONDER_KENTEKEN


def _vloot() -> dict[str, str]:
    """Genormaliseerd kenteken naar de schrijfwijze uit het wagenpark."""
    vloot = {}
    for weergave in Vehicle.objects.values_list('kenteken', flat=True):
        genormaliseerd = normalize_plate(weergave or '')
        if genormaliseerd:
            vloot.setdefault(genormaliseerd, weergave)
    return vloot


def _weergavenamen(kentekens: set[str], vloot: dict[str, str]) -> dict[str, str]:
    namen = {k: vloot[k] for k in kentekens if k in vloot}
    for kenteken, ruw in (
        TollingEvent.objects
        .filter(license_plate_normalized__in=kentekens - set(namen))
        .values_list('license_plate_normalized', 'license_plate_raw')
    ):
        namen.setdefault(kenteken, ruw)
    return namen


def overzicht(van: date, tot: date, bedrijf_id: str | None = None) -> dict:
    """Per wagen: betaalde tol, doorbelaste tol, vergoede tol en het verschil."""
    rijen: dict[str, dict] = defaultdict(_lege_rij)
    maanden: dict[str, dict] = defaultdict(lambda: {
        'betaald': Decimal('0'), 'doorbelast': Decimal('0'), 'vergoed': Decimal('0'),
    })

    events = _events(van, tot, bedrijf_id)
    for rij in (
        events.values('license_plate_normalized')
        .annotate(
            bedrag=Sum('amount'),
            aantal=Count('id'),
            open_bedrag=Sum('amount', filter=Q(invoiced_at__isnull=True)),
        )
    ):
        doel = rijen[rij['license_plate_normalized'] or ZONDER_KENTEKEN]
        doel['betaald'] += Decimal(rij['bedrag'] or 0)
        doel['betaald_aantal'] += rij['aantal']
        doel['open_bedrag'] += Decimal(rij['open_bedrag'] or 0)

    for rij in (
        events.annotate(maand=TruncMonth('start_at'))
        .values('maand').annotate(bedrag=Sum('amount'))
    ):
        if rij['maand']:
            maanden[rij['maand'].strftime('%Y-%m')]['betaald'] += Decimal(rij['bedrag'] or 0)

    platen = bekende_kentekens()
    zonder_kenteken_regels = 0
    for line in _tolregels(van, tot, bedrijf_id):
        kenteken, _ = kenteken_van_regel(line, platen)
        sleutel = kenteken or ZONDER_KENTEKEN
        if not kenteken:
            zonder_kenteken_regels += 1
        bedrag = _regelbedrag(line)
        doel = rijen[sleutel]
        doel['doorbelast'] += bedrag
        doel['doorbelast_aantal'] += 1
        factuurdatum = line.invoice.factuurdatum
        if factuurdatum:
            maanden[factuurdatum.strftime('%Y-%m')]['doorbelast'] += bedrag

    bonnen_zonder_bedrijf = _bonnen_zonder_bedrijf(van, tot)
    for regel in _afrekeningregels(van, tot, bedrijf_id):
        bedrag = Decimal(regel.maut_ontvangen or 0)
        if not bedrag:
            continue
        doel = rijen[_regelkenteken(regel)]
        doel['vergoed'] += bedrag
        doel['vergoed_aantal'] += 1
        maanden[regel.afrekening.periode_van.strftime('%Y-%m')]['vergoed'] += bedrag

    vloot = _vloot()
    namen = _weergavenamen({k for k in rijen if k}, vloot)

    wagens = []
    for kenteken, waarden in rijen.items():
        verschil = waarden['betaald'] - waarden['doorbelast'] - waarden['vergoed']
        wagens.append({
            'kenteken': kenteken,
            'kenteken_display': namen.get(kenteken, ''),
            'betaald': _euro(waarden['betaald']),
            'betaald_aantal': waarden['betaald_aantal'],
            'open_bedrag': _euro(waarden['open_bedrag']),
            'doorbelast': _euro(waarden['doorbelast']),
            'doorbelast_aantal': waarden['doorbelast_aantal'],
            'vergoed': _euro(waarden['vergoed']),
            'vergoed_aantal': waarden['vergoed_aantal'],
            'verschil': _euro(verschil),
            'in_vloot': kenteken in vloot,
        })
    wagens.sort(key=lambda w: -abs(w['verschil']))

    totalen = {
        'betaald': _euro(sum((Decimal(str(w['betaald'])) for w in wagens), Decimal('0'))),
        'doorbelast': _euro(sum((Decimal(str(w['doorbelast'])) for w in wagens), Decimal('0'))),
        'vergoed': _euro(sum((Decimal(str(w['vergoed'])) for w in wagens), Decimal('0'))),
        'open_bedrag': _euro(sum((Decimal(str(w['open_bedrag'])) for w in wagens), Decimal('0'))),
        'betaald_aantal': sum(w['betaald_aantal'] for w in wagens),
        'doorbelast_aantal': sum(w['doorbelast_aantal'] for w in wagens),
        'vergoed_aantal': sum(w['vergoed_aantal'] for w in wagens),
    }
    totalen['verschil'] = _euro(
        Decimal(str(totalen['betaald']))
        - Decimal(str(totalen['doorbelast']))
        - Decimal(str(totalen['vergoed'])))

    return {
        'periode': {'van': van.isoformat(), 'tot': tot.isoformat()},
        'bedrijf_id': bedrijf_id or None,
        'wagens': wagens,
        'maanden': [
            {
                'maand': maand,
                'betaald': _euro(waarden['betaald']),
                'doorbelast': _euro(waarden['doorbelast']),
                'vergoed': _euro(waarden['vergoed']),
                'verschil': _euro(
                    waarden['betaald'] - waarden['doorbelast'] - waarden['vergoed']),
            }
            for maand, waarden in sorted(maanden.items())
        ],
        'totalen': totalen,
        'waarschuwingen': _waarschuwingen(
            wagens, zonder_kenteken_regels, bonnen_zonder_bedrijf,
            _te_vroeg(van, bedrijf_id)),
    }


def _te_vroeg(van: date, bedrijf_id: str | None) -> date | None:
    """Eerste ingelezen passage, als de periode daarvoor begint.

    Voor die datum staan er wel tolregels op facturen maar geen passages
    tegenover; dan lijkt er te veel doorbelast.
    """
    qs = TollingEvent.objects.filter(afsluiting__isnull=True, is_private=False)
    if bedrijf_id:
        qs = qs.filter(bedrijf_id=bedrijf_id)
    eerste = qs.order_by('start_at').values_list('start_at', flat=True).first()
    if eerste and eerste.date() > van:
        return eerste.date()
    return None


def _waarschuwingen(wagens: list[dict], zonder_kenteken_regels: int,
                    bonnen_zonder_bedrijf: int, te_vroeg: date | None) -> list[str]:
    melding = []
    if te_vroeg:
        melding.append(
            f'De eerste ingelezen tolpassage is van {te_vroeg.strftime("%d-%m-%Y")}. '
            'Tolregels op facturen van daarvoor hebben geen passages tegenover '
            'zich staan; begin de periode op die datum voor een eerlijke vergelijking.'
        )
    if bonnen_zonder_bedrijf:
        melding.append(
            f'{bonnen_zonder_bedrijf} tolafrekening(en) hebben geen opdrachtgever; '
            'hun vergoeding telt hier nergens mee. Koppel de bon aan een bedrijf '
            'op de pagina Tolafrekening.'
        )
    if zonder_kenteken_regels:
        melding.append(
            f'{zonder_kenteken_regels} factuurregel(s) noemen geen kenteken; die '
            'staan op "zonder kenteken" en vertekenen de regel per wagen.'
        )
    niet_doorbelast = [
        w for w in wagens
        if w['kenteken'] and not w['doorbelast_aantal'] and not w['vergoed_aantal']
    ]
    if niet_doorbelast:
        melding.append(
            'Niets voor teruggekregen, niet via een factuur en niet via een afrekening: '
            + ', '.join(w['kenteken_display'] or w['kenteken'] for w in niet_doorbelast[:8])
        )
    zonder_tol = [w for w in wagens if w['kenteken'] and not w['betaald_aantal']]
    if zonder_tol:
        melding.append(
            'Wel gefactureerd maar geen ingelezen passages: '
            + ', '.join(w['kenteken_display'] or w['kenteken'] for w in zonder_tol[:8])
        )
    return melding

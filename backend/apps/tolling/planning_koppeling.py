"""Tolregels koppelen aan de rit uit de weekplanning.

Een tolregel kent alleen een kenteken en een tijdstip. De weekplanning weet
welke wagen op welke dag op welke rit zat, inclusief een eventuele wissel
halverwege de week. Door beide op (kenteken, dag) tegen elkaar te leggen komt
de tol op de juiste rit en bij het juiste bedrijf terecht.

Afspraken die hier in code staan:

* Een tolregel vóór ``DAGOVERGANG_UUR`` telt bij de vorige dag. Een rit die
  's avonds vertrekt en 's nachts een tolpunt passeert hoort bij de dag van
  vertrek, niet bij de kalenderdag van de passage.
* De planning kent alleen maandag tot en met vrijdag. Tol in het weekend
  vindt dus geen regel en houdt de herkomst die de import zelf bepaalde.
* Levert een dag meer dan één kandidaat op, dan koppelen we niets. Liever
  geen rit dan de verkeerde.
* Een handmatig ingevoerde wissel wint van de gewone planningsregel.
"""

from __future__ import annotations

import datetime

from .models import normalize_plate

DAGOVERGANG_UUR = 4
BRON_PLANNING = 'planning'
BRON_VOERTUIG = 'voertuig'


def planning_datum(tijdstip) -> datetime.date | None:
    """De dag waartoe een tolregel hoort, met de nachtgrens verdisconteerd."""
    if tijdstip is None:
        return None
    lokaal = _lokaal(tijdstip)
    datum = lokaal.date()
    if lokaal.hour < DAGOVERGANG_UUR:
        datum -= datetime.timedelta(days=1)
    return datum


def _lokaal(tijdstip):
    from django.utils import timezone

    if timezone.is_aware(tijdstip):
        return timezone.localtime(tijdstip)
    return tijdstip


def bouw_dagindex(datums) -> dict:
    """Geef per (kenteken, dag) de planningsregel, of None bij twijfel.

    De waarde is bewust ``None`` wanneer meerdere regels dezelfde wagen op
    dezelfde dag claimen; de aanroeper slaat die regels dan over.
    """
    from apps.planning.models import DAG_NUMMERS, PlanningEntry

    datums = {d for d in datums if d}
    if not datums:
        return {}

    weken = {d.isocalendar()[:2] for d in datums}
    dagcode_per_nummer = {nummer: code for code, nummer in DAG_NUMMERS.items()}
    dagcodes = {dagcode_per_nummer.get(d.isocalendar()[2]) for d in datums}
    dagcodes.discard(None)
    if not dagcodes:
        return {}

    regels = (PlanningEntry.objects
              .filter(planning__jaar__in={j for j, _ in weken},
                      planning__weeknummer__in={w for _, w in weken},
                      dag__in=dagcodes)
              .select_related('planning', 'planning__bedrijf', 'vehicle',
                              'vervangend_voertuig'))

    index: dict = {}
    dubbel: set = set()
    for regel in regels:
        datum = regel.planningsdatum()
        if datum not in datums:
            continue
        kenteken = normalize_plate(regel.werkelijk_kenteken())
        if not kenteken:
            continue
        sleutel = (kenteken, datum)
        if sleutel in index:
            bestaand = index[sleutel]
            # Een handmatige wissel is een bewuste keuze en wint.
            if bool(regel.vervangend_voertuig_id) == bool(
                    bestaand and bestaand.vervangend_voertuig_id):
                index[sleutel] = None
                dubbel.add(sleutel)
                continue
            if not regel.vervangend_voertuig_id:
                continue
        elif sleutel in dubbel:
            continue
        index[sleutel] = regel
    return index


def rit_van_regel(regel) -> str:
    return regel.ritnummer or regel.vehicle_ritnummer or ''


def koppel_events(events, index=None) -> dict:
    """Zet ritnummer en bedrijf op tolregels aan de hand van de planning.

    Regels die al gefactureerd zijn blijven ongemoeid: een verstuurde factuur
    mag niet met terugwerkende kracht van rit veranderen.
    """
    from .models import TollingEvent

    events = [e for e in events if e.invoiced_at is None]
    if not events:
        return {'bekeken': 0, 'gekoppeld': 0, 'geen_planning': 0, 'dubbel': 0}

    dagen = {e.id: planning_datum(e.start_at) for e in events}
    if index is None:
        index = bouw_dagindex(set(dagen.values()))

    bij_te_werken = []
    gekoppeld = geen_planning = dubbel = 0
    for event in events:
        sleutel = (event.license_plate_normalized, dagen[event.id])
        if sleutel not in index:
            geen_planning += 1
            continue
        regel = index[sleutel]
        if regel is None:
            dubbel += 1
            continue

        ritnummer = rit_van_regel(regel)
        bedrijf_id = regel.planning.bedrijf_id if regel.planning_id else None
        if event.ritnummer == ritnummer and event.bedrijf_id == bedrijf_id \
                and event.rit_bron == BRON_PLANNING:
            gekoppeld += 1
            continue

        event.ritnummer = ritnummer
        event.bedrijf_id = bedrijf_id
        event.rit_bron = BRON_PLANNING
        bij_te_werken.append(event)
        gekoppeld += 1

    if bij_te_werken:
        TollingEvent.objects.bulk_update(
            bij_te_werken, ['ritnummer', 'bedrijf', 'rit_bron'])

    return {'bekeken': len(events), 'gekoppeld': gekoppeld,
            'geen_planning': geen_planning, 'dubbel': dubbel}


def herkoppel_dag(kentekens, datum) -> dict:
    """Herkoppel de tolregels van één dag, bijvoorbeeld na een wissel."""
    from .models import TollingEvent

    kentekens = {normalize_plate(k) for k in kentekens if k}
    kentekens.discard('')
    if not kentekens or datum is None:
        return {'bekeken': 0, 'gekoppeld': 0, 'geen_planning': 0, 'dubbel': 0}

    from django.utils import timezone

    tz = timezone.get_current_timezone()
    begin = timezone.make_aware(
        datetime.datetime.combine(datum, datetime.time(DAGOVERGANG_UUR)), tz)
    einde = begin + datetime.timedelta(days=1)

    events = list(TollingEvent.objects.filter(
        license_plate_normalized__in=kentekens,
        start_at__gte=begin, start_at__lt=einde,
        invoiced_at__isnull=True))
    return koppel_events(events)


def _dagvenster(vanaf, tot):
    """Het tijdvenster van een periode, met de nachtgrens verdisconteerd."""
    from django.utils import timezone

    tz = timezone.get_current_timezone()
    begin = timezone.make_aware(
        datetime.datetime.combine(vanaf, datetime.time(DAGOVERGANG_UUR)), tz)
    einde = None
    if tot is not None:
        einde = timezone.make_aware(
            datetime.datetime.combine(tot + datetime.timedelta(days=1),
                                      datetime.time(DAGOVERGANG_UUR)), tz)
    return begin, einde


def controleer_periode(vanaf, tot=None, toepassen=False) -> dict:
    """Leg de tolregels van een periode naast de huidige planning.

    Zonder ``toepassen`` verandert er niets; de uitkomst vertelt dan wat er
    zou gebeuren. Gefactureerde regels blijven in beide gevallen ongemoeid.
    """
    from .models import TollingEvent

    begin, einde = _dagvenster(vanaf, tot)
    alles = TollingEvent.objects.filter(start_at__gte=begin)
    if einde is not None:
        alles = alles.filter(start_at__lt=einde)

    gefactureerd = alles.filter(invoiced_at__isnull=False).count()
    events = list(alles.filter(invoiced_at__isnull=True)
                  .select_related('bedrijf').order_by('start_at'))

    index = bouw_dagindex({planning_datum(e.start_at) for e in events})

    te_wijzigen = []
    wijzigingen: dict = {}
    verweesd: dict = {}
    klopt = dubbel = ongepland = alleen_bron = 0

    for event in events:
        datum = planning_datum(event.start_at)
        sleutel = (event.license_plate_normalized, datum)
        if sleutel not in index:
            if event.rit_bron == BRON_PLANNING and event.ritnummer:
                rij = verweesd.setdefault(
                    (event.license_plate_normalized, datum, event.ritnummer),
                    {'kenteken': event.license_plate_normalized,
                     'datum': datum, 'ritnummer': event.ritnummer,
                     'regels': 0, 'bedrag': 0})
                rij['regels'] += 1
                rij['bedrag'] += event.amount or 0
            else:
                ongepland += 1
            continue

        regel = index[sleutel]
        if regel is None:
            dubbel += 1
            continue

        ritnummer = rit_van_regel(regel)
        bedrijf_id = regel.planning.bedrijf_id if regel.planning_id else None
        if (event.ritnummer == ritnummer and event.bedrijf_id == bedrijf_id
                and event.rit_bron == BRON_PLANNING):
            klopt += 1
            continue

        te_wijzigen.append(event)
        if event.ritnummer == ritnummer and event.bedrijf_id == bedrijf_id:
            # Rit en bedrijf stonden al goed; alleen de herkomst wordt bijgewerkt.
            alleen_bron += 1
            continue

        sleutel = (event.license_plate_normalized, datum, event.ritnummer,
                   ritnummer)
        rij = wijzigingen.setdefault(sleutel, {
            'kenteken': event.license_plate_normalized,
            'datum': datum,
            'van_ritnummer': event.ritnummer or '',
            'naar_ritnummer': ritnummer,
            'van_bedrijf': str(event.bedrijf) if event.bedrijf_id else '',
            'naar_bedrijf': (str(regel.planning.bedrijf)
                             if regel.planning_id and regel.planning.bedrijf_id
                             else ''),
            'regels': 0,
            'bedrag': 0,
        })
        rij['regels'] += 1
        rij['bedrag'] += event.amount or 0

    toegepast = 0
    if toepassen and te_wijzigen:
        toegepast = koppel_events(te_wijzigen, index)['gekoppeld']

    def _sorteer(rijen):
        return sorted(rijen, key=lambda r: (r['datum'], r['kenteken']))

    return {
        'vanaf': vanaf,
        'tot': tot,
        'bekeken': len(events),
        'klopt': klopt,
        'te_wijzigen': len(te_wijzigen) - alleen_bron,
        'alleen_bron': alleen_bron,
        'ongepland': ongepland,
        'dubbel': dubbel,
        'gefactureerd_overgeslagen': gefactureerd,
        'toegepast': toegepast,
        'wijzigingen': _sorteer(wijzigingen.values()),
        'verweesd': _sorteer(verweesd.values()),
    }

"""Inzicht in wat er wel en niet op een tolheffing-factuur komt.

Twee dingen die los staan van de bestaande facturatie:

1. Een overzicht van de tolregels die bij de gekozen week(en) horen maar
   *niet* meegaan op de factuur, met de reden erbij (weekend, na het
   afkapuur, ander bedrijf). Zo is vooraf te zien wat er wegvalt.

2. De randregels: tolregels die net buiten de gereden tijd van die dag
   vallen, maar binnen een marge van een kwartier voor de begintijd en een
   kwartier na de eindtijd. Die mogen desgewenst alsnog op de factuur, als
   losse keuze naast weekend en avonduren.

Welke tijden gelden er? Staan er voor die wagen en dag uren uit de
urenimport van het planbureau, dan tellen alleen die. Anders vallen we terug
op de uren die de chauffeur zelf heeft ingediend.

Deze module raakt de bestaande import- en facturatiecode niet aan; de
factuur wordt gewoon gemaakt zoals altijd en de gekozen randregels worden er
daarna bij gezet.
"""
from __future__ import annotations

import logging
import math
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .dagritnummers import _kentekenindex, _losse_nummers
from .models import TollingEvent, normalize_plate

logger = logging.getLogger(__name__)

# Standaardmarge rond de gereden tijd, in minuten.
MARGE_MINUTEN = 15

REDEN_LABELS = {
    'weekend': 'Weekend',
    'na_afkapuur': 'Na het afkapuur',
    'ander_bedrijf': 'Ander bedrijf',
}


# ---------------------------------------------------------------------------
# Hulpjes
# ---------------------------------------------------------------------------

def _lokaal(tijdstip):
    """Zet een tijdstip om naar de lokale tijdzone."""
    if tijdstip is None:
        return None
    return timezone.localtime(tijdstip) if timezone.is_aware(tijdstip) else tijdstip


def week_grenzen(jaar: int, week: int) -> tuple[datetime, datetime]:
    """Begin (inclusief) en einde (exclusief) van een ISO-week, lokaal."""
    maandag = date.fromisocalendar(jaar, week, 1)
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(maandag, time.min), tz)
    return start, start + timedelta(days=7)


def weken_vanaf(jaar: int, week_start: int, aantal: int) -> list[tuple[int, int]]:
    """Opeenvolgende ISO-weken, net als bij het maken van de factuur."""
    weken: list[tuple[int, int]] = []
    j, w = jaar, week_start
    for _ in range(max(1, aantal)):
        weken.append((j, w))
        volgende = date.fromisocalendar(j, w, 1) + timedelta(days=7)
        iso = volgende.isocalendar()
        j, w = iso[0], iso[1]
    return weken


def _geld(waarde) -> Decimal:
    return Decimal(waarde or 0)


# ---------------------------------------------------------------------------
# Gereden tijden per dag
# ---------------------------------------------------------------------------

def vensters_per_dag(kentekens, datums) -> dict:
    """Gereden tijdvakken per (kenteken, datum).

    Levert ``{(kenteken, datum): [{'begin', 'eind', 'ritnummers', 'bron'}]}``.

    Zijn er geimporteerde uren voor die wagen op die dag, dan tellen alleen
    die. Zo niet, dan de uren die de chauffeur zelf heeft ingediend.

    Elk vak heeft ``definitief``: geimporteerde uren en ingediende uren zijn
    definitief, uren die nog in concept staan niet.
    """
    from apps.timetracking.models import ImportedTimeEntry, TimeEntry, TimeEntryStatus

    kentekens = {k for k in kentekens if k}
    datums = {d for d in datums if d}
    if not kentekens or not datums:
        return {}

    index = _kentekenindex()
    per_bron: dict[str, dict] = {'import': defaultdict(list), 'uren': defaultdict(list)}

    def voeg_toe(bron, ruw_kenteken, datum, ritnummer, begin, eind, chauffeur='',
                 definitief=True):
        if not (begin and eind):
            return
        norm = normalize_plate(ruw_kenteken)
        norm = index.get(norm, norm)
        if norm not in kentekens or datum not in datums:
            return
        vak = {
            'begin': begin,
            'eind': eind,
            'ritnummers': _losse_nummers(ritnummer),
            'bron': bron,
            'chauffeur': (chauffeur or '').strip(),
            'definitief': bool(definitief),
        }
        bestaand = per_bron[bron][(norm, datum)]
        dubbel = next((v for v in bestaand if v['begin'] == begin and v['eind'] == eind), None)
        if dubbel is None:
            bestaand.append(vak)
        elif vak['definitief'] and not dubbel['definitief']:
            # Zelfde tijdvak, maar deze versie is wel ingediend: die telt.
            dubbel['definitief'] = True

    for kenteken, datum, ritlijst, begin, eind, voornaam, achternaam in (
        ImportedTimeEntry.objects.filter(datum__in=datums)
        .values_list('kenteken_import', 'datum', 'ritlijst',
                     'begintijd_rit', 'eindtijd_rit',
                     'user__voornaam', 'user__achternaam')
    ):
        voeg_toe('import', kenteken, datum, ritlijst, begin, eind,
                 f'{voornaam or ""} {achternaam or ""}')

    for kenteken, datum, ritnummer, begin, eind, voornaam, achternaam, status in (
        TimeEntry.objects.filter(datum__in=datums)
        .values_list('kenteken', 'datum', 'ritnummer', 'aanvang', 'eind',
                     'user__voornaam', 'user__achternaam', 'status')
    ):
        voeg_toe('uren', kenteken, datum, ritnummer, begin, eind,
                 f'{voornaam or ""} {achternaam or ""}',
                 definitief=status == TimeEntryStatus.INGEDIEND)

    resultaat: dict = {}
    for sleutel in set(per_bron['import']) | set(per_bron['uren']):
        # Geimporteerde uren gaan voor op de ingediende uren.
        resultaat[sleutel] = per_bron['import'].get(sleutel) or per_bron['uren'].get(sleutel) or []
    return {k: v for k, v in resultaat.items() if v}


def _venster_grenzen(dag: date, vak: dict) -> tuple[datetime, datetime]:
    """Begin- en eindmoment van een rit; een nachtrit loopt door na 00:00."""
    begin = datetime.combine(dag, vak['begin'])
    eind = datetime.combine(dag, vak['eind'])
    if eind < begin:
        eind += timedelta(days=1)
    return begin, eind


def _venster_label(dag: date, vak: dict) -> str:
    bron = 'urenimport' if vak['bron'] == 'import' else 'ingediende uren'
    rit = ' / '.join(vak['ritnummers']) if vak['ritnummers'] else ''
    tijden = f"{vak['begin'].strftime('%H:%M')} - {vak['eind'].strftime('%H:%M')}"
    stuk = f"{dag.strftime('%d-%m')} {tijden} ({bron})"
    return f"{stuk} rit {rit}" if rit else stuk


def _dag_info(dag: date, vakken: list) -> dict:
    """De gereden tijden van die dag, zoals ze in de uren staan."""
    if not vakken:
        return {'dag_uren': '', 'dag_chauffeur': '', 'dag_bron': '',
                'dag_ritnummers': '', 'dag_datum': '', 'dag_definitief': True}
    tijden = ' / '.join(
        f"{v['begin'].strftime('%H:%M')} - {v['eind'].strftime('%H:%M')}" for v in vakken
    )
    chauffeurs = []
    ritten = []
    for v in vakken:
        if v.get('chauffeur') and v['chauffeur'] not in chauffeurs:
            chauffeurs.append(v['chauffeur'])
        for nummer in v['ritnummers']:
            if nummer not in ritten:
                ritten.append(nummer)
    return {
        'dag_uren': tijden,
        'dag_chauffeur': ' / '.join(chauffeurs),
        'dag_bron': 'urenimport' if vakken[0]['bron'] == 'import' else 'ingediende uren',
        'dag_ritnummers': ' / '.join(ritten),
        'dag_datum': dag.isoformat(),
        'dag_definitief': all(v.get('definitief', True) for v in vakken),
    }


def tijdstatus(events, marge_minuten: int = MARGE_MINUTEN,
               alleen_definitief: bool = False) -> dict:
    """Bepaal per tolregel of hij binnen de gereden tijd of in de marge valt.

    Levert ``{event_id: {'status': 'binnen'|'marge'|'buiten'|'onbekend',
    'venster': tekst, 'dag_uren': ..., 'dag_chauffeur': ...,
    'afwijking_minuten': ..., 'afwijking_richting': 'voor'|'na'|''}}``.
    Een rit die over middernacht loopt telt ook mee voor de passages van de
    dag erna, daarom kijken we ook naar de vorige dag.
    """
    marge = timedelta(minutes=max(0, int(marge_minuten or 0)))
    kentekens: set = set()
    datums: set = set()
    momenten: dict = {}
    for ev in events:
        lokaal = _lokaal(getattr(ev, 'start_at', None))
        if not lokaal:
            continue
        plaat = getattr(ev, 'license_plate_normalized', '') or ''
        dag = lokaal.date()
        momenten[ev.id] = (plaat, dag, lokaal.replace(tzinfo=None))
        kentekens.add(plaat)
        datums.add(dag)
        datums.add(dag - timedelta(days=1))

    if not momenten:
        return {}

    vakken = vensters_per_dag(kentekens, datums)
    if alleen_definitief:
        # Uren die nog in concept staan tellen niet mee; de dag geldt dan als
        # 'geen uren bekend'.
        vakken = {
            sleutel: [v for v in lijst if v.get('definitief', True)]
            for sleutel, lijst in vakken.items()
        }
        vakken = {k: v for k, v in vakken.items() if v}

    resultaat: dict = {}
    for ev_id, (plaat, dag, moment) in momenten.items():
        beste = 'onbekend'
        label = ''
        # De dag waar de tolregel bij hoort. Standaard de dag zelf; alleen een
        # nachtrit van de dag ervoor kan die claimen.
        info_dag = dag
        afwijking = None
        richting = ''
        for kandidaat_dag in (dag, dag - timedelta(days=1)):
            for vak in vakken.get((plaat, kandidaat_dag), []):
                begin, eind = _venster_grenzen(kandidaat_dag, vak)
                if kandidaat_dag != dag and eind.date() < dag:
                    # Rit van gisteren die voor middernacht klaar was: die zegt
                    # niets over een passage van vandaag.
                    continue
                if begin <= moment <= eind:
                    beste = 'binnen'
                    label = _venster_label(kandidaat_dag, vak)
                    info_dag = kandidaat_dag
                    afwijking = 0
                    richting = ''
                    break
                # Hoeveel minuten ligt de passage voor of na de rit?
                if moment < begin:
                    verschil = (begin - moment).total_seconds() / 60
                    kant = 'voor'
                else:
                    verschil = (moment - eind).total_seconds() / 60
                    kant = 'na'
                if afwijking is None or verschil < afwijking:
                    afwijking = verschil
                    richting = kant
                    info_dag = kandidaat_dag
                if begin - marge <= moment <= eind + marge:
                    if beste != 'binnen':
                        beste = 'marge'
                        label = _venster_label(kandidaat_dag, vak)
                elif beste == 'onbekend':
                    beste = 'buiten'
            if beste == 'binnen':
                break
        rij = {'status': beste, 'venster': label}
        rij.update(_dag_info(info_dag, vakken.get((plaat, info_dag), [])))
        rij['afwijking_minuten'] = None if afwijking is None else int(math.ceil(afwijking))
        rij['afwijking_richting'] = richting
        resultaat[ev_id] = rij
    return resultaat


# ---------------------------------------------------------------------------
# Overzicht van de selectie
# ---------------------------------------------------------------------------

def _event_dict(ev, tijd: dict) -> dict:
    start = _lokaal(ev.start_at)
    eind = _lokaal(ev.end_at)
    return {
        'id': str(ev.id),
        'datum': start.date().isoformat() if start else None,
        'start': start.strftime('%d-%m-%Y %H:%M') if start else '',
        'eind': eind.strftime('%H:%M') if eind else '',
        'km': float(ev.distance_km or 0),
        'bedrag': float(ev.amount or 0),
        'ritnummer': (ev.ritnummer or '').strip(),
        'tijd_status': tijd.get('status', 'onbekend'),
        'rit_venster': tijd.get('venster', ''),
    }


def _totalen(rijen) -> dict:
    return {
        'aantal': len(rijen),
        'km': round(sum(r['km'] for r in rijen), 3),
        'bedrag': round(sum(r['bedrag'] for r in rijen), 2),
    }


def selectie_overzicht(plate: str, jaar: int, week_start: int, period_weeks: int,
                       bedrijf_id, exclude_weekend: bool, cutoff_time,
                       marge_minuten: int = MARGE_MINUTEN) -> dict:
    """Laat zien wat er op de factuur komt en wat er buiten valt.

    Gebruikt exact dezelfde regels als het maken van de factuur, zodat het
    overzicht klopt met wat er straks daadwerkelijk gebeurt. Er wordt niets
    gewijzigd.
    """
    norm = normalize_plate(plate)
    weken = weken_vanaf(jaar, week_start, period_weeks)
    start = week_grenzen(*weken[0])[0]
    eind = week_grenzen(*weken[-1])[1]

    events = list(
        TollingEvent.objects.filter(
            license_plate_normalized=norm,
            invoiced_at__isnull=True,
            is_private=False,
            start_at__gte=start,
            start_at__lt=eind,
        ).order_by('start_at')
    )
    tijden = tijdstatus(events, marge_minuten)

    meegenomen: list[dict] = []
    overgeslagen: list[dict] = []
    for ev in events:
        lokaal = _lokaal(ev.start_at)
        if not lokaal:
            continue
        rij = _event_dict(ev, tijden.get(ev.id, {}))
        reden = None
        if exclude_weekend and lokaal.isoweekday() >= 6:
            reden = 'weekend'
        elif cutoff_time is not None and lokaal.time() >= cutoff_time:
            reden = 'na_afkapuur'
        elif bedrijf_id and ev.bedrijf_id is not None and str(ev.bedrijf_id) != str(bedrijf_id):
            reden = 'ander_bedrijf'
        if reden is None:
            meegenomen.append(rij)
        else:
            rij['reden'] = reden
            rij['reden_label'] = REDEN_LABELS[reden]
            overgeslagen.append(rij)

    # Randregels: vallen nu buiten de factuur, maar de wagen was op dat
    # moment wel aan het rijden - binnen de gereden tijd zelf, of binnen een
    # kwartier ervoor of erna.
    marge_regels = [r for r in overgeslagen if r['tijd_status'] in ('binnen', 'marge')]

    per_dag: dict[str, dict] = {}
    for rij in meegenomen:
        vak = per_dag.setdefault(rij['datum'], {'datum': rij['datum'], 'aantal': 0,
                                                'km': 0.0, 'bedrag': 0.0})
        vak['aantal'] += 1
        vak['km'] = round(vak['km'] + rij['km'], 3)
        vak['bedrag'] = round(vak['bedrag'] + rij['bedrag'], 2)

    return {
        'plate': norm,
        'marge_minuten': int(marge_minuten or 0),
        'weken': [
            {'year': j, 'week': w, 'label': f'Week {w:02d} {j}'} for j, w in weken
        ],
        'samenvatting': {
            'meegenomen': _totalen(meegenomen),
            'niet_meegenomen': _totalen(overgeslagen),
            'marge': _totalen(marge_regels),
        },
        'meegenomen_per_dag': sorted(per_dag.values(), key=lambda v: v['datum'] or ''),
        'niet_meegenomen': overgeslagen,
        'marge_regels': marge_regels,
    }


# ---------------------------------------------------------------------------
# Randregels alsnog op de factuur zetten
# ---------------------------------------------------------------------------

def _regel_voor_event(lijnen, ev) -> object | None:
    """Zoek de tolheffing-factuurregel die bij de week van deze tolregel hoort."""
    lokaal = _lokaal(ev.start_at)
    if not lokaal:
        return None
    iso = lokaal.date().isocalendar()
    plaat = ev.license_plate_normalized or ''
    passend = [
        r for r in lijnen
        if (r.extra_data or {}).get('plate_normalized') == plaat
    ] or lijnen
    for regel in passend:
        extra = regel.extra_data or {}
        if extra.get('period') == 'week' and extra.get('year') == iso[0] and extra.get('index') == iso[1]:
            return regel
    return passend[0] if len(passend) == 1 else None


@transaction.atomic
def voeg_marge_events_toe(invoice, event_ids, user=None,
                          marge_minuten: int = MARGE_MINUTEN) -> dict:
    """Zet de gekozen randregels alsnog op een zojuist gemaakte factuur.

    De regel van de bijbehorende week wordt opgehoogd met het bedrag en de
    kilometers; de tolregels worden aan die regel gekoppeld, zodat ze ook in
    de bijlage bij de factuur terugkomen.
    """
    from apps.invoicing.models import InvoiceLine

    ids = [str(i) for i in (event_ids or []) if i]
    if not ids:
        return {'toegevoegd': 0, 'overgeslagen': 0, 'bedrag': 0.0, 'km': 0.0}

    lijnen = [
        r for r in InvoiceLine.objects.select_for_update().filter(invoice=invoice)
        if (r.extra_data or {}).get('source') == 'tolling'
    ]
    if not lijnen:
        return {'toegevoegd': 0, 'overgeslagen': len(ids), 'bedrag': 0.0, 'km': 0.0,
                'detail': 'Geen tolheffing-regel op deze factuur.'}

    events = list(
        TollingEvent.objects.select_for_update().filter(
            id__in=ids, is_private=False,
            invoiced_at__isnull=True, invoice_line__isnull=True,
        )
    )
    overgeslagen = len(ids) - len(events)

    nu = timezone.now()
    per_regel: dict = defaultdict(list)
    for ev in events:
        regel = _regel_voor_event(lijnen, ev)
        if regel is None:
            overgeslagen += 1
            continue
        per_regel[regel.id].append(ev)

    toegevoegd = 0
    totaal_bedrag = Decimal('0')
    totaal_km = Decimal('0')
    for regel in lijnen:
        evs = per_regel.get(regel.id)
        if not evs:
            continue
        bedrag = sum((_geld(e.amount) for e in evs), Decimal('0'))
        km = sum((_geld(e.distance_km) for e in evs), Decimal('0'))
        regel.prijs_per_eenheid = (_geld(regel.prijs_per_eenheid) + bedrag).quantize(Decimal('0.01'))
        extra = dict(regel.extra_data or {})
        extra['total_km'] = round(float(extra.get('total_km') or 0) + float(km), 3)
        extra['events_count'] = int(extra.get('events_count') or 0) + len(evs)
        extra['marge_events_count'] = int(extra.get('marge_events_count') or 0) + len(evs)
        extra['marge_minuten'] = int(marge_minuten or 0)
        regel.extra_data = extra
        # 'totaal' hoort erbij: dat veld wordt in save() herberekend uit het
        # aantal maal de prijs en is de basis voor het factuurtotaal.
        regel.save(update_fields=['prijs_per_eenheid', 'totaal', 'extra_data'])
        for ev in evs:
            ev.invoice_line = regel
            ev.invoiced_at = nu
        TollingEvent.objects.bulk_update(evs, ['invoice_line', 'invoiced_at'])
        toegevoegd += len(evs)
        totaal_bedrag += bedrag
        totaal_km += km

    invoice.calculate_totals()
    invoice.refresh_from_db()
    logger.info(
        "Tolheffing randregels toegevoegd aan %s: %d regels (%s) door %s",
        invoice.factuurnummer, toegevoegd, totaal_bedrag,
        getattr(user, 'email', 'onbekend'),
    )
    return {
        'toegevoegd': toegevoegd,
        'overgeslagen': overgeslagen,
        'bedrag': float(totaal_bedrag),
        'km': float(totaal_km),
        'subtotaal': float(invoice.subtotaal),
        'totaal': float(invoice.totaal),
    }

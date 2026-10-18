"""Herkoppelen ("sync") van tolregels aan bestaande factuurregels.

Na een volledige her-import van de tolheffing zijn alle `TollingEvent`-rijen
nieuw: ze staan op open terwijl ze in werkelijkheid al gefactureerd zijn. De
factuurregels zelf zijn er nog wel. Deze module zoekt per factuurregel de
bijbehorende tolregels terug op basis van kenteken, periode, bedrag en km, en
kan ze daarna weer aan die factuurregel koppelen.

Bewust een losse module: de import (`services.py`) en de facturatie
(`views.py`) worden hier niet aangeraakt. Koppelen gebeurt exact zoals de
facturatie dat doet: `invoice_line` zetten en `invoiced_at` vullen.
"""
from __future__ import annotations

import calendar
import logging
import re
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.invoicing.models import InvoiceLine

from .models import TollingEvent, normalize_plate

logger = logging.getLogger(__name__)

# Filtervarianten waarmee oorspronkelijk gefactureerd kan zijn:
# (weekend uitsluiten, afkapuur). Volgorde = volgorde van proberen.
FILTER_VARIANTEN: tuple[tuple[bool, int | None], ...] = (
    (False, None),
    (True, None),
    (True, 20),
    (True, 18),
    (False, 20),
)

# Zoekvensters rond de factuurdatum, van klein naar groot. Een kleine
# marge vooruit vangt facturen die een dag te vroeg zijn gedateerd.
VENSTERS_DAGEN: tuple[int, ...] = (10, 17, 31, 45, 75)
MARGE_VOORUIT_DAGEN = 3

# Maximale afwijking (km) tussen factuurregel en gevonden tolregels.
KM_TOLERANTIE = 1.5

_KM_RE = re.compile(r'([\d.]+)\s*km', re.IGNORECASE)
_NIET_ALNUM = re.compile(r'[^A-Z0-9]')

_LANDWOORDEN = {
    'DE': ('duitsland', 'duitse', 'maut', 'toll collect'),
    'NL': ('nederland', 'nederlandse'),
    'BE': ('belgi', 'viapass'),
}
# Losse landcodes tellen alleen als ze als hoofdletters op de regel staan.
_LANDCODE_RE = re.compile(r'\b(DE|NL|BE)\b')

_MAANDEN = {
    'januari': 1, 'februari': 2, 'maart': 3, 'april': 4, 'mei': 5, 'juni': 6,
    'juli': 7, 'augustus': 8, 'september': 9, 'oktober': 10, 'november': 11,
    'december': 12,
}

# "17-08 t/m 31-08" of "1-09 tm 15-09"
_DDMM_BEREIK_RE = re.compile(
    r'(\d{1,2})-(\d{1,2})\s*(?:t/m|tm|t\.m\.|-|tot en met)\s*(\d{1,2})-(\d{1,2})')
# "24 - 25 september"
_DAGEN_MAAND_RE = re.compile(
    r'(\d{1,2})\s*(?:-|t/m|tm|tot en met)\s*(\d{1,2})\s+('
    + '|'.join(_MAANDEN) + r')')
_MAAND_RE = re.compile(r'\b(' + '|'.join(_MAANDEN) + r')\b')


@dataclass
class Match:
    """Gevonden set tolregels bij één factuurregel."""
    events: list[TollingEvent] = field(default_factory=list)
    methode: str = ''
    vertrouwen: str = 'geen'  # zeker | waarschijnlijk | onzeker | geen


def _lokaal(moment: datetime) -> datetime:
    tz = timezone.get_current_timezone()
    return moment.astimezone(tz) if timezone.is_aware(moment) else moment


def _centen(bedrag) -> int:
    return int((Decimal(bedrag) * 100).quantize(Decimal('1')))


def is_tolregel(line: InvoiceLine) -> bool:
    """Is dit een factuurregel met tolheffing?"""
    extra = line.extra_data or {}
    if extra.get('source') == 'tolling':
        return True
    return (line.omschrijving or '').strip().lower().startswith('tolheffing')


def is_creditregel(line: InvoiceLine) -> bool:
    """Creditregels spiegelen een bronregel; die krijgen geen eigen events."""
    extra = line.extra_data or {}
    if extra.get('credit_of_invoice_id') or extra.get('credit_of_line_id'):
        return True
    return getattr(line.invoice, 'type', '') == 'credit'


def bekende_kentekens() -> list[str]:
    """Alle genormaliseerde kentekens die in de tolheffing voorkomen.

    Gesorteerd op lengte zodat het langste kenteken als eerste matcht.
    """
    platen = (
        TollingEvent.objects
        .values_list('license_plate_normalized', flat=True)
        .distinct()
    )
    return sorted({p for p in platen if p}, key=len, reverse=True)


def kenteken_van_regel(line: InvoiceLine, platen: list[str]) -> tuple[str | None, list[str]]:
    """Kenteken uit `extra_data`, anders uit de omschrijving.

    Geeft (kenteken, alle gevonden kentekens) terug. Bij meerdere treffers is
    het kenteken `None`: dan is de regel niet automatisch te bepalen.
    """
    extra = line.extra_data or {}
    uit_extra = normalize_plate(extra.get('plate_normalized') or extra.get('plate') or '')
    if uit_extra:
        return uit_extra, [uit_extra]
    tekst = _NIET_ALNUM.sub('', (line.omschrijving or '').upper())
    treffers = [p for p in platen if p and p in tekst]
    if len(treffers) == 1:
        return treffers[0], treffers
    return None, treffers


def km_van_regel(line: InvoiceLine) -> float | None:
    """Het aantal km dat op de factuurregel staat."""
    extra = line.extra_data or {}
    if extra.get('total_km') is not None:
        try:
            return float(extra['total_km'])
        except (TypeError, ValueError):
            pass
    gevonden = _KM_RE.search(line.omschrijving or '')
    if not gevonden:
        return None
    try:
        return float(gevonden.group(1).replace('.', ''))
    except ValueError:
        return None


def landen_van_regel(line: InvoiceLine) -> set[str]:
    """Landcodes die de omschrijving noemt, bijv. "Duitsland" of "NL + DE"."""
    omschrijving = line.omschrijving or ''
    tekst = omschrijving.lower()
    landen = set(_LANDCODE_RE.findall(omschrijving))
    for code, woorden in _LANDWOORDEN.items():
        if any(w in tekst for w in woorden):
            landen.add(code)
    return landen


def _jaar_bij(maand: int, factuurdatum: date) -> int:
    """Een factuur loopt altijd achter op de rit, nooit vooruit."""
    jaar = factuurdatum.year
    return jaar - 1 if maand > factuurdatum.month else jaar


def periode_van_regel(line: InvoiceLine) -> tuple[date, date] | None:
    """Periode uit de omschrijving, als die er expliciet in staat.

    Verzamelregels als "Tolheffing Duitsland voor augustus" noemen geen
    kenteken maar wel een tijdvak; dat is dan de enige harde ingang.
    """
    tekst = (line.omschrijving or '').lower()
    factuurdatum = line.invoice.factuurdatum or timezone.localdate()

    bereik = _DDMM_BEREIK_RE.search(tekst)
    if bereik:
        d1, m1, d2, m2 = (int(g) for g in bereik.groups())
        try:
            return (date(_jaar_bij(m1, factuurdatum), m1, d1),
                    date(_jaar_bij(m2, factuurdatum), m2, d2))
        except ValueError:
            return None

    dagen = _DAGEN_MAAND_RE.search(tekst)
    if dagen:
        d1, d2, naam = dagen.groups()
        maand = _MAANDEN.get(naam)
        if maand:
            try:
                jaar = _jaar_bij(maand, factuurdatum)
                return date(jaar, maand, int(d1)), date(jaar, maand, int(d2))
            except ValueError:
                return None

    maandnaam = _MAAND_RE.search(tekst)
    if maandnaam:
        maand = _MAANDEN[maandnaam.group(1)]
        jaar = _jaar_bij(maand, factuurdatum)
        laatste = calendar.monthrange(jaar, maand)[1]
        return date(jaar, maand, 1), date(jaar, maand, laatste)
    return None


def _dagmap(events: list[TollingEvent], excl_weekend: bool,
            afkapuur: int | None) -> dict[date, list[TollingEvent]]:
    """Events per lokale dag, met de gekozen filtervariant toegepast."""
    per_dag: dict[date, list[TollingEvent]] = defaultdict(list)
    for ev in events:
        lokaal = _lokaal(ev.start_at)
        if excl_weekend and lokaal.isoweekday() >= 6:
            continue
        if afkapuur is not None and lokaal.hour >= afkapuur:
            continue
        per_dag[lokaal.date()].append(ev)
    return per_dag


def _subset_exact(waarden: list[int], doel: int, limiet: int = 200000) -> tuple[int, ...] | None:
    """Zoek een deelverzameling die exact op `doel` centen uitkomt."""
    if doel <= 0:
        return None
    bereikbaar: dict[int, tuple[int, ...]] = {0: ()}
    for index, waarde in enumerate(waarden):
        if waarde <= 0 or waarde > doel:
            continue
        nieuw = dict(bereikbaar)
        for som, combinatie in bereikbaar.items():
            totaal = som + waarde
            if totaal <= doel and totaal not in nieuw:
                nieuw[totaal] = combinatie + (index,)
        bereikbaar = nieuw
        if doel in bereikbaar:
            return bereikbaar[doel]
        if len(bereikbaar) > limiet:
            break
    return bereikbaar.get(doel)


def _km_klopt(events: list[TollingEvent], doel_km: float | None) -> bool:
    if doel_km is None:
        return True
    km = float(sum((ev.distance_km for ev in events), Decimal('0')))
    return abs(km - doel_km) <= max(KM_TOLERANTIE, doel_km * 0.002)


def _spanwijdte_dagen(events: list[TollingEvent]) -> int:
    dagen = sorted({_lokaal(ev.start_at).date() for ev in events})
    if not dagen:
        return 0
    return (dagen[-1] - dagen[0]).days + 1


def _zoek_reeks(pool: list[TollingEvent], doel_centen: int,
                doel_km: float | None) -> Match | None:
    """Fase 1: de hele periode of een aaneengesloten reeks dagen."""
    for excl_weekend, afkapuur in FILTER_VARIANTEN:
        per_dag = _dagmap(pool, excl_weekend, afkapuur)
        dagen = sorted(per_dag)
        if not dagen:
            continue
        dagbedrag = [_centen(sum((e.amount for e in per_dag[d]), Decimal('0'))) for d in dagen]

        alles = [e for d in dagen for e in per_dag[d]]
        if sum(dagbedrag) == doel_centen and _km_klopt(alles, doel_km):
            return Match(alles, 'alle regels in periode', _vertrouwen_span(alles, 'zeker'))

        for i in range(len(dagen)):
            som = 0
            for j in range(i, len(dagen)):
                som += dagbedrag[j]
                if som > doel_centen:
                    break
                if som == doel_centen:
                    reeks = [e for d in dagen[i:j + 1] for e in per_dag[d]]
                    if _km_klopt(reeks, doel_km):
                        return Match(
                            reeks,
                            f'dagen {dagen[i]:%d-%m} t/m {dagen[j]:%d-%m}',
                            _vertrouwen_span(reeks, 'zeker'),
                        )
    return None


def _zoek_events_per_week(pool: list[TollingEvent], doel_centen: int,
                          doel_km: float | None) -> Match | None:
    """Fase 2: deel van een dag — per kalenderweek op regelniveau zoeken.

    Zo zijn facturen terug te vinden die destijds op rittijden zijn gematcht,
    waarbij binnen een dag maar een deel van de passages meeging.
    """
    for excl_weekend, afkapuur in FILTER_VARIANTEN:
        per_dag = _dagmap(pool, excl_weekend, afkapuur)
        dagen = sorted(per_dag)
        weken = sorted({(d.isocalendar()[0], d.isocalendar()[1]) for d in dagen})
        for jaar, week in weken:
            in_week = [e for d in dagen if d.isocalendar()[:2] == (jaar, week)
                       for e in per_dag[d]]
            if not in_week:
                continue
            combinatie = _subset_exact([_centen(e.amount) for e in in_week], doel_centen)
            if not combinatie:
                continue
            gekozen = [in_week[i] for i in combinatie]
            if _km_klopt(gekozen, doel_km):
                return Match(gekozen, f'losse regels uit week {week:02d}', 'waarschijnlijk')
    return None


def _zoek_losse_dagen(pool: list[TollingEvent], doel_centen: int,
                      doel_km: float | None) -> Match | None:
    """Fase 3: losse dagen die samen het factuurbedrag vormen."""
    for excl_weekend, afkapuur in FILTER_VARIANTEN:
        per_dag = _dagmap(pool, excl_weekend, afkapuur)
        dagen = sorted(per_dag)
        if not dagen:
            continue
        dagbedrag = [_centen(sum((e.amount for e in per_dag[d]), Decimal('0'))) for d in dagen]
        combinatie = _subset_exact(dagbedrag, doel_centen)
        if not combinatie:
            continue
        gekozen = [e for i in combinatie for e in per_dag[dagen[i]]]
        if _km_klopt(gekozen, doel_km):
            return Match(gekozen, 'losse dagen', _vertrouwen_span(gekozen, 'waarschijnlijk'))
    return None


# Fases op volgorde van betrouwbaarheid.
ZOEKFASES = (_zoek_reeks, _zoek_events_per_week, _zoek_losse_dagen)


def _vertrouwen_span(events: list[TollingEvent], basis: str) -> str:
    """Hoe verder de gevonden regels uit elkaar liggen, hoe minder zeker."""
    span = _spanwijdte_dagen(events)
    if span <= 10:
        return basis
    if basis == 'zeker':
        return 'waarschijnlijk'
    return 'onzeker'


def _pool(bron: list[TollingEvent], van: date, tot: date,
          geclaimd: set) -> list[TollingEvent]:
    pool = []
    for ev in bron:
        if ev.id in geclaimd:
            continue
        dag = _lokaal(ev.start_at).date()
        if van <= dag <= tot:
            pool.append(ev)
    return pool


def _vrije_events() -> tuple[dict[str, list[TollingEvent]], dict[str, list[TollingEvent]]]:
    """Alle nog niet gefactureerde, niet-privé tolregels.

    Twee ingangen: per kenteken en per opdrachtgever. Die tweede is nodig voor
    verzamelregels als "Tolheffing Duitsland voor augustus", waar geen kenteken
    in de omschrijving staat.
    """
    per_kenteken: dict[str, list[TollingEvent]] = defaultdict(list)
    per_bedrijf: dict[str, list[TollingEvent]] = defaultdict(list)
    qs = (
        TollingEvent.objects
        .filter(invoiced_at__isnull=True, invoice_line__isnull=True, is_private=False)
        .order_by('start_at')
    )
    for ev in qs:
        per_kenteken[ev.license_plate_normalized].append(ev)
        if ev.bedrijf_id:
            per_bedrijf[str(ev.bedrijf_id)].append(ev)
    return per_kenteken, per_bedrijf


def _regel_dict(line: InvoiceLine) -> dict:
    invoice = line.invoice
    return {
        'line_id': str(line.id),
        'invoice_id': str(invoice.id),
        'factuurnummer': invoice.factuurnummer,
        'factuurdatum': invoice.factuurdatum.isoformat() if invoice.factuurdatum else None,
        'invoice_type': invoice.type,
        'invoice_status': invoice.status,
        'bedrijf_id': str(invoice.bedrijf_id) if invoice.bedrijf_id else None,
        'bedrijf_naam': invoice.bedrijf.naam if invoice.bedrijf_id else '',
        'omschrijving': line.omschrijving,
        'bedrag': float(line.totaal or 0),
    }


def _match_dict(match: Match | None, regel_bedrag: float = 0.0) -> dict:
    if not match or not match.events:
        return {
            'gevonden_events': 0, 'gevonden_bedrag': 0.0, 'gevonden_km': 0.0,
            'periode_van': None, 'periode_tot': None,
            'methode': '', 'vertrouwen': 'geen', 'grondslag': '',
            'verschil_bedrag': 0.0, 'event_ids': [],
        }
    dagen = sorted({_lokaal(e.start_at).date() for e in match.events})
    bedrag = float(sum((e.amount for e in match.events), Decimal('0')))
    return {
        'gevonden_events': len(match.events),
        'gevonden_bedrag': bedrag,
        'gevonden_km': float(sum((e.distance_km for e in match.events), Decimal('0'))),
        'periode_van': dagen[0].isoformat(),
        'periode_tot': dagen[-1].isoformat(),
        'methode': match.methode,
        'vertrouwen': match.vertrouwen,
        'grondslag': 'bedrag',
        'verschil_bedrag': round(bedrag - regel_bedrag, 2),
        'event_ids': [str(e.id) for e in match.events],
    }


def te_synchroniseren_regels(datum_vanaf: date | None = None,
                             datum_tot: date | None = None,
                             bedrijf_id: str | None = None) -> list[InvoiceLine]:
    """Tolheffing-factuurregels zonder gekoppelde tolregels."""
    qs = (
        InvoiceLine.objects
        .select_related('invoice', 'invoice__bedrijf')
        .prefetch_related('tolling_events')
    )
    if datum_vanaf:
        qs = qs.filter(invoice__factuurdatum__gte=datum_vanaf)
    if datum_tot:
        qs = qs.filter(invoice__factuurdatum__lte=datum_tot)
    if bedrijf_id:
        qs = qs.filter(invoice__bedrijf_id=bedrijf_id)
    regels = [
        line for line in qs
        if is_tolregel(line) and not is_creditregel(line)
        and not line.tolling_events.all()
    ]
    regels.sort(key=lambda l: (
        l.invoice.factuurdatum or date.min, l.invoice.factuurnummer, l.volgorde,
    ))
    return regels


def analyseer(datum_vanaf: date | None = None, datum_tot: date | None = None,
              bedrijf_id: str | None = None) -> dict:
    """Zoek voor elke losse factuurregel de bijbehorende tolregels.

    Verandert niets in de database; het resultaat is een voorstel.
    """
    regels = te_synchroniseren_regels(datum_vanaf, datum_tot, bedrijf_id)
    per_kenteken, per_bedrijf = _vrije_events()
    # Herkennen op alle ooit geziene kentekens: een wagen waarvan toevallig
    # niets meer openstaat moet nog steeds uit de omschrijving te halen zijn.
    platen = bekende_kentekens()

    geclaimd: set = set()
    resultaten = []
    for line in regels:
        rij = _regel_dict(line)
        kenteken, treffers = kenteken_van_regel(line, platen)
        rij['kenteken'] = kenteken or ''
        rij['kenteken_opties'] = treffers
        rij['regel_km'] = km_van_regel(line)

        doel = _centen(line.totaal if line.totaal else line.prijs_per_eenheid)
        if doel <= 0:
            rij.update(_match_dict(None))
            rij['reden'] = 'Regel heeft geen bedrag'
            resultaten.append(rij)
            continue

        # Zonder kenteken valt de regel terug op alle tolheffing van de
        # opdrachtgever. Dat is een ruimere vijver, dus alleen de strengste
        # fase meedoen; een toevallige optelling is daar te snel gevonden.
        bedrijfsbreed = not kenteken
        if bedrijfsbreed:
            bron = per_bedrijf.get(rij['bedrijf_id'] or '', [])
            fases = ZOEKFASES[:1]
        else:
            bron = per_kenteken.get(kenteken, [])
            fases = ZOEKFASES

        landen = landen_van_regel(line)
        periode = periode_van_regel(line)
        rij['regel_landen'] = sorted(landen)
        rij['regel_periode'] = [p.isoformat() for p in periode] if periode else None
        if landen and bedrijfsbreed:
            # Lang niet elke tolregel heeft een land. Alleen uitsluiten wat
            # aantoonbaar een ander land is; onbekend blijft in de vijver.
            bron = [e for e in bron if not e.land or e.land in landen]
        if bedrijfsbreed and (landen or periode):
            # Land of periode snijdt de vijver genoeg bij om ook losse dagen
            # te mogen combineren.
            fases = ZOEKFASES

        if not bron:
            rij.update(_match_dict(None))
            rij['reden'] = ('Geen kenteken in de omschrijving en geen open '
                            'tolheffing voor deze opdrachtgever' if bedrijfsbreed
                            else 'Geen open tolheffing voor dit kenteken')
            resultaten.append(rij)
            continue

        factuurdatum = line.invoice.factuurdatum or timezone.localdate()
        # Staat de periode op de regel, dan is dat het enige toegestane
        # venster. Daarbuiten zoeken levert een match op die niet klopt.
        if periode:
            vensters = [periode]
        else:
            vensters = [(factuurdatum - timedelta(days=d),
                         factuurdatum + timedelta(days=MARGE_VOORUIT_DAGEN))
                        for d in VENSTERS_DAGEN]
        match = None
        # Eerst de betrouwbaarste strategie over alle vensters, daarna pas de
        # fijnmazigere. Zo wint een nette dagreeks van een toevallige combinatie.
        for fase in fases:
            for van, tot in vensters:
                pool = _pool(bron, van, tot, geclaimd)
                if not pool:
                    continue
                match = fase(pool, doel, rij['regel_km'])
                if match:
                    break
            if match:
                break
        if match and bedrijfsbreed:
            match.vertrouwen = 'onzeker'
            match.methode = f'{match.methode}, over alle wagens van de klant'
        if match:
            geclaimd.update(e.id for e in match.events)
            rij['reden'] = ''
        else:
            rij['reden'] = 'Geen set tolregels gevonden die exact op dit bedrag uitkomt'
        rij.update(_match_dict(match, rij['bedrag']))
        resultaten.append(rij)

    samenvatting = {
        'regels': len(resultaten),
        'zeker': sum(1 for r in resultaten if r['vertrouwen'] == 'zeker'),
        'waarschijnlijk': sum(1 for r in resultaten if r['vertrouwen'] == 'waarschijnlijk'),
        'onzeker': sum(1 for r in resultaten if r['vertrouwen'] == 'onzeker'),
        'geen': sum(1 for r in resultaten if r['vertrouwen'] == 'geen'),
        'events_open': TollingEvent.objects.filter(
            invoiced_at__isnull=True, is_private=False).count(),
        'events_gefactureerd': TollingEvent.objects.filter(
            invoiced_at__isnull=False).count(),
    }
    return {'samenvatting': samenvatting, 'regels': resultaten}


def zoek_handmatig(kenteken: str, van: date, tot: date,
                   excl_weekend: bool = False,
                   afkapuur: int | None = None) -> dict:
    """Alle nog open tolregels van een kenteken binnen een periode."""
    norm = normalize_plate(kenteken)
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime.combine(van, time.min), tz)
    eind = timezone.make_aware(datetime.combine(tot + timedelta(days=1), time.min), tz)
    events = list(
        TollingEvent.objects
        .filter(license_plate_normalized=norm, is_private=False,
                invoiced_at__isnull=True, invoice_line__isnull=True,
                start_at__gte=start, start_at__lt=eind)
        .order_by('start_at')
    )
    if excl_weekend or afkapuur is not None:
        events = [
            e for e in events
            if not (excl_weekend and _lokaal(e.start_at).isoweekday() >= 6)
            and (afkapuur is None or _lokaal(e.start_at).hour < afkapuur)
        ]
    match = Match(events, 'handmatige selectie', 'handmatig') if events else None
    resultaat = _match_dict(match)
    # Bij handmatig zoeken is er geen factuurregel om tegen af te zetten.
    resultaat['verschil_bedrag'] = 0.0
    resultaat['kenteken'] = norm
    return resultaat


@transaction.atomic
def koppel(line: InvoiceLine, event_ids: list[str], user=None) -> int:
    """Koppel tolregels aan een factuurregel en zet ze op gefactureerd.

    Alleen regels die nog open zijn en niet privé, precies zoals de facturatie
    dat doet. Al gekoppelde regels worden overgeslagen.
    """
    events = list(
        TollingEvent.objects
        .select_for_update()
        .filter(id__in=event_ids, is_private=False,
                invoiced_at__isnull=True, invoice_line__isnull=True)
    )
    if not events:
        return 0
    nu = timezone.now()
    for ev in events:
        ev.invoice_line = line
        ev.invoiced_at = nu
    TollingEvent.objects.bulk_update(events, ['invoice_line', 'invoiced_at'])
    logger.info(
        'Tolheffing-sync: %d regels gekoppeld aan %s (%s) door %s',
        len(events), line.invoice.factuurnummer, line.omschrijving[:60],
        getattr(user, 'email', user),
    )
    return len(events)


@transaction.atomic
def ontkoppel(line: InvoiceLine, user=None) -> int:
    """Zet de tolregels van een factuurregel terug op open."""
    events = list(
        TollingEvent.objects.select_for_update().filter(invoice_line=line)
    )
    for ev in events:
        ev.invoice_line = None
        ev.invoiced_at = None
    TollingEvent.objects.bulk_update(events, ['invoice_line', 'invoiced_at'])
    logger.info(
        'Tolheffing-sync: %d regels ontkoppeld van %s door %s',
        len(events), line.invoice.factuurnummer, getattr(user, 'email', user),
    )
    return len(events)

"""Vergelijken van de ontvangen tolvergoeding met de tolheffing die wij betaalden.

De opdrachtgever vergoedt tolheffing per voertuig per afrekeningsperiode (de
'Maut' op zijn afrekening). Wij betalen de werkelijke tolheffing per passage.
Dit bestand koppelt beide aan elkaar:

1. Het ritnummer van de afrekening ("791") wordt via de vloot een kenteken.
2. Alle tolpassages van dat kenteken in de periode worden opgeteld.
3. Het verschil tussen betaald en ontvangen wordt zichtbaar gemaakt.

Daarnaast splitsen we de passages naar het moment waarop ze gereden zijn.
Binnen de werkdag (standaard 06:00-18:00, maandag t/m vrijdag) hoort de
vergoeding van de opdrachtgever de kosten te dekken. Passages in het weekend of
's avonds en 's nachts vallen daarbuiten: dat is werk dat wel voor de
opdrachtgever gereden is maar waarvoor de dagvergoeding niet geldt.

Meerdere afrekeningen samen optellen kan ook. Hun perioden overlappen elkaar
soms (de ene loopt tot 15 juli, de volgende begint op 14 juli), terwijl elke
voertuigdag maar op een van beide bonnen staat. De tolpassages worden daarom
over de vereniging van de perioden opgehaald en per passage maar een keer
geteld; de vergoedingen mogen gewoon opgeteld worden.

Tijden worden in de lokale tijdzone beoordeeld; de database bewaart UTC.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.db.models import Q
from django.utils import timezone

from .models import TollingEvent, normalize_plate

CENT = Decimal('0.01')

# De drie tijdvakken waarin een passage kan vallen.
BINNEN = 'binnen'
WEEKEND = 'weekend'
AVOND = 'avond'

# Signalen die om aandacht vragen bij het controleren van de afrekening.
OK = 'ok'
NIET_GEKOPPELD = 'niet_gekoppeld'
GEEN_TOLREGELS = 'geen_tolregels'
GEEN_VERGOEDING = 'geen_vergoeding'
TEKORT = 'tekort'

_SIGNAAL_TEKST = {
    NIET_GEKOPPELD: 'staat op geen enkele wagen in de vloot; de tolheffing kan niet '
                    'vergeleken worden.',
    GEEN_TOLREGELS: 'kreeg wel een tolvergoeding, maar er staat geen enkele tolpassage '
                    'op dit kenteken. Controleer of het kenteken in de tolimport klopt.',
    # Het ontbreken van een vergoeding meldt de parser al vanuit het bestand.
}


def _rond(waarde: Decimal) -> Decimal:
    return Decimal(waarde or 0).quantize(CENT)


def _geldend_ritnummer(vehicle, peildatum: date) -> str:
    """Het ritnummer dat op ``peildatum`` voor deze wagen gold.

    Een wagen kan van rit wisselen. De periode zonder begindatum geldt vanaf
    het begin; daarna telt steeds de laatst ingegane periode.
    """
    beste_datum = None
    beste_nummer = None
    for periode in vehicle.ritnummer_periodes.all():
        vanaf = periode.geldig_vanaf
        if vanaf is not None and vanaf > peildatum:
            continue
        # Een lege begindatum telt als 'vanaf het begin' en verliest dus van
        # elke periode die daadwerkelijk is ingegaan.
        sleutel = vanaf or date.min
        if beste_datum is None or sleutel >= beste_datum:
            beste_datum = sleutel
            beste_nummer = periode.ritnummer
    if beste_nummer is not None:
        return (beste_nummer or '').strip()
    return (vehicle.ritnummer or '').strip()


def ritnummer_index(peildatum: date) -> dict[str, list]:
    """Ritnummer (kleine letters) -> de wagens die er op ``peildatum`` bij horen."""
    from apps.fleet.models import Vehicle

    index: dict[str, list] = defaultdict(list)
    wagens = Vehicle.objects.prefetch_related('ritnummer_periodes').order_by(
        '-actief', 'kenteken')
    for wagen in wagens:
        nummer = _geldend_ritnummer(wagen, peildatum)
        if nummer:
            index[nummer.lower()].append(wagen)
    return index


def tijdvak(moment: datetime, werktijd_van: time, werktijd_tot: time) -> str:
    """In welk tijdvak valt deze passage, lokale tijd gerekend?"""
    lokaal = timezone.localtime(moment)
    if lokaal.weekday() >= 5:
        return WEEKEND
    klok = lokaal.time()
    if werktijd_van <= werktijd_tot:
        binnen_venster = werktijd_van <= klok < werktijd_tot
    else:
        # Een venster dat over middernacht heen loopt.
        binnen_venster = klok >= werktijd_van or klok < werktijd_tot
    return BINNEN if binnen_venster else AVOND


def _leeg_vak() -> dict:
    return {'aantal': 0, 'bedrag': Decimal('0'), 'km': Decimal('0')}


def _periodefilter(perioden) -> Q:
    """Een filter op ``start_at`` voor een of meer perioden (einddatum telt mee)."""
    filter_ = Q()
    for van, tot in perioden:
        start = timezone.make_aware(datetime.combine(van, time.min))
        eind = timezone.make_aware(datetime.combine(tot + timedelta(days=1), time.min))
        filter_ |= Q(start_at__gte=start, start_at__lt=eind)
    return filter_


def events_voor(kentekens, vehicle_ids, perioden):
    """De tolpassages van deze wagens binnen een of meer perioden.

    Overlappen de perioden elkaar, dan levert dit elke passage toch maar een
    keer op: het is een enkele query met een OR-filter.
    """
    kentekens = [k for k in kentekens if k]
    vehicle_ids = [v for v in vehicle_ids if v]
    if (not kentekens and not vehicle_ids) or not perioden:
        return TollingEvent.objects.none()

    doel = Q()
    if kentekens:
        doel |= Q(license_plate_normalized__in=kentekens)
    if vehicle_ids:
        doel |= Q(vehicle_id__in=vehicle_ids)
    return TollingEvent.objects.filter(doel & _periodefilter(perioden))


def events_van_groep(regels, perioden):
    """De tolpassages die horen bij de afrekeningsregels van één wagen."""
    kentekens: list[str] = []
    vehicle_ids: list = []
    for regel in regels:
        for kenteken in (regel.kentekens or []):
            if kenteken and kenteken not in kentekens:
                kentekens.append(kenteken)
        if regel.vehicle_id and regel.vehicle_id not in vehicle_ids:
            vehicle_ids.append(regel.vehicle_id)
    return events_voor(kentekens, vehicle_ids, perioden)


def _signaal(koppeling: str, ontvangen: Decimal, betaald: Decimal, passages: int) -> str:
    if koppeling != 'gekoppeld':
        return NIET_GEKOPPELD
    if ontvangen > 0 and passages == 0:
        return GEEN_TOLREGELS
    if ontvangen == 0 and betaald > 0:
        return GEEN_VERGOEDING
    if betaald > ontvangen:
        return TEKORT
    return OK


def analyseer_groep(regels, perioden, werktijd_van: time, werktijd_tot: time) -> dict:
    """Betaald versus ontvangen voor één wagen, gesplitst naar tijdvak.

    ``regels`` zijn alle afrekeningsregels van dezelfde wagen: bij één
    afrekening is dat er één, over een heel jaar zijn het er meer.
    """
    vakken = {BINNEN: _leeg_vak(), WEEKEND: _leeg_vak(), AVOND: _leeg_vak()}
    prive = _leeg_vak()
    gefactureerd_bedrag = Decimal('0')
    open_binnen = 0

    velden = ('start_at', 'amount', 'distance_km', 'is_private', 'invoiced_at')
    for start_at, bedrag, km, is_prive, gefactureerd_op in (
        events_van_groep(regels, perioden).values_list(*velden)
    ):
        bedrag = Decimal(bedrag or 0)
        km = Decimal(km or 0)
        if is_prive:
            prive['aantal'] += 1
            prive['bedrag'] += bedrag
            prive['km'] += km
            continue
        vak = tijdvak(start_at, werktijd_van, werktijd_tot)
        vakken[vak]['aantal'] += 1
        vakken[vak]['bedrag'] += bedrag
        vakken[vak]['km'] += km
        if gefactureerd_op:
            gefactureerd_bedrag += bedrag
        elif vak == BINNEN:
            open_binnen += 1

    eerste = regels[0]
    betaald = sum((v['bedrag'] for v in vakken.values()), Decimal('0'))
    buiten_bedrag = vakken[WEEKEND]['bedrag'] + vakken[AVOND]['bedrag']
    ontvangen = sum((Decimal(r.maut_ontvangen or 0) for r in regels), Decimal('0'))
    passages = sum(v['aantal'] for v in vakken.values())
    koppeling = ('gekoppeld' if all(r.koppeling == 'gekoppeld' for r in regels)
                 else eerste.koppeling)

    def som(veld: str) -> Decimal:
        return sum((Decimal(getattr(r, veld) or 0) for r in regels), Decimal('0'))

    return {
        'id': eerste.ritnummer or str(eerste.id),
        'regel_ids': [str(r.id) for r in regels],
        'ritnummer': eerste.ritnummer,
        'voertuig_label': eerste.voertuig_label,
        'kenteken': eerste.kenteken,
        'kentekens': sorted({k for r in regels for k in (r.kentekens or [])}),
        'koppeling': koppeling,
        'vehicle_id': str(eerste.vehicle_id) if eerste.vehicle_id else None,
        'afrekeningen': len(regels),
        'inzetdagen': sum(r.inzetdagen for r in regels),
        'ritten': sum(r.ritten for r in regels),
        'kilometers_afrekening': float(_rond(som('kilometers'))),
        'netto_bedrag': float(_rond(som('netto_bedrag'))),
        'dagforfait': float(_rond(som('dagforfait'))),
        'brandstoftoeslag': float(_rond(som('brandstoftoeslag'))),
        'maut_gevonden': any(r.maut_gevonden for r in regels),

        'ontvangen': float(_rond(ontvangen)),
        'betaald': float(_rond(betaald)),
        # Positief = wij hebben meer tol betaald dan vergoed gekregen.
        'verschil': float(_rond(betaald - ontvangen)),
        'passages': passages,
        'km_tol': float(_rond(sum((v['km'] for v in vakken.values()), Decimal('0')))),
        'signaal': _signaal(koppeling, ontvangen, betaald, passages),

        'binnen_bedrag': float(_rond(vakken[BINNEN]['bedrag'])),
        'binnen_aantal': vakken[BINNEN]['aantal'],
        'weekend_bedrag': float(_rond(vakken[WEEKEND]['bedrag'])),
        'weekend_aantal': vakken[WEEKEND]['aantal'],
        'avond_bedrag': float(_rond(vakken[AVOND]['bedrag'])),
        'avond_aantal': vakken[AVOND]['aantal'],
        'buiten_bedrag': float(_rond(buiten_bedrag)),
        'buiten_aantal': vakken[WEEKEND]['aantal'] + vakken[AVOND]['aantal'],
        # Binnen de werkdag zou de vergoeding de kosten moeten dekken.
        'tekort_binnen': float(_rond(vakken[BINNEN]['bedrag'] - ontvangen)),

        'prive_bedrag': float(_rond(prive['bedrag'])),
        'prive_aantal': prive['aantal'],
        'gefactureerd_bedrag': float(_rond(gefactureerd_bedrag)),
        'open_binnen_aantal': open_binnen,
    }


def _tel_op(regels: list[dict]) -> dict:
    velden = (
        'ontvangen', 'betaald', 'verschil', 'binnen_bedrag', 'weekend_bedrag',
        'avond_bedrag', 'buiten_bedrag', 'tekort_binnen', 'prive_bedrag',
        'gefactureerd_bedrag', 'netto_bedrag', 'dagforfait', 'brandstoftoeslag',
        'kilometers_afrekening', 'km_tol',
    )
    aantallen = (
        'passages', 'binnen_aantal', 'weekend_aantal', 'avond_aantal',
        'buiten_aantal', 'prive_aantal', 'inzetdagen', 'ritten',
        'open_binnen_aantal',
    )
    totalen = {veld: round(sum(r[veld] for r in regels), 2) for veld in velden}
    totalen.update({veld: sum(r[veld] for r in regels) for veld in aantallen})
    totalen['voertuigen'] = len(regels)
    totalen['ongekoppeld'] = sum(1 for r in regels if r['koppeling'] != 'gekoppeld')
    totalen['aandacht'] = sum(1 for r in regels if r['signaal'] not in (OK, TEKORT))
    return totalen


def groepeer(afrekeningen: list) -> dict[str, list]:
    """Alle afrekeningsregels gebundeld per wagen (op ritnummer)."""
    groepen: dict[str, list] = {}
    for afrekening in sorted(afrekeningen, key=lambda a: a.periode_van):
        for regel in afrekening.regels.all():
            sleutel = regel.ritnummer or regel.voertuig_label
            groepen.setdefault(sleutel, []).append(regel)
    return groepen


def lege_analyse() -> dict:
    return {
        'afrekeningen': [], 'regels': [], 'waarschuwingen': [],
        'totalen': _tel_op([]), 'werktijd_van': '06:00', 'werktijd_tot': '18:00',
        'periode_van': None, 'periode_tot': None, 'bedrijf_naam': '',
        'verouderde_koppelingen': 0,
    }


def analyseer_selectie(afrekeningen: list) -> dict:
    """Het overzicht over een of meer afrekeningen samen.

    Regels van dezelfde wagen worden samengevoegd. Elke voertuigdag staat maar
    op één bon, dus de vergoedingen mogen opgeteld worden. De tolpassages
    worden over de vereniging van de perioden opgehaald zodat een dag die in
    twee bonperioden valt niet dubbel telt.
    """
    if not afrekeningen:
        return lege_analyse()

    op_datum = sorted(afrekeningen, key=lambda a: a.periode_van)
    nieuwste = op_datum[-1]
    werktijd_van = nieuwste.werktijd_van
    werktijd_tot = nieuwste.werktijd_tot
    perioden = [(a.periode_van, a.periode_tot) for a in op_datum]

    groepen = groepeer(op_datum)
    regels = [
        analyseer_groep(groepen[sleutel], perioden, werktijd_van, werktijd_tot)
        for sleutel in sorted(groepen)
    ]

    # De koppeling is een momentopname van het inlezen. Is een kenteken in de
    # vloot daarna gewijzigd, dan moet dat opvallen in plaats van stil tot een
    # verkeerde vergelijking te leiden.
    huidige_vloot = ritnummer_index(max(a.periode_tot for a in op_datum))
    verouderd = 0
    for rij in regels:
        wagens = huidige_vloot.get((rij['ritnummer'] or '').lower(), [])
        rij['huidig_kenteken'] = ' / '.join(w.kenteken for w in wagens)
        nu = sorted({normalize_plate(w.kenteken) for w in wagens if w.kenteken})
        rij['koppeling_verouderd'] = bool(nu) and nu != rij['kentekens']
        if rij['koppeling_verouderd']:
            verouderd += 1

    meldingen: list[str] = []
    meer_dan_een = len(op_datum) > 1
    for afrekening in op_datum:
        for melding in (afrekening.waarschuwingen or []):
            tekst = f'Bon {afrekening.bonnummer}: {melding}' if meer_dan_een else melding
            if tekst not in meldingen:
                meldingen.append(tekst)
    for rij in regels:
        tekst = _SIGNAAL_TEKST.get(rij['signaal'])
        if tekst:
            meldingen.append(
                f'Voertuig {rij["voertuig_label"]} (rit {rij["ritnummer"]}) {tekst}')
    if len({(a.werktijd_van, a.werktijd_tot) for a in op_datum}) > 1:
        meldingen.append(
            f'De afrekeningen hebben niet dezelfde werktijden; voor dit overzicht is '
            f'{werktijd_van:%H:%M}-{werktijd_tot:%H:%M} aangehouden.')
    for rij in regels:
        if rij['koppeling_verouderd']:
            meldingen.append(
                f'Rit {rij["ritnummer"]} is ingelezen op '
                f'{" / ".join(rij["kentekens"]) or "geen wagen"}, maar staat in de vloot '
                f'nu op {rij["huidig_kenteken"]}. Gebruik "Opnieuw koppelen" om dit '
                f'bij te werken.')

    return {
        'afrekeningen': [
            {
                'id': str(a.id),
                'bonnummer': a.bonnummer,
                'bestandsnaam': a.bestandsnaam,
                'klantnummer': a.klantnummer,
                'periode_van': a.periode_van,
                'periode_tot': a.periode_tot,
                'factuurdatum': a.factuurdatum,
                'bedrijf_naam': a.bedrijf.naam if a.bedrijf_id else '',
                'totaal_maut': float(a.totaal_maut or 0),
                'totaal_netto': float(a.totaal_netto or 0),
                'voertuigen': len(a.regels.all()),
                'werktijd_van': a.werktijd_van.strftime('%H:%M'),
                'werktijd_tot': a.werktijd_tot.strftime('%H:%M'),
                'geuploaded_door': (
                    (a.geuploaded_door.full_name or '').strip()
                    or a.geuploaded_door.email
                ) if a.geuploaded_door_id else '',
                'created_at': a.created_at,
            }
            for a in op_datum
        ],
        'periode_van': op_datum[0].periode_van,
        'periode_tot': max(a.periode_tot for a in op_datum),
        'werktijd_van': werktijd_van.strftime('%H:%M'),
        'werktijd_tot': werktijd_tot.strftime('%H:%M'),
        'bedrijf_naam': nieuwste.bedrijf.naam if nieuwste.bedrijf_id else '',
        'waarschuwingen': meldingen,
        'regels': regels,
        'verouderde_koppelingen': verouderd,
        'totalen': _tel_op(regels),
    }


def analyseer(afrekening) -> dict:
    """Het volledige overzicht bij één afrekening."""
    gegevens = analyseer_selectie([afrekening])
    gegevens.update({
        'id': str(afrekening.id),
        'bestandsnaam': afrekening.bestandsnaam,
        'bonnummer': afrekening.bonnummer,
        'klantnummer': afrekening.klantnummer,
        'factuurdatum': afrekening.factuurdatum,
        'bedrijf_id': str(afrekening.bedrijf_id) if afrekening.bedrijf_id else None,
        'geuploaded_door': (
            (afrekening.geuploaded_door.full_name or '').strip()
            or afrekening.geuploaded_door.email
        ) if afrekening.geuploaded_door_id else '',
        'created_at': afrekening.created_at,
    })
    return gegevens

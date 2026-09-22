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


# Signalen die om aandacht vragen bij het controleren van de afrekening.
OK = 'ok'
NIET_GEKOPPELD = 'niet_gekoppeld'
GEEN_TOLREGELS = 'geen_tolregels'
GEEN_VERGOEDING = 'geen_vergoeding'
TEKORT = 'tekort'
OVERSCHOT = 'overschot'

_SIGNAAL_TEKST = {
    NIET_GEKOPPELD: 'staat op geen enkele wagen in de vloot; de tolheffing kan niet '
                    'vergeleken worden.',
    GEEN_TOLREGELS: 'kreeg wel een tolvergoeding, maar er staat geen enkele tolpassage '
                    'op dit kenteken. Controleer of het kenteken in de tolimport klopt.',
    # Het ontbreken van een vergoeding meldt de parser al vanuit het bestand.
}


def _signaal(regel, ontvangen: Decimal, betaald: Decimal, passages: int) -> str:
    if regel.koppeling != 'gekoppeld':
        return NIET_GEKOPPELD
    if ontvangen > 0 and passages == 0:
        return GEEN_TOLREGELS
    if ontvangen == 0 and betaald > 0:
        return GEEN_VERGOEDING
    if betaald > ontvangen:
        return TEKORT
    return OK


def events_van_regel(regel, periode_van: date, periode_tot: date):
    """Alle tolpassages die bij deze afrekeningsregel horen.

    De periode is inclusief de einddatum. Er wordt op kenteken gematcht en niet
    op het ritnummer van de tolregel: dat ritnummer is een momentopname van de
    import en ontbreekt soms.
    """
    kentekens = [k for k in (regel.kentekens or []) if k]
    if not kentekens and not regel.vehicle_id:
        return TollingEvent.objects.none()

    start = timezone.make_aware(datetime.combine(periode_van, time.min))
    eind = timezone.make_aware(datetime.combine(periode_tot + timedelta(days=1), time.min))

    filter_ = Q(license_plate_normalized__in=kentekens) if kentekens else Q()
    if regel.vehicle_id:
        filter_ = filter_ | Q(vehicle_id=regel.vehicle_id)

    return TollingEvent.objects.filter(filter_, start_at__gte=start, start_at__lt=eind)


def analyseer_regel(regel, afrekening) -> dict:
    """Betaald versus ontvangen voor een voertuig, gesplitst naar tijdvak."""
    vakken = {BINNEN: _leeg_vak(), WEEKEND: _leeg_vak(), AVOND: _leeg_vak()}
    prive = _leeg_vak()
    gefactureerd_bedrag = Decimal('0')
    open_binnen = 0

    velden = ('start_at', 'amount', 'distance_km', 'is_private', 'invoiced_at')
    for start_at, bedrag, km, is_prive, gefactureerd_op in (
        events_van_regel(regel, afrekening.periode_van, afrekening.periode_tot)
        .values_list(*velden)
    ):
        bedrag = Decimal(bedrag or 0)
        km = Decimal(km or 0)
        if is_prive:
            prive['aantal'] += 1
            prive['bedrag'] += bedrag
            prive['km'] += km
            continue
        vak = tijdvak(start_at, afrekening.werktijd_van, afrekening.werktijd_tot)
        vakken[vak]['aantal'] += 1
        vakken[vak]['bedrag'] += bedrag
        vakken[vak]['km'] += km
        if gefactureerd_op:
            gefactureerd_bedrag += bedrag
        elif vak == BINNEN:
            open_binnen += 1

    betaald = sum((v['bedrag'] for v in vakken.values()), Decimal('0'))
    buiten_bedrag = vakken[WEEKEND]['bedrag'] + vakken[AVOND]['bedrag']
    ontvangen = Decimal(regel.maut_ontvangen or 0)
    passages = sum(v['aantal'] for v in vakken.values())

    return {
        'id': str(regel.id),
        'regelnummer': regel.regelnummer,
        'voertuig_label': regel.voertuig_label,
        'ritnummer': regel.ritnummer,
        'kenteken': regel.kenteken,
        'koppeling': regel.koppeling,
        'vehicle_id': str(regel.vehicle_id) if regel.vehicle_id else None,
        'inzetdagen': regel.inzetdagen,
        'ritten': regel.ritten,
        'kilometers_afrekening': float(_rond(regel.kilometers)),
        'netto_bedrag': float(_rond(regel.netto_bedrag)),
        'dagforfait': float(_rond(regel.dagforfait)),
        'brandstoftoeslag': float(_rond(regel.brandstoftoeslag)),
        'maut_gevonden': regel.maut_gevonden,

        'ontvangen': float(_rond(ontvangen)),
        'betaald': float(_rond(betaald)),
        # Positief = wij hebben meer tol betaald dan vergoed gekregen.
        'verschil': float(_rond(betaald - ontvangen)),
        'passages': passages,
        'signaal': _signaal(regel, ontvangen, betaald, passages),
        'km_tol': float(_rond(sum((v['km'] for v in vakken.values()), Decimal('0')))),

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


def analyseer(afrekening) -> dict:
    """Het volledige overzicht bij een afrekening."""
    regels = [
        analyseer_regel(regel, afrekening)
        for regel in afrekening.regels.select_related('vehicle').order_by('regelnummer')
    ]
    # Naast de meldingen uit het bestand zelf ook wat de vergelijking oplevert.
    meldingen = list(afrekening.waarschuwingen or [])
    for rij in regels:
        tekst = _SIGNAAL_TEKST.get(rij['signaal'])
        if tekst:
            meldingen.append(f'Voertuig {rij["voertuig_label"]} (rit {rij["ritnummer"]}) {tekst}')
    return {
        'id': str(afrekening.id),
        'bestandsnaam': afrekening.bestandsnaam,
        'bonnummer': afrekening.bonnummer,
        'klantnummer': afrekening.klantnummer,
        'factuurdatum': afrekening.factuurdatum,
        'periode_van': afrekening.periode_van,
        'periode_tot': afrekening.periode_tot,
        'werktijd_van': afrekening.werktijd_van.strftime('%H:%M'),
        'werktijd_tot': afrekening.werktijd_tot.strftime('%H:%M'),
        'bedrijf_id': str(afrekening.bedrijf_id) if afrekening.bedrijf_id else None,
        'bedrijf_naam': afrekening.bedrijf.naam if afrekening.bedrijf_id else '',
        'geuploaded_door': (
            (afrekening.geuploaded_door.full_name or '').strip()
            or afrekening.geuploaded_door.email
        ) if afrekening.geuploaded_door_id else '',
        'created_at': afrekening.created_at,
        'waarschuwingen': meldingen,
        'regels': regels,
        'totalen': _tel_op(regels),
    }

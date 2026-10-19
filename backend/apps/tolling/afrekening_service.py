"""Inlezen, koppelen en verwerken van een tolafrekening van de opdrachtgever."""
from __future__ import annotations

import logging
from datetime import time

from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Max, Min
from django.utils import timezone
from django.utils.text import get_valid_filename

from . import afrekening_analyse as analyse
from .afrekening_parser import parse_afrekening
from .models import TolAfrekening, TolAfrekeningRegel, TollingEvent, normalize_plate

logger = logging.getLogger(__name__)


class AfrekeningBestaatAl(ValueError):
    """Deze afrekening is al eerder ingelezen."""


def _koppel(regel_data, index) -> dict:
    """Zoek bij het ritnummer van de afrekening de wagen(s) uit onze vloot."""
    wagens = index.get(regel_data.ritnummer.strip().lower(), [])
    if not wagens:
        return {
            'vehicle': None,
            'kenteken': '',
            'kentekens': [],
            'koppeling': TolAfrekeningRegel.Koppeling.GEEN_VOERTUIG,
        }
    kentekens = []
    for wagen in wagens:
        genormaliseerd = normalize_plate(wagen.kenteken)
        if genormaliseerd and genormaliseerd not in kentekens:
            kentekens.append(genormaliseerd)
    return {
        'vehicle': wagens[0],
        'kenteken': ' / '.join(w.kenteken for w in wagens),
        'kentekens': kentekens,
        'koppeling': (
            TolAfrekeningRegel.Koppeling.GEKOPPELD if len(wagens) == 1
            else TolAfrekeningRegel.Koppeling.MEERDERE
        ),
    }


def _koppelwaarschuwingen(paren) -> list[str]:
    """Meldingen over ritnummers die niet netjes op één wagen uitkomen."""
    meldingen = []
    for ritnummer, koppeling in paren:
        if koppeling['koppeling'] == TolAfrekeningRegel.Koppeling.GEEN_VOERTUIG:
            meldingen.append(
                f'Ritnummer {ritnummer} hoort bij geen enkele wagen in de vloot.')
        elif koppeling['koppeling'] == TolAfrekeningRegel.Koppeling.MEERDERE:
            meldingen.append(
                f'Ritnummer {ritnummer} staat op meerdere wagens '
                f'({koppeling["kenteken"]}); hun tolheffing telt mee voor zover die '
                f'voor deze opdrachtgever gereden is.')
    return meldingen


def _bedrijf_van(koppelingen):
    """De opdrachtgever van de bon, als alle gekoppelde wagens er een delen.

    Staat er meer dan een bedrijf tussen, dan geeft dit None terug; dan laten
    we het veld liever leeg dan dat we gokken.
    """
    bedrijven = {
        koppeling['vehicle'].bedrijf_id
        for koppeling in koppelingen
        if koppeling['vehicle'] is not None and koppeling['vehicle'].bedrijf_id
    }
    return bedrijven.pop() if len(bedrijven) == 1 else None


@transaction.atomic
def importeer(
    inhoud: bytes,
    bestandsnaam: str,
    gebruiker=None,
    werktijd_van: time | None = None,
    werktijd_tot: time | None = None,
) -> TolAfrekening:
    """Lees de PDF, koppel de voertuigen en bewaar het resultaat."""
    gelezen = parse_afrekening(inhoud)

    waarschuwingen = list(gelezen.waarschuwingen)
    index = analyse.ritnummer_index(gelezen.periode_tot)

    veilige_naam = get_valid_filename(bestandsnaam or 'afrekening.pdf')[:255]
    afrekening = TolAfrekening(
        bestandsnaam=veilige_naam,
        bonnummer=gelezen.bonnummer,
        klantnummer=gelezen.klantnummer,
        factuurdatum=gelezen.factuurdatum,
        periode_van=gelezen.periode_van,
        periode_tot=gelezen.periode_tot,
        totaal_netto=gelezen.totaal_netto,
        totaal_maut=gelezen.totaal_maut,
        geuploaded_door=gebruiker,
    )
    if werktijd_van:
        afrekening.werktijd_van = werktijd_van
    if werktijd_tot:
        afrekening.werktijd_tot = werktijd_tot

    gekoppeld = [(r, _koppel(r, index)) for r in gelezen.regels]

    bedrijf_id = _bedrijf_van(koppeling for _, koppeling in gekoppeld)
    if bedrijf_id is not None:
        afrekening.bedrijf_id = bedrijf_id

    waarschuwingen.extend(_koppelwaarschuwingen(
        [(r.ritnummer, k) for r, k in gekoppeld]))
    afrekening.waarschuwingen = waarschuwingen

    # Een bon zonder nummer valt buiten de unieke sleutel in de database.
    # Dan vergelijken we op periode en bedragen, zodat ook die niet dubbel
    # ingelezen kan worden.
    if not gelezen.bonnummer and TolAfrekening.objects.filter(
        periode_van=gelezen.periode_van,
        periode_tot=gelezen.periode_tot,
        totaal_netto=gelezen.totaal_netto,
        totaal_maut=gelezen.totaal_maut,
    ).exists():
        raise AfrekeningBestaatAl(
            f'Een afrekening over {gelezen.periode_van:%d-%m-%Y} t/m '
            f'{gelezen.periode_tot:%d-%m-%Y} met dezelfde bedragen is al ingelezen.')

    if inhoud:
        afrekening.bestand.save(veilige_naam, ContentFile(inhoud), save=False)

    try:
        afrekening.save()
    except IntegrityError as fout:
        raise AfrekeningBestaatAl(
            f'Bon {gelezen.bonnummer} over {gelezen.periode_van:%d-%m-%Y} t/m '
            f'{gelezen.periode_tot:%d-%m-%Y} is al ingelezen.'
        ) from fout

    TolAfrekeningRegel.objects.bulk_create([
        TolAfrekeningRegel(
            afrekening=afrekening,
            regelnummer=regel_data.regelnummer,
            voertuig_label=regel_data.voertuig_label,
            ritnummer=regel_data.ritnummer,
            inzetdagen=regel_data.inzetdagen,
            ritten=regel_data.ritten,
            kilometers=regel_data.kilometers,
            netto_bedrag=regel_data.netto_bedrag,
            dagforfait=regel_data.dagforfait,
            brandstoftoeslag=regel_data.brandstoftoeslag,
            maut_ontvangen=regel_data.maut,
            maut_gevonden=regel_data.maut_gevonden,
            vehicle=koppeling['vehicle'],
            kenteken=koppeling['kenteken'],
            kentekens=koppeling['kentekens'],
            koppeling=koppeling['koppeling'],
            dagen=[
                {
                    'datum': dag.datum.isoformat(),
                    'kilometers': float(dag.kilometers),
                    'netto_bedrag': float(dag.netto_bedrag),
                }
                for dag in regel_data.dagen
            ],
        )
        for regel_data, koppeling in gekoppeld
    ])

    logger.info(
        'Tolafrekening %s ingelezen: %s voertuigen, tolvergoeding EUR %s',
        afrekening.bonnummer, len(gekoppeld), gelezen.totaal_maut,
    )

    # De opdrachtgever heeft de tol binnen de werkdag al vergoed; zonder deze
    # stap blijft die bij ons als openstaand staan.
    controle = _tol_ontbreekt(afrekening)
    afrekening.waarschuwingen = waarschuwingen + controle['meldingen']
    afrekening.status = (TolAfrekening.Status.WACHTRIJ if controle['wachtrij']
                         else TolAfrekening.Status.VERWERKT)
    afrekening.save(update_fields=['waarschuwingen', 'status', 'updated_at'])

    afrekening.gemarkeerd = (
        0 if controle['wachtrij'] else markeer_gefactureerd(afrekening)['gemarkeerd'])
    afrekening.tol_ontbreekt = controle['meldingen']
    afrekening.wachtrij_wagens = controle['wachtrij']
    return afrekening


def verwerk_wachtrij(afrekening) -> dict:
    """Een bon uit de wachtrij alsnog verwerken als de tolgegevens er nu zijn."""
    controle = _tol_ontbreekt(afrekening)
    overig = [melding for melding in (afrekening.waarschuwingen or [])
              if not melding.startswith('Voor ')]
    afrekening.waarschuwingen = overig + controle['meldingen']
    if controle['wachtrij']:
        afrekening.save(update_fields=['waarschuwingen', 'updated_at'])
        return {'status': afrekening.status, 'gemarkeerd': 0,
                'wachtrij_wagens': controle['wachtrij'],
                'meldingen': controle['meldingen']}

    afrekening.status = TolAfrekening.Status.VERWERKT
    afrekening.save(update_fields=['waarschuwingen', 'status', 'updated_at'])
    return {'status': afrekening.status,
            'gemarkeerd': markeer_gefactureerd(afrekening)['gemarkeerd'],
            'wachtrij_wagens': [], 'meldingen': controle['meldingen']}


def _tol_ontbreekt(afrekening) -> dict:
    """Welke bondagen nog geen tolgegevens hebben.

    Een enkele dag zonder tol kan kloppen (niet elke rit raakt een tolweg) en
    levert alleen een melding op. Een wagen zonder enige tolpassage betekent
    dat die import nog moet gebeuren; dan gaat de bon in de wachtrij.
    """
    meldingen = []
    wachtrij = []
    for regel in afrekening.regels.all():
        dagen = _dagen(afrekening, regel)
        if not dagen or not regel.kentekens:
            continue
        aanwezig = set()
        for start_at, in analyse.events_van_groep([regel], dagen).values_list('start_at'):
            aanwezig.add(timezone.localtime(start_at).date())
        leeg = [van for van, _ in dagen if van not in aanwezig]
        naam = regel.kenteken or regel.ritnummer
        if len(leeg) == len(dagen):
            wachtrij.append(naam)
            meldingen.append(
                f'Voor {naam} staan er over deze bon nog geen tolgegevens in het '
                f'systeem ({len(leeg)} dagen). Lees eerst de tolheffing in.')
        elif leeg:
            meldingen.append(
                f'Voor {naam} ontbreken de tolgegevens van {len(leeg)} van de '
                f'{len(dagen)} bondagen, eerste op {min(leeg):%d-%m-%Y}.')
    return {'meldingen': meldingen, 'wachtrij': wachtrij}


@transaction.atomic
def herkoppel(afrekeningen) -> dict:
    """Koppel de voertuigen opnieuw aan de hand van de huidige vloot.

    De koppeling is bij het inlezen een momentopname. Wordt een kenteken in de
    vloot daarna gecorrigeerd, dan blijft de afrekening naar het oude kenteken
    wijzen. Hiermee wordt de koppeling bijgewerkt zonder opnieuw in te lezen.
    """
    aangepast = 0
    for afrekening in afrekeningen:
        index = analyse.ritnummer_index(afrekening.periode_tot)
        paren = []
        koppelingen = []
        for regel in afrekening.regels.all():
            nieuw = _koppel(regel, index)
            paren.append((regel.ritnummer, nieuw))
            koppelingen.append(nieuw)
            nieuwe_id = nieuw['vehicle'].id if nieuw['vehicle'] else None
            if (regel.vehicle_id == nieuwe_id
                    and regel.kenteken == nieuw['kenteken']
                    and list(regel.kentekens or []) == nieuw['kentekens']
                    and regel.koppeling == nieuw['koppeling']):
                continue
            regel.vehicle = nieuw['vehicle']
            regel.kenteken = nieuw['kenteken']
            regel.kentekens = nieuw['kentekens']
            regel.koppeling = nieuw['koppeling']
            regel.save(update_fields=['vehicle', 'kenteken', 'kentekens', 'koppeling'])
            aangepast += 1

        # De meldingen over de koppeling opnieuw opbouwen; meldingen uit het
        # bestand zelf blijven staan.
        overig = [
            melding for melding in (afrekening.waarschuwingen or [])
            if not melding.startswith('Ritnummer ')
        ]
        velden = ['waarschuwingen', 'updated_at']
        # Bij het inlezen stond het bedrijf er soms nog niet op, omdat de wagen
        # toen nog niet gekoppeld was. Nu wel, dus vullen we het alsnog.
        bedrijf_id = _bedrijf_van(koppelingen)
        if bedrijf_id is not None and afrekening.bedrijf_id != bedrijf_id:
            afrekening.bedrijf_id = bedrijf_id
            velden.append('bedrijf')
        afrekening.waarschuwingen = overig + _koppelwaarschuwingen(paren)
        afrekening.save(update_fields=velden)

    logger.info('Tolafrekeningen opnieuw gekoppeld: %s regels aangepast', aangepast)
    return {'aangepast': aangepast}


def _dagen(afrekening, regel):
    """De dagen waarvoor deze wagen op deze bon vergoed is."""
    regel.bonperiode = (afrekening.periode_van, afrekening.periode_tot)
    return analyse.dagen_van_regel(regel)


def _binnen_werktijd_events(afrekening, regel_ids=None):
    """De nog niet gefactureerde passages binnen de werkdag van de afrekening."""
    regels = afrekening.regels.all()
    if regel_ids:
        regels = regels.filter(id__in=regel_ids)

    ids = []
    for regel in regels:
        rij = analyse.events_van_groep(
            [regel], _dagen(afrekening, regel),
        ).filter(is_private=False, invoiced_at__isnull=True)
        for event_id, start_at in rij.values_list('id', 'start_at'):
            vak = analyse.tijdvak(
                start_at, afrekening.werktijd_van, afrekening.werktijd_tot)
            if vak == analyse.BINNEN:
                ids.append(event_id)
    return ids


def tel_te_markeren(afrekening, regel_ids=None) -> int:
    """Hoeveel passages `markeer_gefactureerd` zou raken."""
    return len(_binnen_werktijd_events(afrekening, regel_ids))


@transaction.atomic
def markeer_gefactureerd(afrekening, regel_ids=None) -> dict:
    """Zet de tolheffing binnen de werkdag op gefactureerd.

    Alleen passages binnen het werkdagvenster worden gemarkeerd: die zijn met
    de vergoeding van de opdrachtgever afgerekend. Weekend- en avondpassages
    blijven open zodat ze nog nagefactureerd kunnen worden.
    """
    ids = _binnen_werktijd_events(afrekening, regel_ids)
    if not ids:
        return {'gemarkeerd': 0}
    aantal = TollingEvent.objects.filter(id__in=ids, invoiced_at__isnull=True).update(
        invoiced_at=timezone.now())
    logger.info('Tolafrekening %s: %s passages als gefactureerd gemarkeerd',
                afrekening.bonnummer, aantal)
    return {'gemarkeerd': aantal}


def markeer_nagekomen(batch) -> int:
    """Tol die na een afrekening binnenkomt alsnog afboeken tegen die bon.

    Een bon wordt vaak eerder ingelezen dan de tolgegevens van dezelfde dagen.
    Zonder deze stap blijft die tol openstaan terwijl hij al vergoed is.
    """
    grenzen = TollingEvent.objects.filter(batch=batch).aggregate(
        eerste=Min('start_at'), laatste=Max('start_at'))
    if not grenzen['eerste']:
        return 0
    vanaf = timezone.localtime(grenzen['eerste']).date()
    tot = timezone.localtime(grenzen['laatste']).date()
    bonnen = TolAfrekening.objects.filter(periode_van__lte=tot, periode_tot__gte=vanaf)
    gemarkeerd = 0
    for bon in bonnen:
        if bon.status == TolAfrekening.Status.WACHTRIJ:
            gemarkeerd += verwerk_wachtrij(bon)['gemarkeerd']
        else:
            gemarkeerd += markeer_gefactureerd(bon)['gemarkeerd']
    return gemarkeerd


@transaction.atomic
def maak_markering_ongedaan(afrekening, regel_ids=None) -> dict:
    """Draai het markeren terug voor de passages binnen deze afrekening."""
    regels = afrekening.regels.all()
    if regel_ids:
        regels = regels.filter(id__in=regel_ids)

    totaal = 0
    for regel in regels:
        rij = analyse.events_van_groep(
            [regel], _dagen(afrekening, regel),
        ).filter(invoiced_at__isnull=False, invoice_line__isnull=True)
        ids = []
        for event_id, start_at in rij.values_list('id', 'start_at'):
            vak = analyse.tijdvak(
                start_at, afrekening.werktijd_van, afrekening.werktijd_tot)
            if vak == analyse.BINNEN:
                ids.append(event_id)
        if ids:
            totaal += TollingEvent.objects.filter(id__in=ids).update(invoiced_at=None)
    logger.info('Tolafrekening %s: markering van %s passages teruggedraaid',
                afrekening.bonnummer, totaal)
    return {'teruggedraaid': totaal}

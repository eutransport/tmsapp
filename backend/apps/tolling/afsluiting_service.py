"""Een tolperiode afsluiten en weer bij nul beginnen.

Afsluiten verplaatst niets en verwijdert niets: elk record krijgt een
verwijzing naar de afsluiting waarin het is opgeborgen. Alles wat daar een
verwijzing heeft valt uit de gewone overzichten, maar blijft opvraagbaar en
corrigeerbaar via het archief. Een afsluiting kan in zijn geheel terug.

Wat gaat er mee tot en met de gekozen dag:

- tolpassages die gefactureerd zijn, of waarvan het priv\u00e9gebruik is afgerekend;
- tolafrekeningen van opdrachtgevers waarvan de periode helemaal voorbij is;
- openstaande toldagen en priv\u00e9registraties;
- importbatches waarvan geen enkele passage meer buiten het archief staat.

Wat blijft staan: passages die nog niet gefactureerd zijn. Radius factureert
met vertraging, dus daar kan nog van alles bij komen. Zodra zo'n passage
alsnog op een factuur belandt schuift hij via `naleveren` vanzelf in de
afsluiting waar hij qua datum in hoort. Voor oude periodes waar niets meer van
komt kan dat worden overruled; die passages gaan dan mee met de aantekening
dat er nooit facturatie tegenover heeft gestaan.
"""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from .models import (
    OpenstaandeTolDag,
    PrivateTollRegistration,
    TolAfrekening,
    TolAfsluiting,
    TollingEvent,
    TollingImportBatch,
)

logger = logging.getLogger(__name__)


class AfsluitingFout(Exception):
    """De afsluiting kan niet zo worden uitgevoerd."""


def _einde(tot_datum):
    """Het eerste moment ná de afsluitdatum, in lokale tijd."""
    tz = timezone.get_current_timezone()
    return timezone.make_aware(datetime.combine(tot_datum + timedelta(days=1), time.min), tz)


def _afgehandeld() -> Q:
    """Passages waar niets meer aan hoeft te gebeuren.

    Gefactureerd, of priv\u00e9 en met de chauffeur afgerekend. Priv\u00e9passages
    zonder registratie bestaan niet, maar mochten ze er zijn dan tellen ze als
    afgehandeld: er komt nooit nog een factuur voor.
    """
    return (
        Q(invoiced_at__isnull=False)
        | Q(is_private=True, private_registration__admin_invoiced=True)
        | Q(is_private=True, private_registration__isnull=True)
    )


def _events(tot_datum):
    return TollingEvent.objects.filter(
        afsluiting__isnull=True, start_at__lt=_einde(tot_datum))


def _bedrag(qs) -> float:
    return float(qs.aggregate(t=Sum('amount'))['t'] or 0)


def voorbeeld(tot_datum) -> dict:
    """Wat zou er gebeuren bij een afsluiting tot en met deze dag?

    Leest alleen. Het resultaat is bedoeld om in het bevestigingsscherm te
    laten zien, zodat niemand blind op de knop drukt.
    """
    events = _events(tot_datum)
    klaar = events.filter(_afgehandeld())
    open_regels = events.exclude(_afgehandeld())

    afrekeningen = TolAfrekening.objects.filter(
        afsluiting__isnull=True, periode_tot__lte=tot_datum)
    toldagen = OpenstaandeTolDag.objects.filter(
        afsluiting__isnull=True, datum__lte=tot_datum)
    prive = PrivateTollRegistration.objects.filter(
        afsluiting__isnull=True, datum__lte=tot_datum)

    per_wagen = list(
        open_regels.values('license_plate_normalized')
        .annotate(aantal=Count('id'), bedrag=Sum('amount'))
        .order_by('-bedrag')[:25]
    )

    return {
        'tot_datum': tot_datum.isoformat(),
        'gefactureerd': {
            'aantal': klaar.count(),
            'bedrag': _bedrag(klaar),
        },
        'openstaand': {
            'aantal': open_regels.count(),
            'bedrag': _bedrag(open_regels),
            'per_wagen': [
                {
                    'kenteken': rij['license_plate_normalized'],
                    'aantal': rij['aantal'],
                    'bedrag': float(rij['bedrag'] or 0),
                }
                for rij in per_wagen
            ],
        },
        'afrekeningen': {
            'aantal': afrekeningen.count(),
            'bedrag': float(
                afrekeningen.aggregate(t=Sum('totaal_maut'))['t'] or 0),
        },
        'toldagen': toldagen.count(),
        'prive_registraties': prive.count(),
        'eerdere_afsluiting': _laatste_tot_datum(),
    }


def _laatste_tot_datum():
    laatste = (TolAfsluiting.objects.filter(teruggedraaid_op__isnull=True)
               .order_by('-tot_datum').first())
    return laatste.tot_datum.isoformat() if laatste else None


@transaction.atomic
def afsluiten(tot_datum, *, gebruiker=None, omschrijving: str = '',
              openstaand_meenemen: bool = False) -> TolAfsluiting:
    """Zet alles tot en met ``tot_datum`` in een nieuwe afsluiting."""
    vorige = (TolAfsluiting.objects.filter(teruggedraaid_op__isnull=True)
              .order_by('-tot_datum').first())
    if vorige and vorige.tot_datum >= tot_datum:
        raise AfsluitingFout(
            f'Er is al afgesloten tot en met {vorige.tot_datum:%d-%m-%Y}. '
            'Kies een latere datum.')
    if tot_datum >= timezone.localdate():
        raise AfsluitingFout('Een periode kan pas worden afgesloten als die voorbij is.')

    samenvatting = voorbeeld(tot_datum)
    afsluiting = TolAfsluiting.objects.create(
        tot_datum=tot_datum,
        omschrijving=omschrijving.strip()[:200],
        openstaand_meegenomen=bool(openstaand_meenemen),
        samenvatting=samenvatting,
        uitgevoerd_door=gebruiker,
    )

    events = _events(tot_datum)
    aantal = events.filter(_afgehandeld()).update(afsluiting=afsluiting)
    if openstaand_meenemen:
        aantal += (_events(tot_datum).exclude(_afgehandeld())
                   .update(afsluiting=afsluiting, archief_onafgehandeld=True))

    TolAfrekening.objects.filter(
        afsluiting__isnull=True, periode_tot__lte=tot_datum
    ).update(afsluiting=afsluiting)
    OpenstaandeTolDag.objects.filter(
        afsluiting__isnull=True, datum__lte=tot_datum
    ).update(afsluiting=afsluiting)
    PrivateTollRegistration.objects.filter(
        afsluiting__isnull=True, datum__lte=tot_datum
    ).update(afsluiting=afsluiting)
    _batches_opruimen(afsluiting)

    logger.info('Tol afgesloten t/m %s door %s: %d passages',
                tot_datum, gebruiker, aantal)
    return afsluiting


def _batches_opruimen(afsluiting) -> int:
    """Importbatches waarvan geen enkele passage meer buiten het archief staat.

    Een batch die nog openstaande passages bevat blijft zichtbaar; anders zou
    de importlijst suggereren dat er niets is ingelezen terwijl er nog werk
    ligt.
    """
    open_batches = set(
        TollingEvent.objects.filter(afsluiting__isnull=True, batch__isnull=False)
        .values_list('batch_id', flat=True).distinct()
    )
    return (TollingImportBatch.objects
            .filter(afsluiting__isnull=True,
                    created_at__lt=_einde(afsluiting.tot_datum))
            .exclude(id__in=open_batches)
            .update(afsluiting=afsluiting))


@transaction.atomic
def terugdraaien(afsluiting, *, gebruiker=None) -> dict:
    """Haal alles van deze afsluiting weer terug in de lopende administratie."""
    if not afsluiting.actief:
        raise AfsluitingFout('Deze afsluiting is al teruggedraaid.')

    aantal = TollingEvent.objects.filter(afsluiting=afsluiting).update(
        afsluiting=None, archief_onafgehandeld=False)
    TolAfrekening.objects.filter(afsluiting=afsluiting).update(afsluiting=None)
    OpenstaandeTolDag.objects.filter(afsluiting=afsluiting).update(afsluiting=None)
    PrivateTollRegistration.objects.filter(afsluiting=afsluiting).update(afsluiting=None)
    TollingImportBatch.objects.filter(afsluiting=afsluiting).update(afsluiting=None)

    afsluiting.teruggedraaid_op = timezone.now()
    afsluiting.teruggedraaid_door = gebruiker
    afsluiting.save(update_fields=['teruggedraaid_op', 'teruggedraaid_door'])
    logger.info('Tolafsluiting %s teruggedraaid door %s', afsluiting.pk, gebruiker)
    return {'passages': aantal}


def naleveren() -> int:
    """Alsnog gefactureerde passages in hun afsluiting schuiven.

    Wordt aangeroepen nadat er is gefactureerd. Een passage die achteraf
    binnenkomt over een al afgesloten periode hoort in dat archief thuis,
    anders zou hij het schone beeld opnieuw vervuilen.
    """
    afsluitingen = list(TolAfsluiting.objects
                        .filter(teruggedraaid_op__isnull=True)
                        .order_by('tot_datum'))
    if not afsluitingen:
        return 0

    totaal = 0
    ondergrens = None
    for afsluiting in afsluitingen:
        qs = TollingEvent.objects.filter(
            afsluiting__isnull=True, start_at__lt=_einde(afsluiting.tot_datum)
        ).filter(_afgehandeld())
        if ondergrens is not None:
            qs = qs.filter(start_at__gte=ondergrens)
        totaal += qs.update(afsluiting=afsluiting)
        ondergrens = _einde(afsluiting.tot_datum)

    if totaal:
        logger.info('Tol: %d nagekomen passages alsnog gearchiveerd', totaal)
    return totaal


def overzicht() -> list[dict]:
    """De afsluitingen met hun momentopname, nieuwste eerst."""
    rijen = []
    for afsluiting in TolAfsluiting.objects.select_related(
            'uitgevoerd_door', 'teruggedraaid_door'):
        huidig = TollingEvent.objects.filter(afsluiting=afsluiting).aggregate(
            aantal=Count('id'), bedrag=Sum('amount'))
        rijen.append({
            'id': str(afsluiting.pk),
            'tot_datum': afsluiting.tot_datum.isoformat(),
            'omschrijving': afsluiting.omschrijving,
            'openstaand_meegenomen': afsluiting.openstaand_meegenomen,
            'uitgevoerd_op': afsluiting.uitgevoerd_op.isoformat(),
            'uitgevoerd_door': _naam(afsluiting.uitgevoerd_door),
            'teruggedraaid_op': (afsluiting.teruggedraaid_op.isoformat()
                                 if afsluiting.teruggedraaid_op else None),
            'teruggedraaid_door': _naam(afsluiting.teruggedraaid_door),
            'actief': afsluiting.actief,
            'passages': huidig['aantal'] or 0,
            'bedrag': float(huidig['bedrag'] or Decimal('0')),
            'samenvatting': afsluiting.samenvatting or {},
        })
    return rijen


def _naam(gebruiker) -> str:
    if not gebruiker:
        return ''
    volledig = f'{gebruiker.voornaam} {gebruiker.achternaam}'.strip()
    return volledig or gebruiker.get_username()

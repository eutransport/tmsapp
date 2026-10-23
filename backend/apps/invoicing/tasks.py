"""Automatische betalingsherinneringen.

De taak draait dagelijks en kijkt naar verstuurde verkoopfacturen die nog niet
op betaald staan. Op 1, 7 en 14 dagen na de vervaldatum gaat er een mail naar de
mailinglijst van het bedrijf. Per factuur en fase hoogstens een keer; dat wordt
afgedwongen door een uniek slot in de database.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from decimal import Decimal

from celery import shared_task
from django.conf import settings
from django.core.mail import EmailMessage, get_connection
from django.db import IntegrityError
from django.template.loader import render_to_string
from django.utils import timezone

from apps.companies.models import MailingListContact

from .herinnering_teksten import teksten_voor
from .models import FactuurHerinnering, Invoice, InvoiceStatus, InvoiceType

logger = logging.getLogger(__name__)

STANDAARD_AFZENDER = 'info@moveo-bv.nl'


def _smtp_bron():
    """De SMTP-server uit Instellingen > E-mail, met het bijbehorende afzenderadres."""
    from apps.core.models import AppSettings

    algemeen = AppSettings.get_settings()
    if not algemeen.smtp_host:
        return None, ''
    afzender = (
        getattr(algemeen, 'smtp_from_email', '')
        or algemeen.smtp_username
        or getattr(settings, 'DEFAULT_FROM_EMAIL', STANDAARD_AFZENDER)
    )
    return algemeen, afzender


def _taal_van(bedrijf_id):
    from apps.opdrachten.models import OpdrachtMailInstelling

    instelling = OpdrachtMailInstelling.objects.filter(bedrijf_id=bedrijf_id).first()
    return (instelling.taal if instelling else 'nl') or 'nl'


def _ontvangers(bedrijf):
    adressen = list(
        MailingListContact.objects.filter(bedrijf=bedrijf, is_active=True)
        .exclude(email='')
        .values_list('email', flat=True)
    )
    if not adressen and bedrijf.email:
        adressen = [bedrijf.email]
    # Dubbelen eruit, volgorde behouden.
    gezien = set()
    return [a for a in adressen if not (a.lower() in gezien or gezien.add(a.lower()))]


def _bedrag(waarde: Decimal) -> str:
    heel, _, decimalen = f'{waarde:.2f}'.partition('.')
    met_punten = f'{int(heel):,}'.replace(',', '.')
    return f'{met_punten},{decimalen}'


def _verstuur(factuur: Invoice, fase: int, dagen_te_laat: int) -> bool:
    ontvangers = _ontvangers(factuur.bedrijf)
    if not ontvangers:
        logger.warning('Geen ontvangers voor herinnering %s', factuur.factuurnummer)
        return False

    bron, afzender = _smtp_bron()
    if bron is None:
        logger.warning('Geen SMTP-server ingesteld; herinnering niet verstuurd')
        return False

    T = teksten_voor(_taal_van(factuur.bedrijf_id))
    namen = {'nummer': factuur.factuurnummer}
    onderwerp = T[f'onderwerp_{fase}'] % namen

    inhoud = render_to_string('invoicing/mail_herinnering.html', {
        'T': T,
        'taal': _taal_van(factuur.bedrijf_id),
        'fase': fase,
        'onderwerp': onderwerp,
        'koptekst': T[f'koptekst_{fase}'] % namen,
        'inleiding': T[f'inleiding_{fase}'],
        'factuur': factuur,
        'dagen_te_laat': dagen_te_laat,
        'bedrag': _bedrag(abs(factuur.totaal)),
    })

    bericht = EmailMessage(
        subject=onderwerp,
        body=inhoud,
        from_email=afzender,
        to=ontvangers,
        bcc=[afzender],
        connection=get_connection(
            backend='django.core.mail.backends.smtp.EmailBackend',
            host=bron.smtp_host,
            port=bron.smtp_port,
            username=bron.smtp_username or '',
            password=bron.smtp_password,
            use_tls=bron.smtp_use_tls,
            fail_silently=False,
        ),
    )
    bericht.content_subtype = 'html'
    bericht.send()
    return True


@shared_task
def send_invoice_reminders():
    """Verstuur herinneringen voor facturen die 1, 7 of 14 dagen te laat zijn."""
    vandaag = timezone.localdate()
    verstuurd = 0

    for fase in FactuurHerinnering.FASES:
        vervaldatum = vandaag - timedelta(days=fase)
        facturen = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status=InvoiceStatus.VERZONDEN,
            vervaldatum=vervaldatum,
        ).exclude(herinneringen__fase=fase).select_related('bedrijf')

        for factuur in facturen:
            # Het slot wordt eerst gezet, zodat een tweede worker niet dezelfde
            # mail verstuurt als de verzending traag is.
            try:
                slot = FactuurHerinnering.objects.create(
                    invoice=factuur, fase=fase, ontvangers=_ontvangers(factuur.bedrijf)
                )
            except IntegrityError:
                continue

            try:
                slot.gelukt = _verstuur(factuur, fase, fase)
            except Exception as fout:
                logger.exception('Herinnering %s mislukt', factuur.factuurnummer)
                slot.fout = f'{type(fout).__name__}: {fout}'[:500]
            slot.save(update_fields=['gelukt', 'fout'])
            if slot.gelukt:
                verstuurd += 1

    logger.info('Betalingsherinneringen verstuurd: %s', verstuurd)
    return verstuurd

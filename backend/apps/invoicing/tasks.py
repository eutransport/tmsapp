"""Automatische betalingsherinneringen.

De taak draait dagelijks en kijkt naar verstuurde verkoopfacturen die nog niet
op betaald staan. Op 1, 7 en 14 dagen na de vervaldatum gaat er een mail naar de
mailinglijst van het bedrijf, maar alleen als dat bedrijf een opdrachtgeveraccount
heeft en de facturen dus in het portaal ziet.

Elke factuur en fase krijgt hoogstens een geslaagde mail; dat wordt afgedwongen
door een uniek slot in de database. Mislukt het versturen, dan blijft het slot
open voor een nieuwe poging op een volgende dag en gaat er een waarschuwing naar
het eigen afzenderadres.
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
from apps.accounts.models import UserRole

from .herinnering_teksten import teksten_voor
from .models import FactuurHerinnering, Invoice, InvoiceStatus, InvoiceType

logger = logging.getLogger(__name__)

STANDAARD_AFZENDER = 'info@moveo-bv.nl'
MAX_POGINGEN = 3


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


def _bedrijven_met_portaal():
    """Bedrijven met minstens een actief opdrachtgever-account.

    Alleen deze bedrijven zien hun facturen in het portaal en krijgen daarom
    een herinnering; de rest blijft buiten beeld.
    """
    from django.contrib.auth import get_user_model

    return set(
        get_user_model().objects
        .filter(
            rol=UserRole.OPDRACHTGEVER,
            is_active=True,
            opdrachtgever_bedrijf__isnull=False,
        )
        .exclude(is_superuser=True)
        .values_list('opdrachtgever_bedrijf_id', flat=True)
    )


def _poging(slot, mislukt: list) -> bool:
    """Een verzendpoging voor een bestaand slot; legt de uitkomst vast."""
    factuur = slot.invoice
    slot.pogingen += 1
    slot.laatste_poging = timezone.now()
    slot.fout = ''
    try:
        slot.gelukt = _verstuur(factuur, slot.fase, slot.fase)
        if not slot.gelukt:
            slot.fout = 'Geen ontvangers of geen SMTP-server ingesteld.'
    except Exception as fout:
        logger.exception('Herinnering %s mislukt', factuur.factuurnummer)
        slot.fout = f'{type(fout).__name__}: {fout}'[:500]

    slot.opgegeven = not slot.gelukt and slot.pogingen >= MAX_POGINGEN
    slot.save(update_fields=['gelukt', 'fout', 'pogingen', 'laatste_poging', 'opgegeven'])

    if not slot.gelukt:
        mislukt.append(slot)
    return slot.gelukt


def _meld_mislukkingen(mislukt: list):
    """Interne waarschuwing zodat een mislukte herinnering niet onopgemerkt blijft."""
    bron, afzender = _smtp_bron()
    if bron is None or not afzender:
        logger.error('Mislukte herinneringen (%s) maar geen SMTP-server om te melden', len(mislukt))
        return

    definitief = [s for s in mislukt if s.opgegeven]
    rijen = []
    for s in mislukt:
        stand = 'opgegeven' if s.opgegeven else f'poging {s.pogingen} van {MAX_POGINGEN}'
        rijen.append(
            f'<tr><td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">{s.invoice.factuurnummer}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">{s.invoice.bedrijf.naam}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">{s.fase} dagen</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb">{stand}</td>'
            f'<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;color:#b91c1c">{s.fout}</td></tr>'
        )

    inhoud = (
        '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827">'
        '<div style="background:#0f172a;color:#fff;padding:16px 20px;font-size:18px;font-weight:bold">'
        'MOVEO</div>'
        f'<div style="background:#dc2626;color:#fff;padding:10px 20px;font-weight:bold">'
        f'{len(mislukt)} betalingsherinnering(en) niet verstuurd</div>'
        '<div style="padding:20px">'
        '<p>De volgende herinneringen konden niet worden verstuurd. '
        'Regels met "opgegeven" worden niet opnieuw geprobeerd en vragen om handmatige actie.</p>'
        '<table style="border-collapse:collapse;width:100%">'
        '<tr style="background:#f3f4f6;text-align:left">'
        '<th style="padding:6px 10px">Factuur</th><th style="padding:6px 10px">Bedrijf</th>'
        '<th style="padding:6px 10px">Fase</th><th style="padding:6px 10px">Stand</th>'
        '<th style="padding:6px 10px">Melding</th></tr>'
        + ''.join(rijen) +
        '</table></div></div>'
    )

    onderwerp = f'Let op: {len(mislukt)} betalingsherinnering(en) niet verstuurd'
    if definitief:
        onderwerp = f'Actie nodig: {len(definitief)} betalingsherinnering(en) definitief mislukt'

    try:
        bericht = EmailMessage(
            subject=onderwerp,
            body=inhoud,
            from_email=afzender,
            to=[afzender],
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
    except Exception:
        logger.exception('Waarschuwing over mislukte herinneringen kon niet worden verstuurd')


@shared_task
def send_invoice_reminders():
    """Verstuur herinneringen voor facturen die 1, 7 of 14 dagen te laat zijn."""
    vandaag = timezone.localdate()
    verstuurd = 0
    mislukt: list = []
    nieuw: set = set()

    bedrijven = _bedrijven_met_portaal()
    if not bedrijven:
        logger.info('Geen bedrijven met portaaltoegang; geen herinneringen verstuurd')
        return 0

    for fase in FactuurHerinnering.FASES:
        vervaldatum = vandaag - timedelta(days=fase)
        facturen = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status=InvoiceStatus.VERZONDEN,
            vervaldatum=vervaldatum,
            bedrijf_id__in=bedrijven,
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
            slot.invoice = factuur
            nieuw.add(slot.pk)
            if _poging(slot, mislukt):
                verstuurd += 1

    for slot in _herkansingen(bedrijven, nieuw):
        slot.ontvangers = _ontvangers(slot.invoice.bedrijf)
        if _poging(slot, mislukt):
            verstuurd += 1
            FactuurHerinnering.objects.filter(pk=slot.pk).update(ontvangers=slot.ontvangers)

    if mislukt:
        _meld_mislukkingen(mislukt)

    logger.info('Betalingsherinneringen verstuurd: %s, mislukt: %s', verstuurd, len(mislukt))
    return verstuurd


def _herkansingen(bedrijven, nieuw):
    """Eerder mislukte herinneringen die nog een poging verdienen.

    Is de factuur inmiddels betaald of ingetrokken, dan wordt het slot gesloten
    zonder nieuwe mail.
    """
    sloten = (
        FactuurHerinnering.objects
        .filter(gelukt=False, opgegeven=False, pogingen__lt=MAX_POGINGEN)
        .exclude(pk__in=nieuw)
        .select_related('invoice', 'invoice__bedrijf')
    )
    open_sloten = []
    for slot in sloten:
        factuur = slot.invoice
        if (
            factuur.status != InvoiceStatus.VERZONDEN
            or factuur.type != InvoiceType.VERKOOP
            or factuur.bedrijf_id not in bedrijven
        ):
            slot.opgegeven = True
            slot.fout = 'Niet langer van toepassing; factuur of toegang is gewijzigd.'
            slot.save(update_fields=['opgegeven', 'fout'])
            continue
        open_sloten.append(slot)
    return open_sloten

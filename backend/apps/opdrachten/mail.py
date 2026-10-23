"""Mailmeldingen rond opdrachten.

Versturen gebeurt stil: een mailserver die weigert mag nooit het starten of
afmelden van een opdracht blokkeren.
"""
import logging

from django.conf import settings
from django.core.mail import EmailMessage, get_connection
from django.template.loader import render_to_string
from django.utils import timezone

from .mail_teksten import teksten_voor
from .models import OpdrachtMailInstelling

logger = logging.getLogger(__name__)

STANDAARD_AFZENDER = 'info@moveo-bv.nl'


def _instelling(opdracht):
    return OpdrachtMailInstelling.objects.filter(bedrijf_id=opdracht.bedrijf_id).first()


def _onthoud(opdracht, fout):
    """Bewaar waarom de laatste melding niet aankwam, zodat de UI het kan tonen."""
    if opdracht.laatste_mail_fout != fout:
        opdracht.laatste_mail_fout = fout[:255]
        opdracht.save(update_fields=['laatste_mail_fout', 'updated_at'])
    return not fout


def _smtp_bron(afzender):
    """Zoek de SMTP-gegevens uit Instellingen > E-mail die bij deze afzender horen."""
    from apps.core.models import AppSettings, EmailProfile

    if afzender:
        profiel = (
            EmailProfile.objects.filter(smtp_from_email__iexact=afzender).first()
            or EmailProfile.objects.filter(smtp_username__iexact=afzender).first()
        )
        if profiel and profiel.smtp_host:
            return profiel

    algemeen = AppSettings.get_settings()
    if algemeen.smtp_host:
        return algemeen
    return None


def _verstuur(opdracht, soort, template, extra_context=None, bijlagen=()):
    instelling = _instelling(opdracht)
    if instelling is None:
        return _onthoud(opdracht, 'Geen mailinstelling voor deze opdrachtgever.')

    ontvangers = [adres for adres in (instelling.ontvangers or []) if adres]
    if not ontvangers:
        return _onthoud(opdracht, 'Geen ontvangers ingesteld bij Mailmeldingen.')

    afzender = instelling.afzender or getattr(
        settings, 'DEFAULT_FROM_EMAIL', STANDAARD_AFZENDER
    )
    bron = _smtp_bron(afzender)
    if bron is None:
        return _onthoud(
            opdracht,
            'Geen SMTP-server ingesteld bij Instellingen > E-mail.',
        )

    T = teksten_voor(instelling.taal)
    namen = {'klant': opdracht.klant_naam, 'chauffeur': opdracht.chauffeur.naam}
    onderwerp = T[f'titel_{soort}'] % namen
    context = {
        'opdracht': opdracht,
        'chauffeur': opdracht.chauffeur.naam,
        'opdrachtgever': opdracht.bedrijf.naam,
        'nu': timezone.localtime(),
        'T': T,
        'taal': instelling.taal or 'nl',
        'titel': onderwerp,
        'kop': T[f'kop_{soort}'],
        'koptekst': T.get(f'koptekst_{soort}', T[f'titel_{soort}']) % namen,
        'inleiding': T[f'inleiding_{soort}'] % namen,
        **(extra_context or {}),
    }
    inhoud = render_to_string(template, context)

    try:
        bericht = EmailMessage(
            subject=onderwerp,
            body=inhoud,
            from_email=afzender,
            to=ontvangers,
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
        for bijlage in bijlagen:
            bijlage.bestand.open('rb')
            bericht.attach(bijlage.bestandsnaam, bijlage.bestand.read())
            bijlage.bestand.close()
        bericht.send()
        return _onthoud(opdracht, '')
    except Exception as fout:
        logger.exception('Mail voor opdracht %s kon niet verstuurd worden', opdracht.id)
        return _onthoud(opdracht, f'{type(fout).__name__}: {fout}')


def _eta_tekst(opdracht, T):
    """De verwachte aankomst zoals die bij het starten is berekend."""
    minuten = opdracht.eta_start_minuten
    if not minuten:
        return ''
    if opdracht.eta_aankomst:
        tijd = timezone.localtime(opdracht.eta_aankomst).strftime('%H:%M')
        return T['eta_tijd'] % {'tijd': tijd, 'minuten': minuten}
    return T['eta_minuten'] % {'minuten': minuten}


def meld_gestart(opdracht):
    instelling = _instelling(opdracht)
    if instelling is None or not instelling.mail_bij_start:
        return False
    T = teksten_voor(instelling.taal)
    return _verstuur(
        opdracht,
        'gestart',
        'opdrachten/mail_gestart.html',
        {'eta_tekst': _eta_tekst(opdracht, T)},
    )


def meld_afgeleverd(opdracht):
    instelling = _instelling(opdracht)
    if instelling is None or not instelling.mail_bij_aflevering:
        return False
    bijlagen = list(opdracht.bijlagen.all())
    return _verstuur(
        opdracht,
        'afgeleverd',
        'opdrachten/mail_afgeleverd.html',
        {'bijlagen': bijlagen},
        bijlagen=bijlagen,
    )


def meld_niet_geleverd(opdracht):
    instelling = _instelling(opdracht)
    if instelling is None or not instelling.mail_bij_niet_geleverd:
        return False
    bijlagen = list(opdracht.bijlagen.all())
    return _verstuur(
        opdracht,
        'niet_geleverd',
        'opdrachten/mail_niet_geleverd.html',
        {'bijlagen': bijlagen},
        bijlagen=bijlagen,
    )


def opnieuw_versturen(opdracht):
    """Verstuur de melding die bij de huidige status hoort nog een keer."""
    from .models import OpdrachtStatus

    if opdracht.status == OpdrachtStatus.AFGELEVERD:
        return meld_afgeleverd(opdracht)
    if opdracht.status == OpdrachtStatus.NIET_GELEVERD:
        return meld_niet_geleverd(opdracht)
    if opdracht.status == OpdrachtStatus.GESTART:
        return meld_gestart(opdracht)
    return _onthoud(opdracht, 'Voor deze status wordt geen melding verstuurd.')

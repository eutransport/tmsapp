"""Celery-taken voor het onderhoudsmodule.

Herinneringen voor de ADR-controles, de brandblussers en de APK. Vanaf een
vast aantal dagen voor de vervaldatum gaat er een mail uit, en in de laatste
periode (en daarna) elke dag opnieuw totdat de datum is bijgewerkt. Tegelijk
met de mail komt er een notificatie in de app met een link naar de regel.
"""
from __future__ import annotations

import logging
import os
from datetime import date, timedelta

from celery import shared_task
from django.conf import settings as django_settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils import timezone
from django.utils.html import escape

logger = logging.getLogger(__name__)

# Aantal dagen voor de controle waarop de eerste herinnering uitgaat.
FIRST_REMINDER_DAYS = 14
# Vanaf dit aantal dagen wordt er elke dag herinnerd.
DAILY_REMINDER_DAYS = 7


def _app_base_url() -> str:
    """Basis-URL van de webapp, voor links in mails. Leeg = relatieve link."""
    url = os.environ.get('FRONTEND_URL', '').strip()
    if not url:
        origins = getattr(django_settings, 'CORS_ALLOWED_ORIGINS', None) or []
        if origins:
            url = str(origins[0])
    return url.rstrip('/')


def _record_path(record) -> str:
    return f'/maintenance/adr?record={record.id}'


def _should_send(record, today: date) -> bool:
    """Bepaal of er vandaag een herinnering voor dit record uit moet."""
    if not record.has_adr or not record.next_inspection_date:
        return False

    days = (record.next_inspection_date - today).days
    if days > FIRST_REMINDER_DAYS:
        return False

    laatste = record.last_reminder_sent_on
    if days <= DAILY_REMINDER_DAYS:
        # Laatste week en te laat: elke dag, maar niet twee keer op een dag.
        return laatste != today

    # Tussen 2 weken en 1 week: eenmalig, zodra het venster is ingegaan.
    venster_start = record.next_inspection_date - timedelta(days=FIRST_REMINDER_DAYS)
    return laatste is None or laatste < venster_start


def _recipients(record, instellingen=None) -> list[str]:
    adressen: list[str] = []
    for user in record.notify_users.all():
        if user.email and user.email not in adressen:
            adressen.append(user.email)
    for adres in record.notify_extra_emails or []:
        adres = str(adres).strip()
        if adres and adres not in adressen:
            adressen.append(adres)

    # Staat er niets op de regel zelf? Dan de standaard ontvangers gebruiken.
    if not adressen and instellingen is not None:
        for user in instellingen.default_notify_users.all():
            if user.email and user.email not in adressen:
                adressen.append(user.email)
        for adres in instellingen.default_notify_extra_emails or []:
            adres = str(adres).strip()
            if adres and adres not in adressen:
                adressen.append(adres)
    return adressen


def _inbox_users(record, instellingen=None) -> list:
    """Gebruikers die de melding in de app krijgen (met standaard als terugval)."""
    users = list(record.notify_users.all())
    if not users and instellingen is not None:
        users = list(instellingen.default_notify_users.all())
    # Staat er nergens iemand ingesteld? Dan valt de melding stil terwijl hij
    # juist zichtbaar hoort te zijn. Daarom als laatste terugval iedereen die
    # het onderhoudsmodule mag zien.
    if not users:
        users = _onderhoud_beheerders()
    return users


def _onderhoud_beheerders() -> list:
    """Actieve gebruikers die het onderhoudsmodule mogen inzien."""
    from django.contrib.auth import get_user_model

    User = get_user_model()
    kandidaten = User.objects.filter(is_active=True).exclude(rol='chauffeur')
    return [u for u in kandidaten if u.has_module_permission('view_maintenance')]


def _build_texts(record, days: int) -> tuple[str, str, str]:
    """Onderwerp, platte tekst en html voor de herinnering."""
    kenteken = record.vehicle.kenteken
    datum = record.next_inspection_date.strftime('%d-%m-%Y')
    link = f'{_app_base_url()}{_record_path(record)}'

    if days < 0:
        termijn = f'is {abs(days)} dag(en) geleden verlopen'
        subject = f'ADR-controle verlopen: {kenteken}'
    elif days == 0:
        termijn = 'is vandaag'
        subject = f'ADR-controle vandaag: {kenteken}'
    else:
        termijn = f'is over {days} dag(en)'
        subject = f'ADR-controle over {days} dag(en): {kenteken}'

    regels = [
        f'Voertuig: {kenteken}',
        f'Route: {record.route or "-"}',
        f'ADR: {"ja" if record.has_adr else "nee"}',
        f'ADR koffer verzegeld: {"ja" if record.case_sealed else "nee"}',
        f'Laatste controle: {record.inspection_date.strftime("%d-%m-%Y")}',
        f'Volgende controle: {datum} ({termijn})',
    ]
    body_text = (
        f'De ADR-controle van {kenteken} {termijn} (gepland op {datum}).\n\n'
        + '\n'.join(regels)
        + f'\n\nBekijk de regel: {link}\n'
    )
    body_html = (
        f'<p>De ADR-controle van <strong>{escape(kenteken)}</strong> {escape(termijn)} '
        f'(gepland op <strong>{datum}</strong>).</p><ul>'
        + ''.join(f'<li>{escape(r)}</li>' for r in regels)
        + f'</ul><p><a href="{escape(link)}">Bekijk de ADR-regel</a></p>'
    )
    return subject, body_text, body_html


def _send_mail(recipients: list[str], subject: str, body_text: str, body_html: str,
               profile_id=None) -> None:
    from apps.core.views import get_smtp_config

    (smtp_host, smtp_port, smtp_username, smtp_password,
     smtp_use_tls, from_email, _signature, _src) = get_smtp_config(profile_id=profile_id, user=None)
    if not smtp_host:
        raise ValueError('SMTP is niet geconfigureerd.')

    connection = get_connection(
        backend='django.core.mail.backends.smtp.EmailBackend',
        host=smtp_host,
        port=smtp_port,
        username=smtp_username or '',
        password=smtp_password or '',
        use_tls=smtp_use_tls,
        fail_silently=False,
    )
    msg = EmailMultiAlternatives(
        subject=subject,
        body=body_text,
        from_email=from_email or smtp_username,
        to=recipients,
        connection=connection,
    )
    msg.attach_alternative(body_html, 'text/html')
    msg.send(fail_silently=False)


def _notify_in_app(record, users, title: str, body: str) -> None:
    """Zet de herinnering ook in de notificatie-inbox (belletje bovenin).

    Is push geconfigureerd, dan gaat het via de push-service (die de inbox
    zelf bijwerkt). Zo niet, dan schrijven we de inbox-regels rechtstreeks,
    zodat de melding hoe dan ook zichtbaar is.
    """
    if not users:
        return

    url = _record_path(record)
    data = {'type': 'adr_reminder', 'adr_id': str(record.id)}

    from apps.notifications.models import PushNotification, UserNotification
    from apps.notifications.services import PushNotificationService

    try:
        service = PushNotificationService()
        if service.is_configured():
            service.send_to_users(users=users, title=title, body=body, url=url, data=data)
            return
    except Exception as exc:  # noqa: BLE001 - notificatie mag de taak nooit breken
        logger.warning('Push voor ADR-herinnering mislukt: %s', exc)

    log = PushNotification.objects.create(
        title=title, body=body, url=url, data=data,
        success_count=0, failure_count=0,
    )
    UserNotification.objects.bulk_create(
        [UserNotification(notification=log, user=user) for user in users],
        ignore_conflicts=True,
    )


@shared_task
def send_adr_reminders(force: bool = False):
    """Verstuur de ADR-herinneringen.

    Beat draait deze taak elk kwartier; er wordt pas daadwerkelijk verstuurd
    zodra de ingestelde verzendtijd is bereikt en er vandaag nog niet is
    gedraaid. Met ``force=True`` (handmatige testknop) gaat het direct.
    """
    from .models import ADRRecord, ADRSettings

    instellingen = ADRSettings.get_settings()
    today = timezone.localdate()

    if not force:
        if instellingen.last_run_on == today:
            return {'status': 'skipped', 'reason': 'already_run_today', 'sent': 0, 'errors': []}
        nu = timezone.localtime()
        gepland = nu.replace(
            hour=instellingen.send_hour, minute=instellingen.send_minute,
            second=0, microsecond=0,
        )
        if nu < gepland:
            return {'status': 'skipped', 'reason': 'before_send_time', 'sent': 0, 'errors': []}

    profile_id = instellingen.email_profile_id
    records = (
        ADRRecord.objects
        .filter(has_adr=True, next_inspection_date__lte=today + timedelta(days=FIRST_REMINDER_DAYS))
        .select_related('vehicle')
        .prefetch_related('notify_users')
    )

    verstuurd = 0
    fouten: list[str] = []

    for record in records:
        if not _should_send(record, today):
            continue

        days = (record.next_inspection_date - today).days
        subject, body_text, body_html = _build_texts(record, days)
        recipients = _recipients(record, instellingen)

        mail_ok = True
        if recipients:
            try:
                _send_mail(recipients, subject, body_text, body_html, profile_id=profile_id)
            except Exception as exc:  # noqa: BLE001
                mail_ok = False
                fouten.append(f'{record.vehicle.kenteken}: {exc}')
                logger.warning('ADR-herinnering mislukt voor %s: %s', record.vehicle.kenteken, exc)

        _notify_in_app(
            record,
            _inbox_users(record, instellingen),
            title=subject,
            body=f'Volgende ADR-controle op {record.next_inspection_date.strftime("%d-%m-%Y")}.',
        )

        if mail_ok:
            record.last_reminder_sent_on = today
            record.save(update_fields=['last_reminder_sent_on'])
            verstuurd += 1

    if not force:
        instellingen.last_run_on = today
        instellingen.save(update_fields=['last_run_on'])

    return {'status': 'done', 'sent': verstuurd, 'errors': fouten}


# =============================================================================
# BRANDBLUSSERS
# =============================================================================

def _blusser_path(record) -> str:
    return f'/maintenance/brandblussers?record={record.id}'


def _blusser_should_send(record, today: date) -> bool:
    """Bepaal of er vandaag een herinnering voor deze blusser uit moet."""
    if not record.next_inspection_date:
        return False

    days = (record.next_inspection_date - today).days
    if days > FIRST_REMINDER_DAYS:
        return False

    laatste = record.last_reminder_sent_on
    if days <= DAILY_REMINDER_DAYS:
        # Laatste week en te laat: elke dag, maar niet twee keer op een dag.
        return laatste != today

    # Tussen 2 weken en 1 week: eenmalig, zodra het venster is ingegaan.
    venster_start = record.next_inspection_date - timedelta(days=FIRST_REMINDER_DAYS)
    return laatste is None or laatste < venster_start


def _blusser_texts(record, days: int) -> tuple[str, str, str]:
    """Onderwerp, platte tekst en html voor de blusser-herinnering."""
    kenteken = record.vehicle.kenteken
    datum = record.next_inspection_date.strftime('%d-%m-%Y')
    link = f'{_app_base_url()}{_blusser_path(record)}'
    label = f'brandblusser {record.volgnummer}'

    if days < 0:
        termijn = f'is {abs(days)} dag(en) geleden verlopen'
        subject = f'Brandblusser {record.volgnummer} verlopen: {kenteken}'
    elif days == 0:
        termijn = 'is vandaag'
        subject = f'Brandblusser {record.volgnummer} vervalt vandaag: {kenteken}'
    else:
        termijn = f'is over {days} dag(en)'
        subject = f'Brandblusser {record.volgnummer} vervalt over {days} dag(en): {kenteken}'

    regels = [
        f'Voertuig: {kenteken}',
        f'Route: {record.route or "-"}',
        f'Blusser: nr. {record.volgnummer}',
        f'Plaats op de wagen: {record.positie or "-"}',
        f'Serienummer: {record.serienummer or "-"}',
        f'Laatst gekeurd: {record.inspection_date.strftime("%d-%m-%Y")}',
        f'Vervaldatum: {datum} ({termijn})',
    ]
    body_text = (
        f'De keuring van {label} op {kenteken} {termijn} (vervaldatum {datum}).\n\n'
        + '\n'.join(regels)
        + f'\n\nBekijk de regel: {link}\n'
    )
    body_html = (
        f'<p>De keuring van <strong>{escape(label)}</strong> op '
        f'<strong>{escape(kenteken)}</strong> {escape(termijn)} '
        f'(vervaldatum <strong>{datum}</strong>).</p><ul>'
        + ''.join(f'<li>{escape(r)}</li>' for r in regels)
        + f'</ul><p><a href="{escape(link)}">Bekijk de brandblusser</a></p>'
    )
    return subject, body_text, body_html


def _blusser_notify_in_app(record, users, title: str, body: str) -> None:
    """Zet de blusser-herinnering ook in de notificatie-inbox."""
    if not users:
        return

    url = _blusser_path(record)
    data = {'type': 'fire_extinguisher_reminder', 'fire_extinguisher_id': str(record.id)}

    from apps.notifications.models import PushNotification, UserNotification
    from apps.notifications.services import PushNotificationService

    try:
        service = PushNotificationService()
        if service.is_configured():
            service.send_to_users(users=users, title=title, body=body, url=url, data=data)
            return
    except Exception as exc:  # noqa: BLE001 - notificatie mag de taak nooit breken
        logger.warning('Push voor brandblusser-herinnering mislukt: %s', exc)

    log = PushNotification.objects.create(
        title=title, body=body, url=url, data=data,
        success_count=0, failure_count=0,
    )
    UserNotification.objects.bulk_create(
        [UserNotification(notification=log, user=user) for user in users],
        ignore_conflicts=True,
    )


@shared_task
def send_fire_extinguisher_reminders(force: bool = False):
    """Verstuur de brandblusser-herinneringen.

    Elke blusser is een eigen regel met een eigen vervaldatum, dus drie
    blussers op één wagen leveren ook drie losse herinneringen op.
    """
    from .models import FireExtinguisherRecord, FireExtinguisherSettings

    instellingen = FireExtinguisherSettings.get_settings()
    today = timezone.localdate()

    if not force:
        if instellingen.last_run_on == today:
            return {'status': 'skipped', 'reason': 'already_run_today', 'sent': 0, 'errors': []}
        nu = timezone.localtime()
        gepland = nu.replace(
            hour=instellingen.send_hour, minute=instellingen.send_minute,
            second=0, microsecond=0,
        )
        if nu < gepland:
            return {'status': 'skipped', 'reason': 'before_send_time', 'sent': 0, 'errors': []}

    profile_id = instellingen.email_profile_id
    records = (
        FireExtinguisherRecord.objects
        .filter(next_inspection_date__lte=today + timedelta(days=FIRST_REMINDER_DAYS))
        .select_related('vehicle')
        .prefetch_related('notify_users')
    )

    verstuurd = 0
    fouten: list[str] = []

    for record in records:
        if not _blusser_should_send(record, today):
            continue

        days = (record.next_inspection_date - today).days
        subject, body_text, body_html = _blusser_texts(record, days)
        recipients = _recipients(record, instellingen)

        mail_ok = True
        if recipients:
            try:
                _send_mail(recipients, subject, body_text, body_html, profile_id=profile_id)
            except Exception as exc:  # noqa: BLE001
                mail_ok = False
                fouten.append(f'{record.vehicle.kenteken} #{record.volgnummer}: {exc}')
                logger.warning(
                    'Brandblusser-herinnering mislukt voor %s #%s: %s',
                    record.vehicle.kenteken, record.volgnummer, exc,
                )

        _blusser_notify_in_app(
            record,
            _inbox_users(record, instellingen),
            title=subject,
            body=(
                f'Brandblusser {record.volgnummer} van {record.vehicle.kenteken} '
                f'vervalt op {record.next_inspection_date.strftime("%d-%m-%Y")}.'
            ),
        )

        if mail_ok:
            record.last_reminder_sent_on = today
            record.save(update_fields=['last_reminder_sent_on'])
            verstuurd += 1

    if not force:
        instellingen.last_run_on = today
        instellingen.save(update_fields=['last_run_on'])

    return {'status': 'done', 'sent': verstuurd, 'errors': fouten}


# =============================================================================
# APK
# =============================================================================

# Een APK is lastiger op korte termijn in te plannen, dus daar begint de
# waarschuwing een maand van tevoren in plaats van twee weken.
APK_FIRST_REMINDER_DAYS = 30
APK_DAILY_REMINDER_DAYS = 14


def _apk_path(record) -> str:
    return f'/maintenance/apk?record={record.id}'


def _apk_should_send(record, today: date) -> bool:
    """Bepaal of er vandaag een APK-herinnering uit moet."""
    if not record.expiry_date:
        return False

    days = (record.expiry_date - today).days
    if days > APK_FIRST_REMINDER_DAYS:
        return False

    laatste = record.last_reminder_sent_on
    if days <= APK_DAILY_REMINDER_DAYS:
        # Laatste twee weken en te laat: elke dag, maar niet twee keer op een dag.
        return laatste != today

    # Tussen een maand en twee weken: eenmalig, zodra het venster is ingegaan.
    venster_start = record.expiry_date - timedelta(days=APK_FIRST_REMINDER_DAYS)
    return laatste is None or laatste < venster_start


def _apk_texts(record, days: int) -> tuple[str, str, str]:
    """Onderwerp, platte tekst en html voor de APK-herinnering."""
    kenteken = record.vehicle.kenteken
    datum = record.expiry_date.strftime('%d-%m-%Y')
    link = f'{_app_base_url()}{_apk_path(record)}'

    if days < 0:
        termijn = f'is {abs(days)} dag(en) geleden verlopen'
        subject = f'APK verlopen: {kenteken}'
    elif days == 0:
        termijn = 'is vandaag'
        subject = f'APK vervalt vandaag: {kenteken}'
    else:
        termijn = f'is over {days} dag(en)'
        subject = f'APK vervalt over {days} dag(en): {kenteken}'

    regels = [
        f'Voertuig: {kenteken}',
        f'Type: {record.vehicle.type_wagen or "-"}',
        f'Route: {record.vehicle.ritnummer or "-"}',
        f'Laatst gekeurd: {record.inspection_date.strftime("%d-%m-%Y")}',
        f'Keuringsstation: {record.inspection_station or "-"}',
        f'Vervaldatum: {datum} ({termijn})',
    ]
    body_text = (
        f'De APK van {kenteken} {termijn} (vervaldatum {datum}).\n\n'
        + '\n'.join(regels)
        + f'\n\nBekijk de keuring: {link}\n'
    )
    body_html = (
        f'<p>De APK van <strong>{escape(kenteken)}</strong> {escape(termijn)} '
        f'(vervaldatum <strong>{datum}</strong>).</p><ul>'
        + ''.join(f'<li>{escape(r)}</li>' for r in regels)
        + f'</ul><p><a href="{escape(link)}">Bekijk de APK-keuring</a></p>'
    )
    return subject, body_text, body_html


def _apk_notify_in_app(record, users, title: str, body: str) -> None:
    """Zet de APK-herinnering ook in de notificatie-inbox."""
    if not users:
        return

    url = _apk_path(record)
    data = {'type': 'apk_reminder', 'apk_id': str(record.id)}

    from apps.notifications.models import PushNotification, UserNotification
    from apps.notifications.services import PushNotificationService

    try:
        service = PushNotificationService()
        if service.is_configured():
            service.send_to_users(users=users, title=title, body=body, url=url, data=data)
            return
    except Exception as exc:  # noqa: BLE001 - notificatie mag de taak nooit breken
        logger.warning('Push voor APK-herinnering mislukt: %s', exc)

    log = PushNotification.objects.create(
        title=title, body=body, url=url, data=data,
        success_count=0, failure_count=0,
    )
    UserNotification.objects.bulk_create(
        [UserNotification(notification=log, user=user) for user in users],
        ignore_conflicts=True,
    )


@shared_task
def send_apk_reminders(force: bool = False):
    """Verstuur de APK-herinneringen.

    Alleen de huidige keuring per wagen telt mee; oude records uit de historie
    blijven buiten beschouwing.
    """
    from .models import APKRecord, APKSettings

    instellingen = APKSettings.get_settings()
    today = timezone.localdate()

    if not force:
        if instellingen.last_run_on == today:
            return {'status': 'skipped', 'reason': 'already_run_today', 'sent': 0, 'errors': []}
        nu = timezone.localtime()
        gepland = nu.replace(
            hour=instellingen.send_hour, minute=instellingen.send_minute,
            second=0, microsecond=0,
        )
        if nu < gepland:
            return {'status': 'skipped', 'reason': 'before_send_time', 'sent': 0, 'errors': []}

    profile_id = instellingen.email_profile_id
    records = (
        APKRecord.objects
        .filter(is_current=True, expiry_date__lte=today + timedelta(days=APK_FIRST_REMINDER_DAYS))
        .select_related('vehicle')
        .prefetch_related('notify_users')
    )

    verstuurd = 0
    fouten: list[str] = []

    for record in records:
        if not _apk_should_send(record, today):
            continue

        days = (record.expiry_date - today).days
        subject, body_text, body_html = _apk_texts(record, days)
        recipients = _recipients(record, instellingen)

        mail_ok = True
        if recipients:
            try:
                _send_mail(recipients, subject, body_text, body_html, profile_id=profile_id)
            except Exception as exc:  # noqa: BLE001
                mail_ok = False
                fouten.append(f'{record.vehicle.kenteken}: {exc}')
                logger.warning('APK-herinnering mislukt voor %s: %s', record.vehicle.kenteken, exc)

        _apk_notify_in_app(
            record,
            _inbox_users(record, instellingen),
            title=subject,
            body=f'De APK van {record.vehicle.kenteken} verloopt op {record.expiry_date.strftime("%d-%m-%Y")}.',
        )

        if mail_ok:
            record.last_reminder_sent_on = today
            record.save(update_fields=['last_reminder_sent_on'])
            verstuurd += 1

    if not force:
        instellingen.last_run_on = today
        instellingen.save(update_fields=['last_run_on'])

    return {'status': 'done', 'sent': verstuurd, 'errors': fouten}

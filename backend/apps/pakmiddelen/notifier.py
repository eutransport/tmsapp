"""Send the daily pakmiddelen report e-mail."""
from __future__ import annotations

import logging
from datetime import date

from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils.html import escape

logger = logging.getLogger(__name__)


def _resolve_smtp(config):
    from apps.core.views import get_smtp_config
    profile = config.notification_email_profile
    profile_id = profile.id if profile else None
    return get_smtp_config(profile_id=profile_id, user=None)


def send_daily_report(config, target_date: date, missing_ritnummers: list[str]) -> None:
    """Send the daily report listing ritnummers without a teruggavebon."""
    recipients = [r.strip() for r in (config.notification_recipients or []) if r and r.strip()]
    if not recipients:
        raise ValueError('Geen ontvangers geconfigureerd.')

    smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, from_email, _signature, _src = _resolve_smtp(config)
    if not smtp_host:
        raise ValueError('SMTP is niet geconfigureerd.')

    subject = f'Pakmiddelen teruggavebonnen ontbrekend - {target_date.isoformat()}'

    items_text = '\n'.join(f'- {r}' for r in missing_ritnummers)
    body_text = (
        f'Voor {target_date.isoformat()} ontbreken de volgende '
        f'pakmiddelen teruggavebonnen:\n\n{items_text}\n'
    )
    items_html = ''.join(f'<li>{escape(r)}</li>' for r in missing_ritnummers)
    body_html = (
        f'<p>Voor <strong>{target_date.isoformat()}</strong> ontbreken de volgende '
        f'pakmiddelen teruggavebonnen:</p><ul>{items_html}</ul>'
    )

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
    logger.info('Pakmiddelen rapport verstuurd naar %s', recipients)


def send_test_email(config, recipient: str) -> None:
    """Send a small test e-mail to verify SMTP."""
    smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, from_email, _signature, _src = _resolve_smtp(config)
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
        subject='Pakmiddelen testmail',
        body='Dit is een testmail van de pakmiddelen module.',
        from_email=from_email or smtp_username,
        to=[recipient],
        connection=connection,
    )
    msg.send(fail_silently=False)


def send_overview_report(config, *, recipients: list[str], date_from: date, date_to: date,
                          xlsx_bytes: bytes | None = None,
                          pdf_bytes: bytes | None = None) -> None:
    """Send the overview report to the given recipients with optional attachments."""
    recipients = [r.strip() for r in recipients if r and r.strip()]
    if not recipients:
        raise ValueError('Geen ontvangers opgegeven.')

    smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, from_email, _signature, _src = _resolve_smtp(config)
    if not smtp_host:
        raise ValueError('SMTP is niet geconfigureerd.')

    from .models import PakmiddelenCheckResult
    qs = (PakmiddelenCheckResult.objects
          .filter(check_date__gte=date_from, check_date__lte=date_to)
          .order_by('check_date', 'ritnummer'))
    total = qs.count()
    ja = qs.filter(has_bon=True).count()
    nee = total - ja

    if date_from == date_to:
        period = date_from.strftime('%d-%m-%Y')
    else:
        period = f"{date_from.strftime('%d-%m-%Y')} t/m {date_to.strftime('%d-%m-%Y')}"

    subject = f'Pakmiddelen overzicht — {period}'
    body_text = (
        f'Overzicht pakmiddelen teruggavebonnen voor periode {period}.\n\n'
        f'Totaal: {total}\nMet bon: {ja}\nZonder bon: {nee}\n'
    )

    rows_html = ''
    for r in qs:
        status = ('<span style="color:#166534;font-weight:bold">Ja</span>'
                  if r.has_bon else '<span style="color:#991B1B;font-weight:bold">Nee</span>')
        rows_html += (
            f'<tr>'
            f'<td style="padding:4px 8px;border:1px solid #ddd">{r.check_date.strftime("%d-%m-%Y")}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd">{escape(r.ritnummer)}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd">{status}</td>'
            f'<td style="padding:4px 8px;border:1px solid #ddd">{escape(r.matched_subject or "—")}</td>'
            f'</tr>'
        )
    body_html = (
        f'<p><strong>Pakmiddelen overzicht</strong> — periode {escape(period)}</p>'
        f'<p>Totaal: <b>{total}</b> &nbsp;|&nbsp; '
        f'Met bon: <b style="color:#166534">{ja}</b> &nbsp;|&nbsp; '
        f'Zonder bon: <b style="color:#991B1B">{nee}</b></p>'
        f'<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:12px">'
        f'<thead><tr style="background:#374151;color:#fff">'
        f'<th style="padding:6px 8px;text-align:left">Datum</th>'
        f'<th style="padding:6px 8px;text-align:left">Ritnummer</th>'
        f'<th style="padding:6px 8px;text-align:left">Bon</th>'
        f'<th style="padding:6px 8px;text-align:left">Onderwerp</th>'
        f'</tr></thead><tbody>{rows_html or "<tr><td colspan=4 style=\"padding:8px\">Geen resultaten.</td></tr>"}'
        f'</tbody></table>'
    )

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
    fname = f'pakmiddelen_{date_from.isoformat()}_{date_to.isoformat()}'
    if xlsx_bytes:
        msg.attach(f'{fname}.xlsx', xlsx_bytes,
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    if pdf_bytes:
        msg.attach(f'{fname}.pdf', pdf_bytes, 'application/pdf')
    msg.send(fail_silently=False)
    logger.info('Pakmiddelen overzicht (%s) verstuurd naar %s', period, recipients)


def send_secret_expiry_reminder(config, days_left: int, expires_on) -> None:
    """Notify configured recipients that the Graph client secret is about to expire."""
    recipients = [r.strip() for r in (config.notification_recipients or []) if r and r.strip()]
    if not recipients:
        raise ValueError('Geen ontvangers geconfigureerd.')

    smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, from_email, _signature, _src = _resolve_smtp(config)
    if not smtp_host:
        raise ValueError('SMTP is niet geconfigureerd.')

    subject = f'Microsoft Graph client secret verloopt over {days_left} dag(en)'
    body_text = (
        f'Het client secret voor de Pakmiddelen mailbox (Microsoft Graph) verloopt op '
        f'{expires_on.isoformat()}.\n\n'
        f'Nog {days_left} dag(en) te gaan. Vernieuw het secret in Azure / Entra ID en werk '
        f'het bij in de Pakmiddelen configuratie om onderbreking te voorkomen.\n'
    )
    body_html = (
        f'<p>Het <strong>client secret</strong> voor de Pakmiddelen mailbox (Microsoft Graph) '
        f'verloopt op <strong>{escape(expires_on.isoformat())}</strong>.</p>'
        f'<p>Nog <strong>{days_left}</strong> dag(en) te gaan. Vernieuw het secret in Azure / '
        f'Entra ID en werk het bij in de Pakmiddelen configuratie om onderbreking te voorkomen.</p>'
    )

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
    logger.info('Pakmiddelen secret expiry herinnering (%s dagen) verstuurd naar %s', days_left, recipients)

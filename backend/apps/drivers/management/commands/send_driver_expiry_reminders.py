"""
Management command to send reminder emails for expiring driver documents.

Checks all active drivers for documents expiring within the following intervals:
- 1 month (30 days)
- 3 weeks (21 days)
- 2 weeks (14 days)
- 1 week (7 days)

This command should be scheduled to run daily (e.g. via cron or Celery Beat).
Usage: python manage.py send_driver_expiry_reminders
"""
import logging
from datetime import date, timedelta

from django.core.mail import EmailMessage, get_connection
from django.core.management.base import BaseCommand

from apps.core.models import AppSettings
from apps.drivers.models import Driver

logger = logging.getLogger(__name__)

# The four document fields to check, with their Dutch labels
EXPIRY_FIELDS = [
    ('einddatum_bestuurderspas', 'Bestuurderspas'),
    ('einddatum_code95', 'Code 95'),
    ('einddatum_adr', 'ADR certificaat'),
    ('einddatum_rijbewijs', 'Rijbewijs'),
]

# Reminder thresholds in days
REMINDER_DAYS = [30, 21, 14, 7]


def _safe_str(value):
    """Convert value to safe ASCII string."""
    if value is None:
        return ''
    s = str(value)
    replacements = {
        '\u0130': 'I', '\u0131': 'i',
        '\u015e': 'S', '\u015f': 's',
        '\u00e9': 'e', '\u00e8': 'e',
        '\u00fc': 'u', '\u00f6': 'o',
    }
    for old, new in replacements.items():
        s = s.replace(old, new)
    return s


class Command(BaseCommand):
    help = 'Verstuur herinneringsmails voor verlopen chauffeursdocumenten.'

    def handle(self, *args, **options):
        settings = AppSettings.get_settings()

        if not settings.smtp_host:
            self.stderr.write(self.style.ERROR(
                'SMTP is niet geconfigureerd. Vul eerst de e-mail instellingen in.'
            ))
            return

        admin_email = settings.company_email or settings.smtp_from_email or settings.smtp_username
        if not admin_email:
            self.stderr.write(self.style.ERROR(
                'Geen e-mailadres geconfigureerd om herinneringen naar te sturen. '
                'Vul het bedrijfs-e-mail of SMTP-afzender in bij de instellingen.'
            ))
            return

        today = date.today()
        reminder_dates = {days: today + timedelta(days=days) for days in REMINDER_DAYS}

        drivers = Driver.objects.filter(actief=True)
        total_sent = 0

        for driver in drivers:
            for field_name, label in EXPIRY_FIELDS:
                expiry_date = getattr(driver, field_name)
                if expiry_date is None:
                    continue

                for days, target_date in reminder_dates.items():
                    if expiry_date == target_date:
                        success = self._send_reminder(
                            settings, admin_email,
                            driver, label, expiry_date, days,
                        )
                        if success:
                            total_sent += 1
                        break  # Only send one reminder per field per day

        self.stdout.write(self.style.SUCCESS(
            f'{total_sent} herinnering(en) verstuurd.'
        ))

    def _send_reminder(self, settings, to_email, driver, document_label, expiry_date, days_remaining):
        """Send a single reminder email."""
        formatted_date = expiry_date.strftime('%d-%m-%Y')

        if days_remaining >= 30:
            time_label = 'een maand'
        elif days_remaining >= 21:
            time_label = '3 weken'
        elif days_remaining >= 14:
            time_label = '2 weken'
        else:
            time_label = '1 week'

        subject = f'Herinnering: {document_label} van {driver.naam} verloopt over {time_label}'

        body = (
            f'Beste beheerder,\n'
            f'\n'
            f'Voor chauffeur {driver.naam} verloopt binnenkort {document_label} op {formatted_date}.\n'
            f'\n'
            f'Graag ervoor zorgen dat {document_label} op tijd verlengd wordt.\n'
            f'\n'
            f'Dit is een automatische herinnering. Er worden herinneringen verstuurd op '
            f'1 maand, 3 weken, 2 weken en 1 week voor de verloopdatum.\n'
            f'\n'
            f'Met vriendelijke groet,\n'
            f'{settings.company_name or "TMS"}'
        )

        try:
            smtp_username = _safe_str(settings.smtp_username) if settings.smtp_username else ''
            from_email = _safe_str(settings.smtp_from_email or settings.smtp_username)

            connection = get_connection(
                backend='django.core.mail.backends.smtp.EmailBackend',
                host=settings.smtp_host,
                port=settings.smtp_port,
                username=smtp_username,
                password=settings.smtp_password or '',
                use_tls=settings.smtp_use_tls,
                fail_silently=False,
            )

            email = EmailMessage(
                subject=subject,
                body=body,
                from_email=from_email,
                to=[to_email],
                connection=connection,
            )
            email.send(fail_silently=False)

            logger.info(
                f'Reminder sent: {document_label} for {driver.naam} '
                f'expires {formatted_date} (in {days_remaining} days)'
            )
            return True
        except Exception as e:
            logger.error(
                f'Failed to send reminder for {driver.naam} ({document_label}): {e}'
            )
            self.stderr.write(self.style.ERROR(
                f'Fout bij versturen herinnering voor {driver.naam} ({document_label}): {e}'
            ))
            return False

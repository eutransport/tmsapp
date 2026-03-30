"""
Management command to send reminder emails for expiring driver documents.

Checks all active drivers for documents expiring within the configured intervals.
Configuration is read from AppSettings (reminder_* fields).

This command should be scheduled to run daily (e.g. via cron or Celery Beat).
Usage: python manage.py send_driver_expiry_reminders
"""
import logging
from datetime import date, timedelta

from django.core.mail import EmailMessage, get_connection
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import AppSettings, ReminderJobLog
from apps.drivers.models import Driver

logger = logging.getLogger(__name__)

# The four document fields to check, with their Dutch labels
EXPIRY_FIELDS = [
    ('einddatum_bestuurderspas', 'Bestuurderspas'),
    ('einddatum_code95', 'Code 95'),
    ('einddatum_adr', 'ADR certificaat'),
    ('einddatum_rijbewijs', 'Rijbewijs'),
]

# Default reminder thresholds in days (4 weeks, 3 weeks, 2 weeks, 1 week)
DEFAULT_REMINDER_DAYS = [28, 21, 14, 7]


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


def _get_reminder_days(settings):
    """
    Get reminder thresholds from settings.
    Converts weeks_before list (e.g. [1, 2, 3, 4]) to days (e.g. [7, 14, 21, 28]).
    Falls back to DEFAULT_REMINDER_DAYS if not configured.
    """
    weeks_before = getattr(settings, 'reminder_weeks_before', None)
    if weeks_before and isinstance(weeks_before, list) and len(weeks_before) > 0:
        return sorted([w * 7 for w in weeks_before], reverse=True)
    return DEFAULT_REMINDER_DAYS


def _should_run_today(settings):
    """
    Check if reminders should be sent today based on frequency settings.
    """
    frequency = getattr(settings, 'reminder_frequency', 'daily')
    today_weekday = date.today().weekday()  # 0=Monday, 6=Sunday

    if frequency == 'daily':
        return True
    elif frequency == 'weekdays':
        return today_weekday <= 4  # Monday-Friday
    elif frequency == 'weekly':
        weekly_day = getattr(settings, 'reminder_weekly_day', 0)
        return today_weekday == weekly_day
    elif frequency == 'custom':
        custom_days = getattr(settings, 'reminder_custom_days', [])
        if custom_days and isinstance(custom_days, list):
            return today_weekday in custom_days
        return False
    return True


class Command(BaseCommand):
    help = 'Verstuur herinneringsmails voor verlopen chauffeursdocumenten.'

    def handle(self, *args, **options):
        job_log = ReminderJobLog.objects.create()

        settings = AppSettings.get_settings()

        # Check if reminders are enabled
        if not getattr(settings, 'reminder_enabled', False):
            msg = 'Herinneringen zijn uitgeschakeld. Schakel ze in via Instellingen > Herinneringen.'
            self.stdout.write(self.style.WARNING(msg))
            job_log.status = 'skipped'
            job_log.message = msg
            job_log.finished_at = timezone.now()
            job_log.save()
            return

        if not settings.smtp_host:
            msg = 'SMTP is niet geconfigureerd. Vul eerst de e-mail instellingen in.'
            self.stderr.write(self.style.ERROR(msg))
            job_log.status = 'error'
            job_log.message = msg
            job_log.finished_at = timezone.now()
            job_log.save()
            return

        # Use configured reminder email, fallback to company email / SMTP from
        admin_email = (
            getattr(settings, 'reminder_email', '') or
            settings.company_email or
            settings.smtp_from_email or
            settings.smtp_username
        )
        if not admin_email:
            msg = (
                'Geen e-mailadres geconfigureerd om herinneringen naar te sturen. '
                'Vul het ontvanger e-mail in bij Instellingen > Herinneringen.'
            )
            self.stderr.write(self.style.ERROR(msg))
            job_log.status = 'error'
            job_log.message = msg
            job_log.finished_at = timezone.now()
            job_log.save()
            return

        # Check if we should run today based on frequency
        if not _should_run_today(settings):
            msg = 'Vandaag geen herinneringen gepland op basis van de frequentie-instelling.'
            self.stdout.write(self.style.SUCCESS(msg))
            job_log.status = 'skipped'
            job_log.message = msg
            job_log.finished_at = timezone.now()
            job_log.save()
            return

        today = date.today()
        reminder_days = _get_reminder_days(settings)
        reminder_dates = {days: today + timedelta(days=days) for days in reminder_days}

        drivers = Driver.objects.filter(actief=True)
        total_sent = 0
        errors = []

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
                        else:
                            errors.append(f'{driver.naam} - {label}')
                        break  # Only send one reminder per field per day

        msg = f'{total_sent} herinnering(en) verstuurd.'
        if errors:
            msg += f' Fouten bij: {", ".join(errors)}'
        self.stdout.write(self.style.SUCCESS(msg))

        job_log.status = 'success' if not errors else 'warning'
        job_log.reminders_sent = total_sent
        job_log.message = msg
        job_log.finished_at = timezone.now()
        job_log.save()

    def _send_reminder(self, settings, to_email, driver, document_label, expiry_date, days_remaining):
        """Send a single reminder email."""
        formatted_date = expiry_date.strftime('%d-%m-%Y')

        weeks = days_remaining // 7
        if weeks > 1:
            time_label = f'{weeks} weken'
        else:
            time_label = '1 week'

        subject = f'Herinnering: {document_label} van {driver.naam} verloopt over {time_label}'

        # Build reminder intervals description from settings
        reminder_days = _get_reminder_days(settings)
        intervals = []
        for d in sorted(reminder_days, reverse=True):
            w = d // 7
            if w > 1:
                intervals.append(f'{w} weken')
            else:
                intervals.append('1 week')
        intervals_str = ', '.join(intervals)

        body = (
            f'Beste beheerder,\n'
            f'\n'
            f'Voor chauffeur {driver.naam} verloopt binnenkort {document_label} op {formatted_date}.\n'
            f'\n'
            f'Graag ervoor zorgen dat {document_label} op tijd verlengd wordt.\n'
            f'\n'
            f'Dit is een automatische herinnering. Er worden herinneringen verstuurd op '
            f'{intervals_str} voor de verloopdatum.\n'
        )

        # Add signature
        reminder_signature = getattr(settings, 'reminder_signature', '')
        if reminder_signature:
            body += f'\n{reminder_signature}'
        else:
            body += (
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

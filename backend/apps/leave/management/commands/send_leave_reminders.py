"""
Management command to send reminder emails for upcoming approved leave.

Checks all approved leave requests and sends reminder emails to the configured
employer email at 4 weeks, 3 weeks, 2 weeks, and 1 week before the leave start date.

Configuration is read from GlobalLeaveSettings (leave_reminder_* fields).
SMTP configuration is read from AppSettings.

This command should be scheduled to run daily via Celery Beat.
Usage: python manage.py send_leave_reminders
"""
import logging
from datetime import date, timedelta

from django.core.mail import EmailMessage, get_connection
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import AppSettings
from apps.leave.models import GlobalLeaveSettings, LeaveRequest, LeaveRequestStatus

logger = logging.getLogger(__name__)

# Default reminder thresholds in weeks (4 weeks, 3 weeks, 2 weeks, 1 week)
DEFAULT_REMINDER_WEEKS = [4, 3, 2, 1]


def _safe_str(value):
    """Convert value to safe string."""
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
    help = 'Verstuur herinneringsmails voor aankomend goedgekeurd verlof.'

    def handle(self, *args, **options):
        leave_settings = GlobalLeaveSettings.get_settings()

        # Check if leave reminders are enabled
        if not leave_settings.leave_reminder_enabled:
            self.stdout.write(self.style.WARNING(
                'Verlofherinneringen zijn uitgeschakeld. '
                'Schakel ze in via Instellingen > Verlof instellingen.'
            ))
            return

        # Get SMTP config from AppSettings
        app_settings = AppSettings.get_settings()

        if not app_settings.smtp_host:
            self.stderr.write(self.style.ERROR(
                'SMTP is niet geconfigureerd. Vul eerst de e-mail instellingen in.'
            ))
            return

        # Get the reminder email address
        to_email = leave_settings.leave_reminder_email
        if not to_email:
            # Fallback to company email or SMTP from address
            to_email = (
                app_settings.company_email or
                app_settings.smtp_from_email or
                app_settings.smtp_username
            )
        if not to_email:
            self.stderr.write(self.style.ERROR(
                'Geen e-mailadres geconfigureerd voor verlofherinneringen. '
                'Vul het e-mailadres in bij Instellingen > Verlof instellingen.'
            ))
            return

        # Get reminder weeks
        weeks_before = leave_settings.leave_reminder_weeks_before
        if not weeks_before or not isinstance(weeks_before, list) or len(weeks_before) == 0:
            weeks_before = DEFAULT_REMINDER_WEEKS

        today = date.today()
        reminder_dates = {}
        for weeks in weeks_before:
            target_date = today + timedelta(weeks=int(weeks))
            reminder_dates[int(weeks)] = target_date

        # Find approved leave requests where start_date matches any reminder date
        target_dates = list(reminder_dates.values())
        upcoming_leaves = LeaveRequest.objects.filter(
            status=LeaveRequestStatus.APPROVED,
            start_date__in=target_dates,
        ).select_related('user')

        if not upcoming_leaves.exists():
            self.stdout.write(self.style.SUCCESS(
                'Geen aankomend verlof gevonden waarvoor herinneringen verstuurd moeten worden.'
            ))
            return

        # Group leaves by their reminder target date (weeks before)
        leaves_by_weeks = {}
        for leave in upcoming_leaves:
            for weeks, target_date in reminder_dates.items():
                if leave.start_date == target_date:
                    if weeks not in leaves_by_weeks:
                        leaves_by_weeks[weeks] = []
                    leaves_by_weeks[weeks].append(leave)
                    break

        total_sent = 0
        errors = []

        # Send one email per reminder interval with all employees on leave at that time
        for weeks in sorted(leaves_by_weeks.keys(), reverse=True):
            leaves = leaves_by_weeks[weeks]
            success = self._send_reminder(
                app_settings, to_email, leaves, weeks
            )
            if success:
                total_sent += 1
            else:
                employee_names = ', '.join(l.user.full_name for l in leaves)
                errors.append(f'{weeks} weken: {employee_names}')

        msg = f'{total_sent} verlofherinnering(en) verstuurd.'
        if errors:
            msg += f' Fouten bij: {"; ".join(errors)}'
        self.stdout.write(self.style.SUCCESS(msg))

    def _send_reminder(self, app_settings, to_email, leaves, weeks_before):
        """Send a single reminder email for a group of leave requests."""
        if weeks_before > 1:
            time_label = f'{weeks_before} weken'
        else:
            time_label = '1 week'

        subject = f'Verlofherinnering: medewerker(s) met verlof over {time_label}'

        # Build the list of employees on leave
        lines = []
        for leave in leaves:
            formatted_start = leave.start_date.strftime('%d-%m-%Y')
            formatted_end = leave.end_date.strftime('%d-%m-%Y')
            leave_type = leave.get_leave_type_display()
            lines.append(
                f'  • {leave.user.full_name} — {leave_type}\n'
                f'    Van {formatted_start} t/m {formatted_end} '
                f'({leave.hours_requested} uur)'
            )

        employees_list = '\n'.join(lines)

        body = (
            f'Beste werkgever,\n'
            f'\n'
            f'Over {time_label} begint het verlof van de volgende medewerker(s):\n'
            f'\n'
            f'{employees_list}\n'
            f'\n'
            f'Gelieve hier rekening mee te houden in de planning.\n'
            f'\n'
            f'Dit is een automatische herinnering.\n'
            f'\n'
            f'Met vriendelijke groet,\n'
            f'{app_settings.company_name or "TMS"}'
        )

        try:
            smtp_username = _safe_str(app_settings.smtp_username) if app_settings.smtp_username else ''
            from_email = _safe_str(app_settings.smtp_from_email or app_settings.smtp_username)

            connection = get_connection(
                backend='django.core.mail.backends.smtp.EmailBackend',
                host=app_settings.smtp_host,
                port=app_settings.smtp_port,
                username=smtp_username,
                ****** or '',
                use_tls=app_settings.smtp_use_tls,
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

            employee_names = ', '.join(l.user.full_name for l in leaves)
            logger.info(
                'Leave reminder sent: %d week(s) before for %s',
                weeks_before, employee_names
            )
            return True
        except Exception as e:
            logger.error(
                'Failed to send leave reminder (%d weeks before): %s',
                weeks_before, e
            )
            self.stderr.write(self.style.ERROR(
                f'Fout bij versturen verlofherinnering ({weeks_before} weken): {e}'
            ))
            return False

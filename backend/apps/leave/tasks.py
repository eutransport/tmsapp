"""
Celery tasks for leave-related scheduled operations.
"""
from celery import shared_task
import logging

logger = logging.getLogger(__name__)


@shared_task
def send_leave_reminders():
    """
    Send reminder emails for upcoming approved leave.
    Wraps the management command logic as a Celery task.
    """
    from django.core.management import call_command
    from io import StringIO

    stdout = StringIO()
    stderr = StringIO()

    try:
        call_command('send_leave_reminders', stdout=stdout, stderr=stderr)
        output = stdout.getvalue()
        errors = stderr.getvalue()

        if errors:
            logger.warning('Leave reminders completed with errors: %s', errors)
        else:
            logger.info('Leave reminders completed: %s', output.strip())

        return {'status': 'completed', 'output': output.strip(), 'errors': errors.strip()}
    except Exception as e:
        logger.error('Failed to run leave reminders: %s', str(e))
        raise

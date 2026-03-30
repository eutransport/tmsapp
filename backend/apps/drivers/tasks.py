"""
Celery tasks for driver-related scheduled operations.
"""
from celery import shared_task
import logging

logger = logging.getLogger(__name__)


@shared_task
def send_driver_expiry_reminders():
    """
    Send reminder emails for expiring driver documents.
    Wraps the existing management command logic as a Celery task.
    """
    from django.core.management import call_command
    from io import StringIO

    stdout = StringIO()
    stderr = StringIO()

    try:
        call_command('send_driver_expiry_reminders', stdout=stdout, stderr=stderr)
        output = stdout.getvalue()
        errors = stderr.getvalue()

        if errors:
            logger.warning('Driver expiry reminders completed with errors: %s', errors)
        else:
            logger.info('Driver expiry reminders completed: %s', output.strip())

        return {'status': 'completed', 'output': output.strip(), 'errors': errors.strip()}
    except Exception as e:
        logger.error('Failed to run driver expiry reminders: %s', str(e))
        raise

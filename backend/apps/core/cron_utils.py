"""
Utility functions for managing the Celery Beat schedule for reminder jobs.

Uses Django settings CELERY_BEAT_SCHEDULE to manage the driver expiry
reminder task schedule dynamically.
"""
import logging

from celery.schedules import crontab

logger = logging.getLogger(__name__)

# Celery Beat schedule key for the driver reminders task
BEAT_SCHEDULE_KEY = 'send-driver-expiry-reminders'
TASK_NAME = 'apps.drivers.tasks.send_driver_expiry_reminders'


def build_cron_expression(settings):
    """
    Build a cron expression from reminder settings.

    Args:
        settings: AppSettings instance with reminder_* fields

    Returns:
        Cron expression string (e.g., '0 8 * * *')
    """
    reminder_time = getattr(settings, 'reminder_time', None)
    if reminder_time:
        minute = reminder_time.minute
        hour = reminder_time.hour
    else:
        minute = 0
        hour = 8

    frequency = getattr(settings, 'reminder_frequency', 'daily')

    if frequency == 'daily':
        dow = '*'
    elif frequency == 'weekdays':
        dow = '1-5'
    elif frequency == 'weekly':
        weekly_day = getattr(settings, 'reminder_weekly_day', 0)
        # Python weekday: 0=Monday..6=Sunday → cron: 0=Sunday, 1=Monday..6=Saturday
        cron_day = (weekly_day + 1) % 7
        dow = str(cron_day)
    elif frequency == 'custom':
        custom_days = getattr(settings, 'reminder_custom_days', [])
        if custom_days and isinstance(custom_days, list):
            cron_days = [(d + 1) % 7 for d in custom_days]
            dow = ','.join(str(d) for d in sorted(cron_days))
        else:
            dow = '*'
    else:
        dow = '*'

    return f'{minute} {hour} * * {dow}'


def _build_celery_crontab(settings):
    """
    Build a Celery crontab object from reminder settings.

    Args:
        settings: AppSettings instance

    Returns:
        celery.schedules.crontab instance
    """
    reminder_time = getattr(settings, 'reminder_time', None)
    if reminder_time:
        minute = reminder_time.minute
        hour = reminder_time.hour
    else:
        minute = 0
        hour = 8

    frequency = getattr(settings, 'reminder_frequency', 'daily')

    if frequency == 'daily':
        return crontab(minute=minute, hour=hour)
    elif frequency == 'weekdays':
        return crontab(minute=minute, hour=hour, day_of_week='1-5')
    elif frequency == 'weekly':
        weekly_day = getattr(settings, 'reminder_weekly_day', 0)
        cron_day = (weekly_day + 1) % 7
        return crontab(minute=minute, hour=hour, day_of_week=str(cron_day))
    elif frequency == 'custom':
        custom_days = getattr(settings, 'reminder_custom_days', [])
        if custom_days and isinstance(custom_days, list):
            cron_days = [(d + 1) % 7 for d in custom_days]
            dow = ','.join(str(d) for d in sorted(cron_days))
            return crontab(minute=minute, hour=hour, day_of_week=dow)
    return crontab(minute=minute, hour=hour)


def get_cron_status():
    """
    Check if the driver reminder task is scheduled in Celery Beat.

    Returns:
        dict with 'active' (bool), 'expression' (str or None)
    """
    from django.conf import settings as django_settings

    beat_schedule = getattr(django_settings, 'CELERY_BEAT_SCHEDULE', {})
    entry = beat_schedule.get(BEAT_SCHEDULE_KEY)

    if entry:
        schedule = entry.get('schedule')
        expression = _crontab_to_expression(schedule) if schedule else None
        return {
            'active': True,
            'expression': expression,
            'cron_line': f'celery beat: {expression}',
        }
    return {
        'active': False,
        'expression': None,
        'cron_line': None,
    }


def _crontab_to_expression(schedule):
    """Convert a Celery crontab to a human-readable cron expression."""
    if not isinstance(schedule, crontab):
        return str(schedule)
    minute = schedule._orig_minute if hasattr(schedule, '_orig_minute') else '*'
    hour = schedule._orig_hour if hasattr(schedule, '_orig_hour') else '*'
    dom = schedule._orig_day_of_month if hasattr(schedule, '_orig_day_of_month') else '*'
    month = schedule._orig_month_of_year if hasattr(schedule, '_orig_month_of_year') else '*'
    dow = schedule._orig_day_of_week if hasattr(schedule, '_orig_day_of_week') else '*'
    return f'{minute} {hour} {dom} {month} {dow}'


def sync_cron_job(settings):
    """
    Create or update the Celery Beat schedule entry for driver reminders.

    If reminders are enabled, adds/updates the beat schedule entry.
    If reminders are disabled, removes the beat schedule entry.

    Args:
        settings: AppSettings instance

    Returns:
        dict with 'success' (bool), 'message' (str), 'status' dict
    """
    from django.conf import settings as django_settings
    from tms.celery import app as celery_app

    enabled = getattr(settings, 'reminder_enabled', False)

    if not hasattr(django_settings, 'CELERY_BEAT_SCHEDULE'):
        django_settings.CELERY_BEAT_SCHEDULE = {}

    try:
        if not enabled:
            # Remove from beat schedule
            if BEAT_SCHEDULE_KEY in django_settings.CELERY_BEAT_SCHEDULE:
                del django_settings.CELERY_BEAT_SCHEDULE[BEAT_SCHEDULE_KEY]
                celery_app.conf.beat_schedule = django_settings.CELERY_BEAT_SCHEDULE
            return {
                'success': True,
                'message': 'Taakplanning verwijderd (herinneringen zijn uitgeschakeld).',
                'status': get_cron_status(),
            }

        # Build the schedule entry
        schedule = _build_celery_crontab(settings)
        expression = build_cron_expression(settings)

        django_settings.CELERY_BEAT_SCHEDULE[BEAT_SCHEDULE_KEY] = {
            'task': TASK_NAME,
            'schedule': schedule,
        }
        celery_app.conf.beat_schedule = django_settings.CELERY_BEAT_SCHEDULE

        logger.info('Celery Beat schedule updated: %s → %s', BEAT_SCHEDULE_KEY, expression)

        return {
            'success': True,
            'message': 'Taakplanning succesvol aangemaakt/bijgewerkt.',
            'status': get_cron_status(),
        }
    except Exception as e:
        logger.error('Failed to update Celery Beat schedule: %s', e)
        return {
            'success': False,
            'message': 'Kon de taakplanning niet aanmaken.',
            'detail': str(e),
            'status': get_cron_status(),
        }


def remove_cron_job():
    """
    Remove the driver reminder task from the Celery Beat schedule.

    Returns:
        dict with 'success' (bool), 'message' (str)
    """
    from django.conf import settings as django_settings
    from tms.celery import app as celery_app

    try:
        if not hasattr(django_settings, 'CELERY_BEAT_SCHEDULE'):
            django_settings.CELERY_BEAT_SCHEDULE = {}

        if BEAT_SCHEDULE_KEY in django_settings.CELERY_BEAT_SCHEDULE:
            del django_settings.CELERY_BEAT_SCHEDULE[BEAT_SCHEDULE_KEY]
            celery_app.conf.beat_schedule = django_settings.CELERY_BEAT_SCHEDULE

        return {
            'success': True,
            'message': 'Taakplanning succesvol verwijderd.',
        }
    except Exception as e:
        logger.error('Failed to remove Celery Beat schedule entry: %s', e)
        return {
            'success': False,
            'message': 'Kon de taakplanning niet verwijderen.',
        }

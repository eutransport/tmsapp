"""
Celery application configuration for TMS.

This module sets up the Celery app, auto-discovers tasks from all
installed Django apps, and defines the beat schedule.
"""
import os

from celery import Celery
from celery.schedules import crontab

# Set the default Django settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.production')

app = Celery('tms')

# Load Celery settings from Django settings (CELERY_ namespace)
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in all installed apps
app.autodiscover_tasks()

# Beat schedule: periodic tasks
app.conf.beat_schedule = {
    'send-driver-expiry-reminders': {
        'task': 'apps.drivers.tasks.send_driver_expiry_reminders',
        'schedule': crontab(hour=8, minute=0),
    },
    'send-leave-reminders': {
        'task': 'apps.leave.tasks.send_leave_reminders',
        'schedule': crontab(hour=8, minute=15),
    },
    'pakmiddelen-scheduled-check': {
        'task': 'apps.pakmiddelen.tasks.run_scheduled_check',
        'schedule': crontab(minute='*'),
    },
    'pakmiddelen-secret-expiry-check': {
        'task': 'apps.pakmiddelen.tasks.check_secret_expiry',
        'schedule': crontab(hour=8, minute=30),
    },
}

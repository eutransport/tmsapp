"""
Celery application configuration for TMS.

This module sets up the Celery app, auto-discovers tasks from all
installed Django apps, and defines the beat schedule.
"""
import os

from celery import Celery

# Set the default Django settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.production')

app = Celery('tms')

# Load Celery settings from Django settings (CELERY_ namespace)
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in all installed apps
app.autodiscover_tasks()

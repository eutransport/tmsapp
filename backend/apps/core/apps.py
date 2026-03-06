"""
Core app - Application settings, logo, favicon, etc.
"""
import os
from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.core'
    verbose_name = 'Core Settings'
    
    def ready(self):
        # Import signals to register them
        from . import signals  # noqa
        
        # Start background metrics collector (only in the main process, not in management commands)
        # Check for RUN_MAIN to avoid duplicate threads in dev server reload
        if os.environ.get('RUN_MAIN') == 'true' or 'gunicorn' in os.environ.get('SERVER_SOFTWARE', ''):
            self._start_metrics_collector()
        elif not any(cmd in os.environ.get('_', '') for cmd in ['manage.py', 'celery']):
            # Production: gunicorn doesn't set RUN_MAIN
            self._start_metrics_collector()
    
    def _start_metrics_collector(self):
        try:
            from .monitoring import MetricsCollector
            collector = MetricsCollector.instance()
            collector.start()
        except Exception:
            pass  # Don't crash the app if monitoring fails

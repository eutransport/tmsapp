from django.apps import AppConfig


class TollingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.tolling'
    verbose_name = 'Tolheffing'

    def ready(self):
        # Registreer signals (o.a. heropenen TollingEvents bij verwijderen factuur/regel).
        from . import signals  # noqa: F401

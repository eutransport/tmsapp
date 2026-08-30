from django.apps import AppConfig

class FleetConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.fleet'
    verbose_name = 'Vloot'

    def ready(self):
        # Houdt Vehicle.ritnummer en Vehicle.bedrijf gelijk aan hun periodes.
        from . import signals  # noqa: F401

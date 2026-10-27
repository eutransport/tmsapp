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
    'send-invoice-reminders': {
        'task': 'apps.invoicing.tasks.send_invoice_reminders',
        'schedule': crontab(hour=8, minute=30),
    },
    'send-adr-reminders': {
        # Elk kwartier kijken of de ingestelde verzendtijd (standaard 06:00)
        # bereikt is; de taak verstuurt maximaal één keer per dag.
        'task': 'apps.maintenance.tasks.send_adr_reminders',
        'schedule': crontab(minute='*/15'),
    },
    'pakmiddelen-scheduled-check': {
        'task': 'apps.pakmiddelen.tasks.run_scheduled_check',
        'schedule': crontab(minute='*'),
    },
    'pakmiddelen-secret-expiry-check': {
        'task': 'apps.pakmiddelen.tasks.check_secret_expiry',
        'schedule': crontab(hour=8, minute=30),
    },
    'sync-tachograph-hours': {
        'task': 'apps.tracking.tasks.sync_tachograph_hours',
        # Run daily at 03:00 — yesterday's tachograph data is then complete
        'schedule': crontab(hour=3, minute=0),
    },
    'sync-radius-journeys': {
        # Radius bewaart maar ~30 dagen ritgeschiedenis; dagelijks ophalen
        # zodat het eigen archief verder terug blijft gaan.
        'task': 'apps.tracking.tasks.sync_radius_journeys',
        'schedule': crontab(hour=3, minute=20),
    },
    'sync-radius-journeys-recent': {
        # Elke 5 minuten de lopende en vorige dag bijwerken, zodat het archief
        # en de kilometers vrijwel actueel zijn. Dit is één API-aanroep.
        'task': 'apps.tracking.tasks.sync_radius_journeys',
        'schedule': crontab(minute='*/5'),
        'kwargs': {'dagen': 2},
    },
    'send-daily-task-reminders': {
        # Runs every minute; the task itself checks the configured send time.
        'task': 'apps.tasks.tasks.send_daily_task_reminders',
        'schedule': crontab(minute='*'),
    },
    'send-stale-task-reminders': {
        'task': 'apps.tasks.tasks.send_stale_task_reminders',
        'schedule': crontab(hour=8, minute=45),
    },
    'sync-vehicle-ritnummers': {
        # Kort na middernacht: periodes met een toekomstige ingangsdatum
        # worden dan vanzelf het huidige ritnummer van de wagen.
        'task': 'apps.fleet.tasks.sync_ritnummers',
        'schedule': crontab(hour=0, minute=5),
    },
    'sync-vehicle-bedrijven': {
        # Idem voor het bedrijf waarvoor de wagen rijdt.
        'task': 'apps.fleet.tasks.sync_bedrijven',
        'schedule': crontab(hour=0, minute=10),
    },
    'opruimen-ritnummer-correcties': {
        # Ritnummercorrecties zijn een maand terug te draaien; daarna weg.
        'task': 'apps.tolling.tasks.opruimen_ritnummer_correcties',
        'schedule': crontab(hour=0, minute=20),
    },
    'controleer-tariefbronnen': {
        # Maandagochtend de officiele tariefpagina's van NL, DE en BE nakijken.
        'task': 'apps.tolling.tasks.controleer_tariefbronnen',
        'schedule': crontab(day_of_week=1, hour=6, minute=0),
    },
    'ververs-opdracht-eta': {
        # De taak kiest zelf per opdracht hoe vaak er gemeten wordt: ver weg
        # eens per tien minuten, vlak voor aankomst elke minuut.
        'task': 'apps.opdrachten.tasks.ververs_eta',
        'schedule': crontab(minute='*'),
    },
    'controleer-azure-geheim': {
        # Dagelijks kijken of het clientgeheim van de Azure-koppeling bijna
        # verloopt; de taak waarschuwt één keer per vervaldatum.
        'task': 'apps.accounts.tasks.controleer_azure_geheim',
        'schedule': crontab(hour=8, minute=5),
    },
}

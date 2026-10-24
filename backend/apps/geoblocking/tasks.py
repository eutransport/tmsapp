"""Achtergrondtaken voor geo-blocking."""
import logging

from celery import shared_task
from django.core.management import call_command
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name='geoblocking.update_geoip_database')
def update_geoip_database():
    """Ververs de GeoLite2-database. MaxMind werkt die wekelijks bij."""
    try:
        call_command('update_geoip_db')
        return 'ok'
    except Exception as exc:
        logger.warning('Bijwerken GeoIP-database mislukt: %s', exc)
        return f'mislukt: {exc}'


@shared_task(name='geoblocking.opschonen_logs')
def opschonen_logs():
    """Verwijder logregels die ouder zijn dan de ingestelde bewaartermijn."""
    from .models import GeoAccessLog, GeoBlockSettings

    config = GeoBlockSettings.load()
    dagen = config.log_retention_days or 30
    grens = timezone.now() - timezone.timedelta(days=dagen)
    aantal, _ = GeoAccessLog.objects.filter(created_at__lt=grens).delete()
    return aantal

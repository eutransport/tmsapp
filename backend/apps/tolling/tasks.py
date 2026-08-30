"""Periodieke taken voor de tolheffing."""
import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name='apps.tolling.tasks.opruimen_ritnummer_correcties')
def opruimen_ritnummer_correcties() -> int:
    """Gooi ritnummercorrecties weg die te oud zijn om nog terug te draaien."""
    from datetime import timedelta

    from .models import RitnummerCorrectie
    from .views import RITNUMMER_CORRECTIE_BEWAARDAGEN

    grens = timezone.now() - timedelta(days=RITNUMMER_CORRECTIE_BEWAARDAGEN)
    aantal, _ = RitnummerCorrectie.objects.filter(uitgevoerd_op__lt=grens).delete()
    if aantal:
        logger.info('%d oude ritnummercorrecties opgeruimd', aantal)
    return aantal

import logging

from celery import shared_task

from . import eta
from .models import Opdracht, OpdrachtStatus

logger = logging.getLogger(__name__)


@shared_task
def ververs_eta():
    """Houdt de aankomstvoorspelling van lopende opdrachten bij."""
    lopend = list(
        Opdracht.objects
        .select_related('chauffeur__voertuig')
        .filter(status=OpdrachtStatus.GESTART)
    )
    if not lopend:
        return 'geen lopende opdrachten'

    bijgewerkt = eta.ververs(lopend)
    logger.info('ETA bijgewerkt voor %s van %s opdrachten', bijgewerkt, len(lopend))
    return '%s van %s bijgewerkt' % (bijgewerkt, len(lopend))

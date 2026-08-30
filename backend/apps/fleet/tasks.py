"""Achtergrondtaken voor de vloot."""
import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name='apps.fleet.tasks.sync_ritnummers')
def sync_ritnummers():
    """Zet het huidige ritnummer van elke wagen gelijk aan de geldende periode.

    Draait dagelijks kort na middernacht, zodat een periode met een
    toekomstige ingangsdatum op de juiste dag vanzelf actief wordt.
    """
    from .ritnummers import synchroniseer_huidig_ritnummer

    aantal = synchroniseer_huidig_ritnummer()
    if aantal:
        logger.info('Ritnummer bijgewerkt voor %d voertuig(en).', aantal)
    return aantal

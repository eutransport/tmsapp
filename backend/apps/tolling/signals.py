"""Signals voor tolheffing.

Twee dingen gebeuren hier automatisch rond de facturatie.

Wordt een InvoiceLine (of de hele factuur) verwijderd, dan worden de
gekoppelde TollingEvents weer als 'niet gefactureerd' gemarkeerd
(invoiced_at = NULL) zodat ze opnieuw in de open-weken/facturatie flow
verschijnen. De FK ``TollingEvent.invoice_line`` staat op ``SET_NULL`` en
wordt door Django zelf geleegd; wij zorgen alleen dat ``invoiced_at`` mee
geleegd wordt.

Wordt er juist gefactureerd, dan schuiven passages over een al afgesloten
periode alsnog het archief in. Zie `afsluiting_service.naleveren`.

Belangrijk (safety):
- We resetten ALLEEN events die aan exact deze factuurregel gekoppeld zijn
  (``invoice_line_id == instance.pk``). Nooit iets breders.
- We laten ``is_private`` en ``private_registration`` ongemoeid.
- pre_delete op InvoiceLine dekt ook Invoice-verwijdering (cascade voert per
  regel signalen uit).
"""
import logging

from django.db.models.signals import post_save, pre_delete
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(pre_delete, sender='invoicing.InvoiceLine')
def reopen_tolling_events_on_invoice_line_delete(sender, instance, **kwargs):
    """Zet ``invoiced_at`` terug op NULL voor events aan deze factuurregel."""
    from .models import TollingEvent

    # Alleen events die daadwerkelijk aan deze regel hangen.
    qs = TollingEvent.objects.filter(invoice_line_id=instance.pk)
    # bulk update; FK zelf wordt door SET_NULL leeggemaakt door Django's cascade.
    updated = qs.update(invoiced_at=None)
    if updated:
        logger.info(
            "Tolling: %d event(s) heropend na verwijderen InvoiceLine %s",
            updated, instance.pk,
        )


@receiver(post_save, sender='invoicing.Invoice')
def archiveer_nagekomen_tolregels(sender, instance, **kwargs):
    """Een passage die achteraf wordt gefactureerd hoort alsnog in het archief.

    Radius factureert met vertraging. Wat ten tijde van het afsluiten nog
    openstond en nu alsnog op een factuur komt, zou anders het schoongeveegde
    overzicht opnieuw vervuilen.
    """
    from . import afsluiting_service

    try:
        afsluiting_service.naleveren()
    except Exception:  # noqa: BLE001 - facturatie mag hier nooit op stuklopen
        logger.exception('Tolling: nagekomen passages archiveren mislukt')

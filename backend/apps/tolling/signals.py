"""Signals voor tolheffing.

Doel: wanneer een InvoiceLine (of de hele factuur) wordt verwijderd, de
gekoppelde TollingEvents weer als 'niet gefactureerd' markeren
(invoiced_at = NULL) zodat ze opnieuw in de open-weken/facturatie flow
verschijnen. De FK ``TollingEvent.invoice_line`` staat op ``SET_NULL`` en
wordt door Django zelf geleegd; wij zorgen alleen dat ``invoiced_at`` mee
geleegd wordt.

Belangrijk (safety):
- We resetten ALLEEN events die aan exact deze factuurregel gekoppeld zijn
  (``invoice_line_id == instance.pk``). Nooit iets breders.
- We laten ``is_private`` en ``private_registration`` ongemoeid.
- pre_delete op InvoiceLine dekt ook Invoice-verwijdering (cascade voert per
  regel signalen uit).
"""
import logging

from django.db.models.signals import pre_delete
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

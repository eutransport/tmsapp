"""Houd ``Vehicle.ritnummer`` en de ritnummerperiodes met elkaar in pas.

De periodes zijn de bron van waarheid; ``Vehicle.ritnummer`` is de waarde
die vandaag geldt en blijft bestaan zodat alle bestaande schermen en
overzichten ongewijzigd blijven werken.

Beide kanten schrijven met ``queryset.update()`` / ``bulk_update()``, die
geen signalen afvuren. Zo kan er geen lus ontstaan.
"""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .models import Vehicle, VehicleRitnummer
from .ritnummers import _kies, _vandaag, bouw_ritnummer_index


@receiver(post_save, sender=Vehicle, dispatch_uid='fleet_vehicle_ritnummer_sync')
def vehicle_opgeslagen(sender, instance, created, **kwargs):
    """Zet het ritnummer van de wagen door naar de periode van vandaag."""
    huidig = (instance.ritnummer or '').strip()
    vandaag = _vandaag()

    periodes = list(
        VehicleRitnummer.objects.filter(vehicle_id=instance.pk)
        .order_by('geldig_vanaf', 'created_at')
        .values_list('id', 'geldig_vanaf', 'ritnummer')
    )
    if not periodes:
        VehicleRitnummer.objects.create(
            vehicle_id=instance.pk, ritnummer=huidig, geldig_vanaf=None,
        )
        return

    # Zoek de periode die vandaag geldt (None sorteert in Postgres achteraan,
    # dus expliciet vooraan zetten).
    periodes.sort(key=lambda r: (r[1] is not None, r[1]))
    geldig = periodes[0]
    for rij in periodes:
        if rij[1] is None or rij[1] <= vandaag:
            geldig = rij
        else:
            break

    if (geldig[2] or '').strip() != huidig:
        VehicleRitnummer.objects.filter(pk=geldig[0]).update(ritnummer=huidig)


@receiver(post_save, sender=VehicleRitnummer, dispatch_uid='fleet_periode_opgeslagen')
@receiver(post_delete, sender=VehicleRitnummer, dispatch_uid='fleet_periode_verwijderd')
def periode_gewijzigd(sender, instance, **kwargs):
    """Werk het huidige ritnummer van de wagen bij na een periodewijziging."""
    index = bouw_ritnummer_index([instance.vehicle_id])
    periodes = index.get(instance.vehicle_id)
    if not periodes:
        return
    nieuw = _kies(periodes, _vandaag())
    Vehicle.objects.filter(pk=instance.vehicle_id).exclude(ritnummer=nieuw).update(
        ritnummer=nieuw,
    )

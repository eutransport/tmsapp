"""Houd ``Vehicle.ritnummer`` en ``Vehicle.bedrijf`` in pas met hun periodes.

De periodes zijn de bron van waarheid; de velden op de wagen zelf bevatten
de waarde die vandaag geldt en blijven bestaan zodat alle bestaande schermen
en overzichten ongewijzigd blijven werken.

Beide kanten schrijven met ``queryset.update()`` / ``bulk_update()``, die
geen signalen afvuren. Zo kan er geen lus ontstaan.
"""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from .bedrijven import _kies as _kies_bedrijf
from .bedrijven import bouw_bedrijf_index
from .models import Vehicle, VehicleBedrijf, VehicleRitnummer
from .ritnummers import _kies, _vandaag, bouw_ritnummer_index


def _geldige_periode(periodes, vandaag):
    """Zoek in ``[(id, geldig_vanaf, waarde), ...]`` de rij die vandaag geldt.

    ``None`` sorteert in Postgres achteraan, dus die zetten we expliciet
    vooraan: dat is immers de periode 'vanaf het begin'.
    """
    periodes = sorted(periodes, key=lambda r: (r[1] is not None, r[1]))
    geldig = periodes[0]
    for rij in periodes:
        if rij[1] is None or rij[1] <= vandaag:
            geldig = rij
        else:
            break
    return geldig


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

    geldig = _geldige_periode(periodes, vandaag)

    if (geldig[2] or '').strip() != huidig:
        VehicleRitnummer.objects.filter(pk=geldig[0]).update(ritnummer=huidig)


@receiver(post_save, sender=Vehicle, dispatch_uid='fleet_vehicle_bedrijf_sync')
def vehicle_bedrijf_opgeslagen(sender, instance, created, **kwargs):
    """Zet het bedrijf van de wagen door naar de periode van vandaag."""
    huidig = instance.bedrijf_id
    if huidig is None:
        return
    vandaag = _vandaag()

    periodes = list(
        VehicleBedrijf.objects.filter(vehicle_id=instance.pk)
        .order_by('geldig_vanaf', 'created_at')
        .values_list('id', 'geldig_vanaf', 'bedrijf_id')
    )
    if not periodes:
        VehicleBedrijf.objects.create(
            vehicle_id=instance.pk, bedrijf_id=huidig, geldig_vanaf=None,
        )
        return

    geldig = _geldige_periode(periodes, vandaag)

    if geldig[2] != huidig:
        VehicleBedrijf.objects.filter(pk=geldig[0]).update(bedrijf_id=huidig)


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


@receiver(post_save, sender=VehicleBedrijf, dispatch_uid='fleet_bedrijfsperiode_opgeslagen')
@receiver(post_delete, sender=VehicleBedrijf, dispatch_uid='fleet_bedrijfsperiode_verwijderd')
def bedrijfsperiode_gewijzigd(sender, instance, **kwargs):
    """Werk het huidige bedrijf van de wagen bij na een periodewijziging."""
    index = bouw_bedrijf_index([instance.vehicle_id])
    periodes = index.get(instance.vehicle_id)
    if not periodes:
        return
    nieuw = _kies_bedrijf(periodes, _vandaag())
    if nieuw is None:
        return
    Vehicle.objects.filter(pk=instance.vehicle_id).exclude(bedrijf_id=nieuw).update(
        bedrijf_id=nieuw,
    )

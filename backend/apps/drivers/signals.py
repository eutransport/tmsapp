"""Houdt bij wanneer een chauffeur van bedrijf wisselt."""
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from .models import Driver, DriverBedrijfPeriode


@receiver(pre_save, sender=Driver)
def onthoud_vorig_bedrijf(sender, instance, **kwargs):
    if not instance.pk:
        instance._vorig_bedrijf_id = None
        return
    instance._vorig_bedrijf_id = (
        Driver.objects.filter(pk=instance.pk).values_list('bedrijf_id', flat=True).first()
    )


@receiver(post_save, sender=Driver)
def werk_periode_bij(sender, instance, created, **kwargs):
    vorig = getattr(instance, '_vorig_bedrijf_id', None)
    if not created and vorig == instance.bedrijf_id:
        return

    vandaag = timezone.localdate()
    open_periodes = DriverBedrijfPeriode.objects.filter(driver=instance, tot__isnull=True)
    if instance.bedrijf_id and open_periodes.filter(bedrijf_id=instance.bedrijf_id).exists():
        open_periodes.exclude(bedrijf_id=instance.bedrijf_id).update(tot=vandaag)
        return

    open_periodes.update(tot=vandaag)
    if instance.bedrijf_id:
        DriverBedrijfPeriode.objects.create(
            driver=instance, bedrijf_id=instance.bedrijf_id, vanaf=vandaag
        )

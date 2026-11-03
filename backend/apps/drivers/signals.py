"""Houdt bij wanneer een chauffeur van bedrijf of charter wisselt."""
from datetime import timedelta

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone

from .models import Driver, DriverBedrijfPeriode, DriverCharterPeriode


@receiver(pre_save, sender=Driver)
def onthoud_vorig_bedrijf(sender, instance, **kwargs):
    if not instance.pk:
        instance._vorig_bedrijf_id = None
        instance._vorig_charter_id = None
        return
    vorig = Driver.objects.filter(pk=instance.pk).values_list('bedrijf_id', 'charter_id').first()
    instance._vorig_bedrijf_id, instance._vorig_charter_id = vorig or (None, None)


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


@receiver(post_save, sender=Driver)
def werk_charter_periode_bij(sender, instance, created, **kwargs):
    """Sluit de lopende charterperiode en opent zo nodig een nieuwe.

    De oude periode loopt tot en met gisteren: vanaf de dag van de wissel ziet
    de vorige charter niets meer. De allereerste koppeling begint 'vanaf het
    begin', zodat de charter met terugwerkende kracht alle weken ziet. De
    beheerder kan beide datums daarna nog bijstellen.
    """
    vorig = getattr(instance, '_vorig_charter_id', None)
    if not created and vorig == instance.charter_id:
        return

    vandaag = timezone.localdate()
    gisteren = vandaag - timedelta(days=1)
    open_periodes = DriverCharterPeriode.objects.filter(driver=instance, tot__isnull=True)
    if instance.charter_id:
        open_periodes = open_periodes.exclude(charter_id=instance.charter_id)
    open_periodes.update(tot=gisteren)
    # Een periode die vandaag pas begon en nu alweer sluit, heeft nooit gegolden.
    DriverCharterPeriode.objects.filter(driver=instance, vanaf__gt=gisteren, tot=gisteren).delete()

    if not instance.charter_id:
        return
    if DriverCharterPeriode.objects.filter(
        driver=instance, charter_id=instance.charter_id, tot__isnull=True
    ).exists():
        return
    eerste_keer = not DriverCharterPeriode.objects.filter(driver=instance).exists()
    DriverCharterPeriode.objects.create(
        driver=instance,
        charter_id=instance.charter_id,
        vanaf=None if eerste_keer else vandaag,
    )

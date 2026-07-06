"""Loadlist models — photo of an addresses/pallets sheet becomes an ordered
loading plan (last delivery loaded first).

Design goals:
- All rows belong to a user (owner-only access at the queryset layer).
- Original OCR text is kept for auditability / re-parsing.
- Stops keep both the "as read" sequence and the computed load sequence,
  so users can always see what was on the paper vs. what we recommend.
"""
from __future__ import annotations

import uuid
from django.conf import settings
from django.db import models


def loadlist_photo_upload_path(instance, filename: str) -> str:
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'jpg'
    # Keep filenames unpredictable so /media/ enumeration is not useful
    return f'loadlists/{instance.id}.{ext}'


class LoadList(models.Model):
    STATUS_CHOICES = [
        ('uploaded', 'Geüpload'),
        ('parsing', 'Bezig met inlezen'),
        ('parsed', 'Ingelezen'),
        ('optimizing', 'Bezig met optimaliseren'),
        ('optimized', 'Geoptimaliseerd'),
        ('error', 'Fout'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='loadlists',
    )
    name = models.CharField(max_length=120, blank=True, default='')
    photo = models.ImageField(upload_to=loadlist_photo_upload_path, null=True, blank=True)
    start_address = models.CharField(
        max_length=250, blank=True, default='',
        help_text='Vertrekpunt (depot). Wordt gebruikt als startpunt voor de route.'
    )
    start_lat = models.FloatField(null=True, blank=True)
    start_lng = models.FloatField(null=True, blank=True)

    # Global window for the whole route (single-day tour).
    start_time = models.TimeField(null=True, blank=True,
                                  help_text='Vertrektijd vanaf depot')
    end_time = models.TimeField(null=True, blank=True,
                                help_text='Terug op depot uiterlijk (optioneel)')

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='uploaded')
    status_message = models.CharField(max_length=500, blank=True, default='')

    raw_ocr_text = models.TextField(blank=True, default='')
    extraction_provider = models.CharField(max_length=40, blank=True, default='')

    total_distance_m = models.PositiveIntegerField(null=True, blank=True)
    total_duration_s = models.PositiveIntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Laadlijst'
        verbose_name_plural = 'Laadlijsten'

    def __str__(self) -> str:  # pragma: no cover
        return self.name or f'Laadlijst {self.id}'


class LoadStop(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    loadlist = models.ForeignKey(LoadList, on_delete=models.CASCADE, related_name='stops')

    # Original order as it appeared on the paper (0-based).
    original_sequence = models.PositiveIntegerField(default=0)
    # Delivery order along the optimized route (0 = first delivery, N = last).
    delivery_sequence = models.PositiveIntegerField(null=True, blank=True)
    # Loading order (reverse of delivery): 0 = load LAST (comes off first).
    # Users typically want to load the last delivery first, so the first
    # delivery is at the back of the trailer. load_sequence = 0 means
    # "load this one last / it goes at the back door / it comes off first".
    load_sequence = models.PositiveIntegerField(null=True, blank=True)

    address_raw = models.CharField(max_length=300)
    address_formatted = models.CharField(max_length=300, blank=True, default='')
    postcode = models.CharField(max_length=20, blank=True, default='')
    city = models.CharField(max_length=120, blank=True, default='')
    country = models.CharField(max_length=80, blank=True, default='')

    reference = models.CharField(max_length=80, blank=True, default='',
                                 help_text='Ordernummer / referentie zoals op de lijst')
    colli = models.PositiveIntegerField(null=True, blank=True)
    pallets = models.PositiveIntegerField(null=True, blank=True)
    weight_kg = models.FloatField(null=True, blank=True)
    notes = models.CharField(max_length=250, blank=True, default='')

    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    geocode_confidence = models.CharField(max_length=20, blank=True, default='')
    geocode_error = models.CharField(max_length=200, blank=True, default='')

    # Optional time window: earliest and latest arrival time at this stop.
    # Used by the optimizer to sequence deliveries with time constraints.
    time_window_start = models.TimeField(null=True, blank=True,
                                         help_text='Vroegste aankomsttijd (bv. 08:00)')
    time_window_end = models.TimeField(null=True, blank=True,
                                       help_text='Uiterste aankomsttijd (bv. 12:00)')

    class Meta:
        ordering = ['loadlist', 'original_sequence']
        verbose_name = 'Stop'
        verbose_name_plural = 'Stops'

    def __str__(self) -> str:  # pragma: no cover
        return f'{self.original_sequence + 1}. {self.address_raw[:60]}'


class Depot(models.Model):
    """A named depot/start location that admins configure once, then anyone
    can pick from a dropdown when creating a laadlijst.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120,
                            help_text='Herkenbare naam, bv. "DACHSER Waddinxveen"')
    address = models.CharField(max_length=300,
                               help_text='Volledig adres zoals in Google Maps')
    lat = models.FloatField(null=True, blank=True)
    lng = models.FloatField(null=True, blank=True)
    is_default = models.BooleanField(default=False,
                                     help_text='Automatisch vooringevuld voor nieuwe lijsten')
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='created_depots',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-is_default', 'name']
        verbose_name = 'Depot'
        verbose_name_plural = 'Depots'

    def __str__(self) -> str:  # pragma: no cover
        return self.name

    def save(self, *args, **kwargs):
        # Only one depot can be marked as default; unset others on save.
        if self.is_default:
            Depot.objects.exclude(pk=self.pk).filter(is_default=True).update(is_default=False)
        super().save(*args, **kwargs)

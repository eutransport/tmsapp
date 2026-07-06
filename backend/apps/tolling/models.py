"""Models voor de Tolheffing-import module.

- `TollingImportBatch`: metadata over een CSV upload.
- `TollingEvent`: individueel toll-event (per rit) uit de CSV.

Kentekens worden opgeslagen in de originele CSV-vorm (raw) én
een genormaliseerde variant (alleen alfanumeriek, upper case) zodat
we kunnen matchen met `Vehicle.kenteken` waar streepjes in staan.
"""
import re
import uuid

from django.conf import settings
from django.db import models


def normalize_plate(value: str) -> str:
    if not value:
        return ''
    return re.sub(r'[^A-Z0-9]', '', value.upper())


class TollingImportBatch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='tolling_import_batches',
    )
    filename = models.CharField(max_length=255, blank=True)
    rows_total = models.PositiveIntegerField(default=0)
    rows_imported = models.PositiveIntegerField(default=0)
    rows_duplicate = models.PositiveIntegerField(default=0)
    rows_invalid = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Tolheffing import batch'
        verbose_name_plural = 'Tolheffing import batches'

    def __str__(self) -> str:
        return f"{self.filename or 'batch'} ({self.rows_imported}/{self.rows_total})"


class TollingEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        TollingImportBatch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='events',
    )
    start_at = models.DateTimeField(verbose_name='Startdatum')
    end_at = models.DateTimeField(verbose_name='Einddatum')
    distance_km = models.DecimalField(max_digits=10, decimal_places=3, verbose_name='Afstand (km)')
    amount = models.DecimalField(max_digits=10, decimal_places=2, verbose_name='Bedrag')
    license_plate_raw = models.CharField(max_length=32, verbose_name='Kenteken (bron)')
    license_plate_normalized = models.CharField(max_length=32, db_index=True, verbose_name='Kenteken (genormaliseerd)')
    obu = models.CharField(max_length=64, blank=True, verbose_name='OBU')

    invoice_line = models.ForeignKey(
        'invoicing.InvoiceLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tolling_events',
    )
    invoiced_at = models.DateTimeField(null=True, blank=True, verbose_name='Gefactureerd op')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_at']
        verbose_name = 'Tolheffing event'
        verbose_name_plural = 'Tolheffing events'
        constraints = [
            models.UniqueConstraint(
                fields=['start_at', 'end_at', 'license_plate_normalized', 'amount', 'obu'],
                name='tolling_event_unique_fingerprint',
            ),
        ]
        indexes = [
            models.Index(fields=['license_plate_normalized', 'start_at']),
            models.Index(fields=['invoiced_at']),
        ]

    def __str__(self) -> str:
        return f"{self.license_plate_raw} {self.start_at:%Y-%m-%d %H:%M} €{self.amount}"

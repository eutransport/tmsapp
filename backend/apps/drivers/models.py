"""Drivers models - To be implemented in Fase 2."""
import uuid
from django.db import models
from django.conf import settings


class Driver(models.Model):
    """Chauffeur model."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    naam = models.CharField(max_length=200, verbose_name='Naam')
    telefoon = models.CharField(max_length=20, blank=True, verbose_name='Telefoon')
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='drivers',
        verbose_name='Bedrijf'
    )
    gekoppelde_gebruiker = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='driver_profile',
        verbose_name='Gekoppelde Gebruiker'
    )
    voertuig = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='chauffeurs',
        verbose_name='Voertuig (Ritnummer)'
    )
    adr = models.BooleanField(default=False, verbose_name='ADR Gecertificeerd')
    minimum_uren_per_week = models.DecimalField(
        max_digits=5, decimal_places=2,
        null=True, blank=True,
        verbose_name='Minimum uren per week',
        help_text='Standaard minimum uren per week voor deze chauffeur. Wordt gebruikt als er geen specifieke weekinstelling is.'
    )
    actief = models.BooleanField(
        default=True,
        verbose_name='Actief',
        help_text='Inactieve chauffeurs worden niet meegeteld in urenoverzichten.'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Chauffeur'
        verbose_name_plural = 'Chauffeurs'
        ordering = ['naam']
    
    def __str__(self):
        return self.naam

"""Fleet models - To be implemented in Fase 2."""
import uuid
from django.db import models


class Vehicle(models.Model):
    """Voertuig model."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kenteken = models.CharField(max_length=20, unique=True, verbose_name='Kenteken')
    type_wagen = models.CharField(max_length=100, verbose_name='Type Wagen')
    ritnummer = models.CharField(max_length=50, verbose_name='Ritnummer')
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.CASCADE,
        related_name='vehicles',
        verbose_name='Bedrijf'
    )
    
    minimum_weken_per_jaar = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Minimum weken per jaar',
        help_text='Minimaal aantal weken dat dit voertuig per jaar moet draaien. Laat leeg om niet bij te houden.'
    )
    actief = models.BooleanField(
        default=True,
        verbose_name='Actief',
        help_text='Inactieve voertuigen worden niet getoond in selectielijsten maar hun historische data blijft beschikbaar.'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Voertuig'
        verbose_name_plural = 'Voertuigen'
        ordering = ['kenteken']
    
    def __str__(self):
        return f"{self.kenteken} - {self.type_wagen}"

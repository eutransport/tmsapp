"""Companies models - To be implemented in Fase 2."""
import uuid
from django.db import models


class Company(models.Model):
    """Bedrijf model."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    naam = models.CharField(max_length=200, verbose_name='Naam')
    kvk = models.CharField(max_length=20, blank=True, verbose_name='KVK Nummer')
    telefoon = models.CharField(max_length=20, blank=True, verbose_name='Telefoon')
    contactpersoon = models.CharField(max_length=200, blank=True, verbose_name='Contactpersoon')
    email = models.EmailField(blank=True, verbose_name='E-mail')
    adres = models.CharField(max_length=255, blank=True, verbose_name='Adres')
    postcode = models.CharField(max_length=10, blank=True, verbose_name='Postcode')
    stad = models.CharField(max_length=100, blank=True, verbose_name='Stad')
    land = models.CharField(max_length=100, blank=True, verbose_name='Land')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Bedrijf'
        verbose_name_plural = 'Bedrijven'
        ordering = ['naam']
    
    def __str__(self):
        return self.naam


class MailingListContact(models.Model):
    """Contact in een mailinglijst van een bedrijf."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bedrijf = models.ForeignKey(
        Company,
        on_delete=models.CASCADE,
        related_name='mailing_contacts',
        verbose_name='Bedrijf'
    )
    naam = models.CharField(max_length=200, verbose_name='Naam')
    email = models.EmailField(verbose_name='E-mail')
    functie = models.CharField(max_length=200, blank=True, verbose_name='Functie')
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Mailinglijst contact'
        verbose_name_plural = 'Mailinglijst contacten'
        ordering = ['naam']
        unique_together = ['bedrijf', 'email']
    
    def __str__(self):
        return f"{self.naam} <{self.email}>"

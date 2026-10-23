"""Companies models - To be implemented in Fase 2."""
import uuid
from django.core.validators import MaxValueValidator, MinValueValidator
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

    # Alleen beheerders vullen dit; bepaalt wat het opdrachtgeversportaal op de kaart toont.
    volgbare_voertuigen = models.ManyToManyField(
        'fleet.Vehicle',
        blank=True,
        related_name='volgbaar_voor_bedrijven',
        verbose_name='Volgbare voertuigen'
    )

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


class HerinneringInstelling(models.Model):
    """Per opdrachtgever regelen of en hoe vaak er een betalingsherinnering uitgaat.

    Staat er geen instelling, dan gaat er niets uit; aanzetten is een bewuste keuze.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bedrijf = models.OneToOneField(
        Company,
        on_delete=models.CASCADE,
        related_name='herinnering_instelling',
        verbose_name='Opdrachtgever',
    )
    actief = models.BooleanField(default=False, verbose_name='Herinneringen versturen')
    interval_dagen = models.PositiveSmallIntegerField(
        default=7,
        validators=[MinValueValidator(1), MaxValueValidator(90)],
        verbose_name='Om de hoeveel dagen',
        help_text='Dagen na de vervaldatum voor de eerste herinnering, en de tussenpoos daarna.',
    )
    max_herinneringen = models.PositiveSmallIntegerField(
        default=3,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
        verbose_name='Aantal herinneringen',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Instelling betalingsherinneringen'
        verbose_name_plural = 'Instellingen betalingsherinneringen'

    def __str__(self):
        stand = 'actief' if self.actief else 'uit'
        return f'Herinneringen {self.bedrijf.naam} ({stand})'

    def dagen_reeks(self):
        """De dagen na de vervaldatum waarop een herinnering hoort te gaan."""
        return [self.interval_dagen * n for n in range(1, self.max_herinneringen + 1)]

"""Configuratie voor de factuurwizard.

De wizard laat een medewerker in een paar stappen een factuur maken zonder de
volledige factuurmodule te hoeven kennen. Wat er gekozen kan worden legt de
beheerder hier vast: welke bedrijven, welke template daarbij hoort en welke
diensten (routenummers uit de vloot) voor dat bedrijf gefactureerd mogen
worden.

Deze modellen staan bewust los van de bestaande facturatie. De wizard maakt
uiteindelijk gewone Invoice- en InvoiceLine-records aan, zodat alles wat er nu
al is (PDF, mailen, overzichten, omzet) ongewijzigd blijft werken.
"""
import uuid

from django.db import models


class FactuurWizardBedrijf(models.Model):
    """Een bedrijf dat via de wizard gefactureerd mag worden."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bedrijf = models.OneToOneField(
        'companies.Company',
        on_delete=models.CASCADE,
        related_name='factuurwizard',
        verbose_name='Bedrijf',
    )
    template = models.ForeignKey(
        'invoicing.InvoiceTemplate',
        on_delete=models.PROTECT,
        related_name='factuurwizard_bedrijven',
        verbose_name='Factuur template',
        help_text='De template die automatisch wordt gebruikt bij dit bedrijf.',
    )
    administratie = models.ForeignKey(
        'core.Administratie',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='factuurwizard_bedrijven',
        verbose_name='Administratie',
        help_text='Bepaalt de factuurnummering en wie de factuur mag inzien.',
    )

    btw_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        default=21,
        verbose_name='BTW %',
    )
    betaaltermijn_dagen = models.PositiveSmallIntegerField(
        default=30,
        verbose_name='Betaaltermijn (dagen)',
        help_text='De vervaldatum wordt de factuurdatum plus dit aantal dagen.',
    )

    actief = models.BooleanField(
        default=True,
        verbose_name='Actief',
        help_text='Alleen actieve bedrijven verschijnen in de wizard.',
    )
    volgorde = models.PositiveIntegerField(default=0, verbose_name='Volgorde')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Factuurwizard bedrijf'
        verbose_name_plural = 'Factuurwizard bedrijven'
        ordering = ['volgorde', 'bedrijf__naam']

    def __str__(self):
        return f"{self.bedrijf.naam} ({self.template.naam})"


class FactuurWizardDienst(models.Model):
    """Een dienst die voor dat bedrijf gefactureerd mag worden.

    Een dienst is een routenummer zoals dat in de vloot is vastgelegd. We slaan
    het nummer als tekst op en niet als verwijzing naar een voertuig: een route
    kan van wagen wisselen, maar de dienst die je factureert blijft dezelfde.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    config = models.ForeignKey(
        FactuurWizardBedrijf,
        on_delete=models.CASCADE,
        related_name='diensten',
        verbose_name='Bedrijf',
    )
    ritnummer = models.CharField(
        max_length=50,
        verbose_name='Routenummer',
        help_text='Het routenummer zoals het in de vloot staat.',
    )
    omschrijving = models.CharField(
        max_length=200,
        blank=True,
        verbose_name='Toelichting',
        help_text='Optionele toelichting, bijvoorbeeld het type wagen.',
    )
    actief = models.BooleanField(default=True, verbose_name='Actief')
    volgorde = models.PositiveIntegerField(default=0, verbose_name='Volgorde')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Factuurwizard dienst'
        verbose_name_plural = 'Factuurwizard diensten'
        ordering = ['volgorde', 'ritnummer']
        constraints = [
            models.UniqueConstraint(
                fields=['config', 'ritnummer'],
                name='uniek_ritnummer_per_wizardbedrijf',
            )
        ]

    def __str__(self):
        return f"{self.config.bedrijf.naam} - route {self.ritnummer}"

"""Banking models voor bankkoppeling en transactiematching."""
import uuid
from django.db import models
from django.conf import settings


class BankAccountType(models.TextChoices):
    ING = 'ing', 'ING'
    RABOBANK = 'rabobank', 'Rabobank'
    ABN_AMRO = 'abn_amro', 'ABN AMRO'
    SNS = 'sns', 'SNS Bank'
    TRIODOS = 'triodos', 'Triodos Bank'
    OTHER = 'other', 'Overig'


class BankTransaction(models.Model):
    """Een bankafschriftregel, eventueel gekoppeld aan een factuur."""

    class MatchStatus(models.TextChoices):
        NIEUW = 'nieuw', 'Nieuw'
        GEMATCHT = 'gematcht', 'Gematcht'
        HANDMATIG = 'handmatig', 'Handmatig gematcht'
        GEEN_MATCH = 'geen_match', 'Geen match'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    bankrekening = models.ForeignKey(
        'BankAccount',
        on_delete=models.CASCADE,
        related_name='transacties',
        verbose_name='Bankrekening',
    )

    # Transaction fields
    datum = models.DateField(verbose_name='Datum')
    bedrag = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        verbose_name='Bedrag (+ bijschrijving, - afschrijving)',
    )
    naam_tegenpartij = models.CharField(
        max_length=255, blank=True, verbose_name='Naam tegenpartij'
    )
    rekeningnummer_tegenpartij = models.CharField(
        max_length=50, blank=True, verbose_name='IBAN tegenpartij'
    )
    omschrijving = models.TextField(blank=True, verbose_name='Omschrijving / Mededelingen')
    mutatiesoort = models.CharField(max_length=100, blank=True, verbose_name='Mutatiesoort')

    # Raw reference code (e.g. from MT940)
    referentie = models.CharField(max_length=255, blank=True, verbose_name='Referentie')

    # Matching
    match_status = models.CharField(
        max_length=20,
        choices=MatchStatus.choices,
        default=MatchStatus.NIEUW,
        verbose_name='Match status',
    )
    gekoppelde_factuur = models.ForeignKey(
        'invoicing.Invoice',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='banktransacties',
        verbose_name='Gekoppelde factuur',
    )
    gevonden_factuurnummer = models.CharField(
        max_length=50, blank=True, verbose_name='Gevonden factuurnummer'
    )

    # Import tracking
    importbestand = models.ForeignKey(
        'BankImport',
        on_delete=models.CASCADE,
        related_name='transacties',
        verbose_name='Importbestand',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Banktransactie'
        verbose_name_plural = 'Banktransacties'
        ordering = ['-datum', '-created_at']
        # Prevent duplicate imports for the same account+date+amount+description combo
        unique_together = [
            ('bankrekening', 'datum', 'bedrag', 'referentie', 'naam_tegenpartij'),
        ]

    def __str__(self):
        richting = 'Bij' if self.bedrag >= 0 else 'Af'
        return f"{self.datum} | {richting} €{abs(self.bedrag)} | {self.naam_tegenpartij}"


class BankAccount(models.Model):
    """Geconfigureerde bankrekening."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    naam = models.CharField(max_length=100, verbose_name='Naam rekening')
    bank = models.CharField(
        max_length=20,
        choices=BankAccountType.choices,
        default=BankAccountType.ING,
        verbose_name='Bank',
    )
    iban = models.CharField(max_length=34, verbose_name='IBAN')
    is_active = models.BooleanField(default=True, verbose_name='Actief')

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='bank_accounts',
        verbose_name='Aangemaakt door',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Bankrekening'
        verbose_name_plural = 'Bankrekeningen'
        ordering = ['naam']

    def __str__(self):
        return f"{self.naam} ({self.iban})"


class BankImport(models.Model):
    """Een geïmporteerd bankafschriftbestand."""

    class Status(models.TextChoices):
        VERWERKT = 'verwerkt', 'Verwerkt'
        FOUT = 'fout', 'Fout'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    bankrekening = models.ForeignKey(
        BankAccount,
        on_delete=models.CASCADE,
        related_name='imports',
        verbose_name='Bankrekening',
    )
    bestandsnaam = models.CharField(max_length=255, verbose_name='Bestandsnaam')
    bestandsformaat = models.CharField(
        max_length=10, default='csv', verbose_name='Formaat'
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.VERWERKT,
        verbose_name='Status',
    )
    aantal_transacties = models.PositiveIntegerField(
        default=0, verbose_name='Aantal transacties'
    )
    aantal_gematcht = models.PositiveIntegerField(
        default=0, verbose_name='Automatisch gematcht'
    )
    foutmelding = models.TextField(blank=True, verbose_name='Foutmelding')

    geimporteerd_door = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='bank_imports',
        verbose_name='Geïmporteerd door',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Bankimport'
        verbose_name_plural = 'Bankimports'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.bankrekening.naam} - {self.bestandsnaam} ({self.created_at.date()})"

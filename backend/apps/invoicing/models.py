"""Invoicing models - To be fully implemented in Fase 5 & 6."""
import uuid
from django.db import models
from django.conf import settings


class InvoiceType(models.TextChoices):
    INKOOP = 'inkoop', 'Inkoop'
    VERKOOP = 'verkoop', 'Verkoop'
    CREDIT = 'credit', 'Credit'


class InvoiceStatus(models.TextChoices):
    CONCEPT = 'concept', 'Concept'
    DEFINITIEF = 'definitief', 'Definitief'
    VERZONDEN = 'verzonden', 'Verzonden'
    BETAALD = 'betaald', 'Betaald'


class InvoiceTemplate(models.Model):
    """Factuur template met flexibele JSON structuur."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    naam = models.CharField(max_length=100, verbose_name='Template Naam')
    beschrijving = models.TextField(blank=True, verbose_name='Beschrijving')
    
    # JSON structure for the template layout
    # Contains: header, subheader, columns, footer config
    layout = models.JSONField(default=dict, verbose_name='Layout Configuratie')
    
    # Global variables for this template
    variables = models.JSONField(default=dict, verbose_name='Variabelen')
    
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Factuur Template'
        verbose_name_plural = 'Factuur Templates'
        ordering = ['naam']
    
    def __str__(self):
        return self.naam


class Invoice(models.Model):
    """Factuur model."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Invoice identification
    factuurnummer = models.CharField(max_length=50, unique=True, verbose_name='Factuurnummer')
    type = models.CharField(
        max_length=20,
        choices=InvoiceType.choices,
        default=InvoiceType.VERKOOP,
        verbose_name='Type'
    )
    status = models.CharField(
        max_length=20,
        choices=InvoiceStatus.choices,
        default=InvoiceStatus.CONCEPT,
        verbose_name='Status'
    )
    
    # Relations
    template = models.ForeignKey(
        InvoiceTemplate,
        on_delete=models.SET_NULL,
        related_name='invoices',
        verbose_name='Template',
        null=True,
        blank=True,
    )
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.PROTECT,
        related_name='invoices',
        verbose_name='Bedrijf'
    )
    
    # Dates
    factuurdatum = models.DateField(verbose_name='Factuurdatum')
    vervaldatum = models.DateField(verbose_name='Vervaldatum')
    
    # Amounts (calculated)
    subtotaal = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='Subtotaal')
    btw_percentage = models.DecimalField(max_digits=5, decimal_places=2, default=21, verbose_name='BTW %')
    btw_bedrag = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='BTW Bedrag')
    totaal = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='Totaal')
    
    # Notes
    opmerkingen = models.TextField(blank=True, verbose_name='Opmerkingen')
    
    # PDF storage
    pdf_file = models.FileField(upload_to='invoices/', null=True, blank=True, verbose_name='PDF')
    
    # Attachment
    bijlage = models.FileField(upload_to='invoices/bijlagen/', null=True, blank=True, verbose_name='Bijlage')
    
    # Tracking
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_invoices',
        verbose_name='Aangemaakt door'
    )
    # Week and chauffeur tracking (for time entry based invoices)
    week_number = models.PositiveSmallIntegerField(
        null=True, blank=True,
        verbose_name='Weeknummer'
    )
    week_year = models.PositiveSmallIntegerField(
        null=True, blank=True,
        verbose_name='Jaar (voor week)'
    )
    chauffeur = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='chauffeur_invoices',
        verbose_name='Chauffeur'
    )
    sent_at = models.DateTimeField(null=True, blank=True, verbose_name='Verzonden op')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Factuur'
        verbose_name_plural = 'Facturen'
        ordering = ['-factuurdatum', '-factuurnummer']
    
    def __str__(self):
        return f"{self.factuurnummer} - {self.bedrijf.naam}"
    
    def calculate_totals(self):
        """Herbereken alle totalen."""
        self.subtotaal = sum(line.totaal for line in self.lines.all())
        self.btw_bedrag = self.subtotaal * (self.btw_percentage / 100)
        self.totaal = self.subtotaal + self.btw_bedrag
        # Creditfacturen: bedragen negatief opslaan
        if self.type == 'credit':
            self.subtotaal = -abs(self.subtotaal)
            self.btw_bedrag = -abs(self.btw_bedrag)
            self.totaal = -abs(self.totaal)
        self.save()


class InvoiceLine(models.Model):
    """Factuur regel."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(
        Invoice,
        on_delete=models.CASCADE,
        related_name='lines',
        verbose_name='Factuur'
    )
    
    # Line content (flexible based on template)
    omschrijving = models.CharField(max_length=500, verbose_name='Omschrijving')
    aantal = models.DecimalField(max_digits=10, decimal_places=2, default=1, verbose_name='Aantal')
    eenheid = models.CharField(max_length=20, default='stuk', verbose_name='Eenheid')
    prijs_per_eenheid = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='Prijs/Eenheid')
    totaal = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='Totaal')
    
    # Link to time entry (if imported from hours)
    time_entry = models.ForeignKey(
        'timetracking.TimeEntry',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoice_lines',
        verbose_name='Urenregistratie'
    )
    
    # Additional data (JSON for flexibility)
    extra_data = models.JSONField(default=dict, verbose_name='Extra Data')
    
    volgorde = models.PositiveIntegerField(default=0, verbose_name='Volgorde')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Factuur Regel'
        verbose_name_plural = 'Factuur Regels'
        ordering = ['volgorde']
    
    def __str__(self):
        return f"{self.invoice.factuurnummer} - {self.omschrijving[:50]}"
    
    def save(self, *args, **kwargs):
        # Calculate line total
        self.totaal = self.aantal * self.prijs_per_eenheid
        super().save(*args, **kwargs)


class ExpenseCategory(models.TextChoices):
    """Expense categories for classification."""
    BRANDSTOF = 'brandstof', 'Brandstof'
    ONDERHOUD = 'onderhoud', 'Onderhoud & Reparatie'
    VERZEKERING = 'verzekering', 'Verzekering'
    BELASTING = 'belasting', 'Wegenbelasting'
    LEASE = 'lease', 'Lease / Huur'
    PERSONEELSKOSTEN = 'personeelskosten', 'Personeelskosten'
    KANTOORKOSTEN = 'kantoorkosten', 'Kantoorkosten'
    MARKETING = 'marketing', 'Marketing & Reclame'
    SOFTWARE = 'software', 'Software & Abonnementen'
    OVERIG = 'overig', 'Overig'


class Expense(models.Model):
    """
    Uitgaven model - voor kosten die niet via inkoopfacturen lopen.
    Bijv. brandstof, onderhoud, abonnementen, etc.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Description
    omschrijving = models.CharField(max_length=255, verbose_name='Omschrijving')
    categorie = models.CharField(
        max_length=30,
        choices=ExpenseCategory.choices,
        default=ExpenseCategory.OVERIG,
        verbose_name='Categorie'
    )
    
    # Amount
    bedrag = models.DecimalField(max_digits=10, decimal_places=2, verbose_name='Bedrag (excl. BTW)')
    btw_bedrag = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='BTW Bedrag')
    totaal = models.DecimalField(max_digits=10, decimal_places=2, verbose_name='Totaal (incl. BTW)')
    
    # Date
    datum = models.DateField(verbose_name='Datum')
    
    # Optional relations
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='expenses',
        verbose_name='Leverancier'
    )
    voertuig = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='expenses',
        verbose_name='Voertuig'
    )
    chauffeur = models.ForeignKey(
        'drivers.Driver',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='expenses',
        verbose_name='Chauffeur'
    )
    
    # Notes & attachments
    notities = models.TextField(blank=True, verbose_name='Notities')
    bijlage = models.FileField(upload_to='expenses/', null=True, blank=True, verbose_name='Bijlage')
    
    # Tracking
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='created_expenses',
        verbose_name='Aangemaakt door'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Uitgave'
        verbose_name_plural = 'Uitgaven'
        ordering = ['-datum', '-created_at']
    
    def __str__(self):
        return f"{self.datum} - {self.omschrijving} (€{self.totaal})"
    
    def save(self, *args, **kwargs):
        # Calculate total if not set
        if not self.totaal:
            self.totaal = self.bedrag + self.btw_bedrag
        super().save(*args, **kwargs)

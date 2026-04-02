"""Timetracking models - To be fully implemented in Fase 3."""
import uuid
from datetime import timedelta
from django.db import models
from django.conf import settings


class TimeEntryStatus(models.TextChoices):
    CONCEPT = 'concept', 'Concept'
    INGEDIEND = 'ingediend', 'Ingediend'


class TimeEntryBron(models.TextChoices):
    HANDMATIG = 'handmatig', 'Handmatig'
    AUTO_IMPORT = 'auto_import', 'Automatische import'


class TimeEntry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='time_entries',
        verbose_name='Gebruiker'
    )
    
    weeknummer = models.PositiveIntegerField(verbose_name='Weeknummer')
    ritnummer = models.CharField(max_length=50, verbose_name='Ritnummer')
    datum = models.DateField(verbose_name='Datum')
    kenteken = models.CharField(max_length=20, verbose_name='Kenteken')
    
    km_start = models.PositiveIntegerField(verbose_name='KM Start')
    km_eind = models.PositiveIntegerField(verbose_name='KM Eind')
    totaal_km = models.PositiveIntegerField(verbose_name='Totaal KM', editable=False)
    
    aanvang = models.TimeField(verbose_name='Aanvang')
    eind = models.TimeField(verbose_name='Eind')
    pauze = models.DurationField(default=timedelta(minutes=0), verbose_name='Pauze')
    totaal_uren = models.DurationField(verbose_name='Totaal Uren', editable=False)
    
    status = models.CharField(
        max_length=20,
        choices=TimeEntryStatus.choices,
        default=TimeEntryStatus.CONCEPT,
        verbose_name='Status'
    )
    bron = models.CharField(
        max_length=20,
        choices=TimeEntryBron.choices,
        default=TimeEntryBron.HANDMATIG,
        verbose_name='Bron'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Urenregistratie'
        verbose_name_plural = 'Urenregistraties'
        ordering = ['-datum', '-aanvang']
    
    def __str__(self):
        return f"{self.user} - {self.datum} - {self.ritnummer}"
    
    def save(self, *args, **kwargs):
        # Auto-calculate weeknummer from datum
        self.weeknummer = self.datum.isocalendar()[1]
        
        # Calculate totaal_km
        self.totaal_km = max(0, self.km_eind - self.km_start)
        
        # Calculate totaal_uren
        from datetime import datetime, date
        aanvang_dt = datetime.combine(date.today(), self.aanvang)
        eind_dt = datetime.combine(date.today(), self.eind)
        
        # Handle overnight shifts
        if eind_dt < aanvang_dt:
            eind_dt += timedelta(days=1)
        
        werk_tijd = eind_dt - aanvang_dt
        self.totaal_uren = werk_tijd - self.pauze
        
        super().save(*args, **kwargs)


class WeeklyMinimumHours(models.Model):
    """Minimum uren per gebruiker per week."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='weekly_minimum_hours',
        verbose_name='Gebruiker'
    )
    jaar = models.PositiveIntegerField(verbose_name='Jaar')
    weeknummer = models.PositiveIntegerField(verbose_name='Weeknummer')
    minimum_uren = models.DecimalField(
        max_digits=5, decimal_places=2, default=40,
        verbose_name='Minimale uren'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Minimale weekuren'
        verbose_name_plural = 'Minimale weekuren'
        unique_together = ['user', 'jaar', 'weeknummer']
        ordering = ['-jaar', '-weeknummer']
    
    def __str__(self):
        return f"{self.user} - {self.jaar} W{self.weeknummer}: {self.minimum_uren}u"


class ImportBatch(models.Model):
    """Batch van geïmporteerde uren uit een Excel bestand."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bestandsnaam = models.CharField(max_length=255, verbose_name='Bestandsnaam')
    bestand = models.FileField(upload_to='imports/uren/', null=True, blank=True, verbose_name='Bestand')
    geimporteerd_door = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='import_batches',
        verbose_name='Geïmporteerd door'
    )
    totaal_rijen = models.PositiveIntegerField(default=0, verbose_name='Totaal rijen')
    gekoppeld = models.PositiveIntegerField(default=0, verbose_name='Gekoppeld aan chauffeur')
    niet_gekoppeld = models.PositiveIntegerField(default=0, verbose_name='Niet gekoppeld')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Import Batch'
        verbose_name_plural = 'Import Batches'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.bestandsnaam} ({self.created_at:%Y-%m-%d %H:%M})"


class ImportedTimeEntry(models.Model):
    """Geïmporteerde urenregel uit een Excel bestand (planbureau)."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        ImportBatch,
        on_delete=models.CASCADE,
        related_name='entries',
        verbose_name='Import Batch'
    )
    # Koppeling aan chauffeur via kenteken/ritnummer → voertuig → driver → user
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='imported_time_entries',
        verbose_name='Gekoppelde gebruiker'
    )

    # Originele Excel data
    weeknummer = models.PositiveIntegerField(verbose_name='Weeknummer')
    periode = models.CharField(max_length=50, blank=True, default='', verbose_name='Periode')
    datum = models.DateField(verbose_name='Datum')
    ritlijst = models.CharField(max_length=100, blank=True, default='', verbose_name='Ritlijst')
    kenteken_import = models.CharField(max_length=50, verbose_name='Kenteken (import)')
    km = models.DecimalField(max_digits=10, decimal_places=1, default=0, verbose_name='KM')
    uurtarief = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='Uurtarief')
    dot = models.CharField(max_length=50, blank=True, default='', verbose_name='DOT')

    geplande_vertrektijd = models.TimeField(null=True, blank=True, verbose_name='Geplande vertrektijd')
    ingelogd_bc = models.TimeField(null=True, blank=True, verbose_name='Ingelogd BC')
    begintijd_rit = models.TimeField(null=True, blank=True, verbose_name='Begintijd rit')
    eindtijd_rit = models.TimeField(null=True, blank=True, verbose_name='Eindtijd rit')

    uren = models.DecimalField(max_digits=6, decimal_places=2, default=0, verbose_name='Uren')
    pauze = models.DurationField(default=timedelta(minutes=0), verbose_name='Pauze')
    netto_uren = models.DecimalField(max_digits=6, decimal_places=2, default=0, verbose_name='Netto uren')
    uren_factuur = models.DecimalField(max_digits=6, decimal_places=2, default=0, verbose_name='Uren factuur')
    factuur_bedrag = models.DecimalField(max_digits=10, decimal_places=2, default=0, verbose_name='Factuur bedrag')

    # Gekoppelde voertuig info (voor referentie)
    gekoppeld_voertuig = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='imported_entries',
        verbose_name='Gekoppeld voertuig'
    )

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Geïmporteerde urenregel'
        verbose_name_plural = 'Geïmporteerde urenregels'
        ordering = ['-datum', 'kenteken_import']

    def __str__(self):
        return f"{self.kenteken_import} - {self.datum} - {self.uren_factuur}u"

"""Timetracking models - To be fully implemented in Fase 3."""
import uuid
from datetime import timedelta
from django.db import models
from django.conf import settings


class TimeEntryStatus(models.TextChoices):
    CONCEPT = 'concept', 'Concept'
    INGEDIEND = 'ingediend', 'Ingediend'


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

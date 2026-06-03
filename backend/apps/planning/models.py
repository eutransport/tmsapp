"""Planning models met historie-preservatie via snapshot velden.

Snapshot-pattern: bij aanmaken van een entry (of toewijzen van een chauffeur)
worden de relevante velden van Vehicle/Driver/Company gekopieerd naar de entry.
Latere wijzigingen aan die gerelateerde objecten beinvloeden de historie niet.
"""
import uuid
from django.db import models


class Weekday(models.TextChoices):
    MAANDAG = 'ma', 'Maandag'
    DINSDAG = 'di', 'Dinsdag'
    WOENSDAG = 'wo', 'Woensdag'
    DONDERDAG = 'do', 'Donderdag'
    VRIJDAG = 'vr', 'Vrijdag'


class WeekPlanning(models.Model):
    """Weekplanning header."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='plannings',
        verbose_name='Bedrijf'
    )
    # Snapshot zodat historie blijft bestaan als bedrijfsnaam wijzigt of bedrijf wordt verwijderd
    bedrijf_naam = models.CharField(max_length=200, blank=True, verbose_name='Bedrijfsnaam (snapshot)')

    weeknummer = models.PositiveIntegerField(verbose_name='Weeknummer')
    jaar = models.PositiveIntegerField(verbose_name='Jaar')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Weekplanning'
        verbose_name_plural = 'Weekplanningen'
        unique_together = ['bedrijf', 'weeknummer', 'jaar']
        ordering = ['-jaar', '-weeknummer']

    def __str__(self):
        naam = self.bedrijf_naam or (self.bedrijf.naam if self.bedrijf else '?')
        return f"{naam} - Week {self.weeknummer}/{self.jaar}"

    def save(self, *args, **kwargs):
        # Vul bedrijfsnaam-snapshot eenmalig bij aanmaken
        if not self.bedrijf_naam and self.bedrijf_id:
            try:
                self.bedrijf_naam = self.bedrijf.naam
            except Exception:
                pass
        super().save(*args, **kwargs)


class PlanningEntry(models.Model):
    """Individuele planningsregel met historische snapshots van voertuig en chauffeur."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    planning = models.ForeignKey(
        WeekPlanning,
        on_delete=models.CASCADE,
        related_name='entries',
        verbose_name='Planning'
    )
    # SET_NULL zodat verwijderen van een voertuig de historische planning niet weggooit
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='planning_entries',
        verbose_name='Voertuig'
    )
    dag = models.CharField(
        max_length=2,
        choices=Weekday.choices,
        verbose_name='Dag'
    )
    chauffeur = models.ForeignKey(
        'drivers.Driver',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='planning_entries',
        verbose_name='Chauffeur'
    )

    # Per-dag ritnummer override (bestaand veld, los van vehicle snapshot)
    ritnummer = models.CharField(max_length=50, blank=True, verbose_name='Ritnummer (override)')

    # === SNAPSHOTS - eenmalig vastgelegd, niet meer beinvloed door latere wijzigingen ===
    vehicle_kenteken = models.CharField(max_length=20, blank=True, verbose_name='Kenteken (snapshot)')
    vehicle_type_wagen = models.CharField(max_length=100, blank=True, verbose_name='Type wagen (snapshot)')
    vehicle_ritnummer = models.CharField(max_length=50, blank=True, verbose_name='Voertuig ritnummer (snapshot)')
    chauffeur_naam = models.CharField(max_length=200, blank=True, verbose_name='Chauffeursnaam (snapshot)')
    telefoon = models.CharField(max_length=20, blank=True, verbose_name='Telefoon (snapshot)')
    adr = models.BooleanField(default=False, verbose_name='ADR (snapshot)')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Planningsregel'
        verbose_name_plural = 'Planningsregels'
        ordering = ['vehicle_ritnummer', 'dag']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Track originele chauffeur om wijzigingen te detecteren in save()
        self._original_chauffeur_id = self.chauffeur_id

    def __str__(self):
        kenteken = self.vehicle_kenteken or (self.vehicle.kenteken if self.vehicle else '?')
        return f"{kenteken} - {self.get_dag_display()}"

    def save(self, *args, **kwargs):
        is_new = self._state.adding

        # Vehicle-snapshot eenmalig vastleggen bij aanmaken
        if is_new and self.vehicle_id:
            try:
                veh = self.vehicle
                if not self.vehicle_kenteken:
                    self.vehicle_kenteken = veh.kenteken
                if not self.vehicle_type_wagen:
                    self.vehicle_type_wagen = veh.type_wagen
                if not self.vehicle_ritnummer:
                    self.vehicle_ritnummer = veh.ritnummer
            except Exception:
                pass

        # Chauffeur-snapshot bijwerken alleen wanneer chauffeur wijzigt
        if is_new:
            chauffeur_changed = self.chauffeur_id is not None
        else:
            chauffeur_changed = getattr(self, '_original_chauffeur_id', None) != self.chauffeur_id

        if chauffeur_changed:
            if self.chauffeur_id:
                try:
                    drv = self.chauffeur
                    self.chauffeur_naam = drv.naam
                    self.telefoon = drv.telefoon or ''
                    self.adr = bool(drv.adr)
                except Exception:
                    pass
            else:
                # Bewust losgekoppeld: snapshot leegmaken
                self.chauffeur_naam = ''
                self.telefoon = ''
                self.adr = False

        super().save(*args, **kwargs)
        self._original_chauffeur_id = self.chauffeur_id

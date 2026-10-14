"""
Fleet Maintenance Management Models

Uitgebreid onderhoudssysteem voor vlootbeheer met ondersteuning voor:
- Onderhoudscategorieën en -types (APK, oliewissel, banden, remmen, etc.)
- Geplande en uitgevoerde onderhoudstaken
- Kostenbeheer en -analyse
- APK countdown en cyclusbeheer
- Dashboard widgets en query systeem
- Threshold waarschuwingen
- OBD connector voorbereiding
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


# =============================================================================
# ONDERHOUDSCATEGORIEËN & TYPES
# =============================================================================

class MaintenanceCategory(models.Model):
    """
    Categorieën voor onderhoud, bijv. Motor, Banden, Carrosserie, Elektra, etc.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, verbose_name='Naam')
    name_en = models.CharField(max_length=100, blank=True, verbose_name='Naam (Engels)')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    icon = models.CharField(max_length=50, blank=True, verbose_name='Icon naam',
                            help_text='Heroicons naam, bijv. WrenchScrewdriverIcon')
    color = models.CharField(max_length=7, default='#3B82F6', verbose_name='Kleur',
                             help_text='Hex kleurcode voor dashboard')
    sort_order = models.IntegerField(default=0, verbose_name='Sorteervolgorde')
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Onderhoudscategorie'
        verbose_name_plural = 'Onderhoudscategorieën'
        ordering = ['sort_order', 'name']

    def __str__(self):
        return self.name


class VehicleType(models.TextChoices):
    """Voertuigtype voor onderhoudstypes"""
    ALL = 'all', 'Alle voertuigen'
    TRUCK = 'truck', 'Trekker'
    MOTORWAGEN = 'motorwagen', 'Motorwagen'
    CAR = 'car', 'Auto'
    TRAILER = 'trailer', 'Trailer/Oplegger'
    VAN = 'van', 'Bestelbus'


class MaintenanceType(models.Model):
    """
    Specifiek type onderhoud, bijv. APK, Oliewissel, Bandenwissel, Remblokken, etc.
    Elk type kan een standaard interval hebben (in km of dagen).
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    category = models.ForeignKey(
        MaintenanceCategory,
        on_delete=models.CASCADE,
        related_name='maintenance_types',
        verbose_name='Categorie'
    )
    name = models.CharField(max_length=150, verbose_name='Naam')
    name_en = models.CharField(max_length=150, blank=True, verbose_name='Naam (Engels)')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    
    # Standaard intervallen
    default_interval_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Standaard interval (km)',
        help_text='Na hoeveel km dit onderhoud standaard uitgevoerd moet worden'
    )
    default_interval_days = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Standaard interval (dagen)',
        help_text='Na hoeveel dagen dit onderhoud standaard uitgevoerd moet worden'
    )
    
    # Voor welk type voertuig is dit relevant
    vehicle_type = models.CharField(
        max_length=20,
        choices=VehicleType.choices,
        default=VehicleType.ALL,
        verbose_name='Voertuigtype'
    )
    
    # Is dit wettelijk verplicht (zoals APK)?
    is_mandatory = models.BooleanField(default=False, verbose_name='Wettelijk verplicht')
    
    # Geschatte kosten
    estimated_cost = models.DecimalField(
        max_digits=10, decimal_places=2,
        null=True, blank=True,
        verbose_name='Geschatte kosten (€)'
    )
    
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    sort_order = models.IntegerField(default=0, verbose_name='Sorteervolgorde')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Onderhoudstype'
        verbose_name_plural = 'Onderhoudstypes'
        ordering = ['category__sort_order', 'sort_order', 'name']

    def __str__(self):
        return f"{self.category.name} - {self.name}"


# =============================================================================
# VOERTUIG ONDERHOUDSCONFIGURATIE
# =============================================================================

class VehicleMaintenanceProfile(models.Model):
    """
    Onderhoudsprofiel per voertuig.
    Hiermee kan per voertuig afwijkende intervallen worden ingesteld.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='maintenance_profiles',
        verbose_name='Voertuig'
    )
    maintenance_type = models.ForeignKey(
        MaintenanceType,
        on_delete=models.CASCADE,
        related_name='vehicle_profiles',
        verbose_name='Onderhoudstype'
    )
    
    # Aangepaste intervallen (overschrijft defaults van MaintenanceType)
    custom_interval_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Aangepast interval (km)'
    )
    custom_interval_days = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Aangepast interval (dagen)'
    )
    
    # Stalen voor tracking
    last_performed_date = models.DateField(
        null=True, blank=True,
        verbose_name='Laatst uitgevoerd op'
    )
    last_performed_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Laatst uitgevoerd bij (km)'
    )
    next_due_date = models.DateField(
        null=True, blank=True,
        verbose_name='Volgende uitvoering (datum)'
    )
    next_due_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Volgende uitvoering (km)'
    )
    
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    notes = models.TextField(blank=True, verbose_name='Opmerkingen')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Voertuig onderhoudsprofiel'
        verbose_name_plural = 'Voertuig onderhoudsprofielen'
        unique_together = ['vehicle', 'maintenance_type']
        ordering = ['vehicle__kenteken', 'maintenance_type__name']

    def __str__(self):
        return f"{self.vehicle.kenteken} - {self.maintenance_type.name}"

    @property
    def interval_km(self):
        """Geeft aangepast of standaard km-interval terug."""
        return self.custom_interval_km or self.maintenance_type.default_interval_km

    @property
    def interval_days(self):
        """Geeft aangepast of standaard dagen-interval terug."""
        return self.custom_interval_days or self.maintenance_type.default_interval_days

    @property
    def days_until_due(self):
        """Aantal dagen tot volgende onderhoud."""
        if self.next_due_date:
            delta = self.next_due_date - date.today()
            return delta.days
        return None

    @property
    def is_overdue(self):
        """Is het onderhoud over de datum?"""
        if self.next_due_date:
            return self.next_due_date < date.today()
        return False

    @property
    def status(self):
        """Status van het onderhoudsprofiel: ok, warning, critical, overdue."""
        days = self.days_until_due
        if days is None:
            return 'unknown'
        if days < 0:
            return 'overdue'
        if days <= 14:
            return 'critical'
        if days <= 30:
            return 'warning'
        return 'ok'

    def calculate_next_due(self, performed_date=None, performed_km=None):
        """Bereken volgende onderhoudsdatum op basis van interval."""
        if performed_date:
            self.last_performed_date = performed_date
        if performed_km:
            self.last_performed_km = performed_km

        if self.last_performed_date and self.interval_days:
            self.next_due_date = self.last_performed_date + timedelta(days=self.interval_days)

        if self.last_performed_km and self.interval_km:
            self.next_due_km = self.last_performed_km + self.interval_km


# =============================================================================
# APK BEHEER
# =============================================================================

class APKStatus(models.TextChoices):
    VALID = 'valid', 'Geldig'
    EXPIRED = 'expired', 'Verlopen'
    PENDING = 'pending', 'In afwachting'
    FAILED = 'failed', 'Afgekeurd'


class APKRecord(models.Model):
    """
    APK records per voertuig met countdown functionaliteit.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='apk_records',
        verbose_name='Voertuig'
    )
    
    # APK datums
    inspection_date = models.DateField(
        verbose_name='APK keuringsdatum',
        help_text='Datum waarop de APK is uitgevoerd'
    )
    expiry_date = models.DateField(
        verbose_name='APK vervaldatum',
        help_text='Datum waarop de huidige APK verloopt'
    )
    
    # Resultaat
    status = models.CharField(
        max_length=20,
        choices=APKStatus.choices,
        default=APKStatus.VALID,
        verbose_name='Status'
    )
    passed = models.BooleanField(default=True, verbose_name='Goedgekeurd')
    
    # Details keuringsstation
    inspection_station = models.CharField(
        max_length=200, blank=True,
        verbose_name='Keuringsstation'
    )
    inspector_name = models.CharField(
        max_length=100, blank=True,
        verbose_name='Keurmeester'
    )
    
    # Kilometerstand bij keuring
    mileage_at_inspection = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Kilometerstand'
    )
    
    # Kosten
    cost = models.DecimalField(
        max_digits=10, decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Kosten (€)'
    )
    
    # Opmerkingen en gebreken
    remarks = models.TextField(blank=True, verbose_name='Opmerkingen')
    defects = models.TextField(blank=True, verbose_name='Gebreken',
                               help_text='Gevonden gebreken bij de keuring')
    
    # Document upload
    certificate_file = models.FileField(
        upload_to='maintenance/apk/',
        blank=True, null=True,
        verbose_name='APK certificaat'
    )
    
    is_current = models.BooleanField(
        default=True,
        verbose_name='Huidige APK',
        help_text='Is dit de meest recente APK voor dit voertuig?'
    )

    notify_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='apk_notifications',
        verbose_name='Notificatie naar'
    )
    notify_extra_emails = models.JSONField(
        default=list, blank=True,
        verbose_name='Extra e-mailadressen',
        help_text='Losse adressen die naast de gekozen gebruikers een herinnering krijgen.'
    )
    last_reminder_sent_on = models.DateField(
        null=True, blank=True,
        verbose_name='Laatste herinnering',
        help_text='Datum waarop voor het laatst een herinnering is verstuurd.'
    )
    
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='created_apk_records',
        verbose_name='Aangemaakt door'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'APK Record'
        verbose_name_plural = 'APK Records'
        ordering = ['-inspection_date']

    def __str__(self):
        return f"APK {self.vehicle.kenteken} - {self.inspection_date}"

    @property
    def days_until_expiry(self):
        """Aantal dagen tot APK verloopt."""
        if self.expiry_date:
            delta = self.expiry_date - date.today()
            return delta.days
        return None

    @property
    def is_expired(self):
        """Is de APK verlopen?"""
        if self.expiry_date:
            return self.expiry_date < date.today()
        return False

    @property
    def countdown_status(self):
        """Status voor countdown weergave: ok, warning, critical, expired."""
        days = self.days_until_expiry
        if days is None:
            return 'unknown'
        if days < 0:
            return 'expired'
        if days <= 14:
            return 'critical'
        if days <= 30:
            return 'warning'
        return 'ok'

    def save(self, *args, **kwargs):
        """Bij opslaan: als is_current=True, zet andere records van dit voertuig op False."""
        if self.is_current:
            APKRecord.objects.filter(
                vehicle=self.vehicle,
                is_current=True
            ).exclude(pk=self.pk).update(is_current=False)
            
            # Update status
            if self.is_expired:
                self.status = APKStatus.EXPIRED
            elif self.passed:
                self.status = APKStatus.VALID
            else:
                self.status = APKStatus.FAILED
        
        super().save(*args, **kwargs)


class APKSettings(models.Model):
    """Instellingen voor de APK-herinneringen (singleton).

    Werkt hetzelfde als de ADR- en brandblusserinstellingen, zodat de drie
    onderdelen van het onderhoudsmodule zich op dezelfde manier gedragen.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email_profile = models.ForeignKey(
        'core.EmailProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='apk_settings',
        verbose_name='Verzend-account',
        help_text='Leeg = de algemene SMTP-instellingen gebruiken.'
    )
    send_hour = models.PositiveSmallIntegerField(
        default=6,
        validators=[MinValueValidator(0), MaxValueValidator(23)],
        verbose_name='Verzenduur'
    )
    send_minute = models.PositiveSmallIntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(59)],
        verbose_name='Verzendminuut'
    )
    default_notify_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='apk_default_notifications',
        verbose_name='Standaard ontvangers'
    )
    default_notify_extra_emails = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Standaard extra e-mailadressen'
    )
    last_run_on = models.DateField(null=True, blank=True, verbose_name='Laatste run op')
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_apk_settings'
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'APK Instellingen'
        verbose_name_plural = 'APK Instellingen'

    def __str__(self):
        return f"APK instellingen ({self.send_hour:02d}:{self.send_minute:02d})"

    @classmethod
    def get_settings(cls):
        """Haal de instellingen op en maak ze aan als ze nog niet bestaan."""
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj


# =============================================================================
# ADR
# =============================================================================

class ADRRecord(models.Model):
    """
    ADR-controle per voertuig: is er ADR aanwezig, is de ADR-koffer verzegeld
    en wanneer moet de volgende controle plaatsvinden.

    Vanaf twee weken voor de volgende controle gaat er een herinnering uit naar
    de gekozen ontvangers; in de laatste week (en daarna) elke dag opnieuw,
    totdat de controledatum is bijgewerkt.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='adr_records',
        verbose_name='Voertuig'
    )
    route = models.CharField(
        max_length=50, blank=True,
        verbose_name='Route',
        help_text='Ritnummer/route van het voertuig. Leeg = automatisch van de wagen overnemen.'
    )

    has_adr = models.BooleanField(default=True, verbose_name='ADR')
    case_sealed = models.BooleanField(default=False, verbose_name='ADR koffer verzegeld')

    inspection_date = models.DateField(verbose_name='Controle uitgevoerd op')
    next_inspection_date = models.DateField(verbose_name='Volgende controle op')

    notify_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='adr_notifications',
        verbose_name='Notificatie naar'
    )
    notify_extra_emails = models.JSONField(
        default=list, blank=True,
        verbose_name='Extra e-mailadressen',
        help_text='Losse adressen die naast de gekozen gebruikers een herinnering krijgen.'
    )

    remarks = models.TextField(blank=True, verbose_name='Opmerkingen')

    last_reminder_sent_on = models.DateField(
        null=True, blank=True,
        verbose_name='Laatste herinnering',
        help_text='Datum waarop voor het laatst een herinnering is verstuurd.'
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='created_adr_records',
        verbose_name='Aangemaakt door'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'ADR Controle'
        verbose_name_plural = 'ADR Controles'
        ordering = ['next_inspection_date']
        indexes = [
            models.Index(fields=['next_inspection_date']),
        ]

    def __str__(self):
        return f"ADR {self.vehicle.kenteken} - {self.next_inspection_date}"

    @property
    def days_remaining(self):
        """Aantal dagen tot de volgende controle (negatief = te laat)."""
        if self.next_inspection_date:
            return (self.next_inspection_date - date.today()).days
        return None

    @property
    def is_expired(self):
        """Is de controledatum verstreken?"""
        if self.next_inspection_date:
            return self.next_inspection_date < date.today()
        return False

    @property
    def countdown_status(self):
        """Status voor de kleurcodering: ok, warning, critical, expired."""
        days = self.days_remaining
        if days is None:
            return 'unknown'
        if days < 0:
            return 'expired'
        if days <= 7:
            return 'critical'
        if days <= 14:
            return 'warning'
        return 'ok'

    def save(self, *args, **kwargs):
        # Route overnemen van de wagen zolang er niets is ingevuld.
        if not self.route and self.vehicle_id:
            self.route = self.vehicle.ritnummer or ''
        super().save(*args, **kwargs)


class ADRSettings(models.Model):
    """Instellingen voor de ADR-herinneringen (singleton)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email_profile = models.ForeignKey(
        'core.EmailProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='adr_settings',
        verbose_name='Verzend-account',
        help_text='Leeg = de algemene SMTP-instellingen gebruiken.'
    )
    send_hour = models.PositiveSmallIntegerField(
        default=6,
        validators=[MinValueValidator(0), MaxValueValidator(23)],
        verbose_name='Verzenduur'
    )
    send_minute = models.PositiveSmallIntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(59)],
        verbose_name='Verzendminuut'
    )
    default_notify_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='adr_default_notifications',
        verbose_name='Standaard ontvangers'
    )
    default_notify_extra_emails = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Standaard extra e-mailadressen'
    )
    last_run_on = models.DateField(null=True, blank=True, verbose_name='Laatste run op')
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_adr_settings'
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'ADR Instellingen'
        verbose_name_plural = 'ADR Instellingen'

    def __str__(self):
        return f"ADR instellingen ({self.send_hour:02d}:{self.send_minute:02d})"

    @classmethod
    def get_settings(cls):
        """Haal de instellingen op en maak ze aan als ze nog niet bestaan."""
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj


# =============================================================================
# BRANDBLUSSERS
# =============================================================================

class FireExtinguisherRecord(models.Model):
    """Eén brandblusser met een eigen vervaldatum.

    Een wagen heeft er vaak meer dan één. Elke blusser krijgt daarom een eigen
    regel met een eigen keurings- en vervaldatum, zodat er per blusser geteld
    en herinnerd wordt. Bij het aanmaken kun je in één keer meerdere blussers
    voor dezelfde wagen opvoeren; dat levert net zoveel regels op.

    Vanaf twee weken voor de vervaldatum gaat er een herinnering uit naar de
    gekozen ontvangers; in de laatste week (en daarna) elke dag opnieuw, totdat
    de vervaldatum is bijgewerkt.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='fire_extinguishers',
        verbose_name='Voertuig'
    )
    route = models.CharField(
        max_length=50, blank=True,
        verbose_name='Route',
        help_text='Ritnummer/route van het voertuig. Leeg = automatisch van de wagen overnemen.'
    )

    volgnummer = models.PositiveSmallIntegerField(
        default=1,
        validators=[MinValueValidator(1), MaxValueValidator(50)],
        verbose_name='Blusser nr.',
        help_text='Volgnummer van deze blusser op de wagen.'
    )
    positie = models.CharField(
        max_length=100, blank=True,
        verbose_name='Plaats op de wagen',
        help_text='Bijvoorbeeld cabine, chassis links of achterzijde.'
    )
    serienummer = models.CharField(
        max_length=64, blank=True,
        verbose_name='Serienummer'
    )

    inspection_date = models.DateField(verbose_name='Gekeurd op')
    next_inspection_date = models.DateField(verbose_name='Vervaldatum')

    notify_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='fire_extinguisher_notifications',
        verbose_name='Notificatie naar'
    )
    notify_extra_emails = models.JSONField(
        default=list, blank=True,
        verbose_name='Extra e-mailadressen',
        help_text='Losse adressen die naast de gekozen gebruikers een herinnering krijgen.'
    )

    remarks = models.TextField(blank=True, verbose_name='Opmerkingen')

    last_reminder_sent_on = models.DateField(
        null=True, blank=True,
        verbose_name='Laatste herinnering',
        help_text='Datum waarop voor het laatst een herinnering is verstuurd.'
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='created_fire_extinguishers',
        verbose_name='Aangemaakt door'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Brandblusser'
        verbose_name_plural = 'Brandblussers'
        ordering = ['next_inspection_date', 'vehicle__kenteken', 'volgnummer']
        indexes = [
            models.Index(fields=['next_inspection_date']),
            models.Index(fields=['vehicle', 'volgnummer']),
        ]

    def __str__(self):
        return f"Brandblusser {self.volgnummer} {self.vehicle.kenteken} - {self.next_inspection_date}"

    @property
    def days_remaining(self):
        """Aantal dagen tot de vervaldatum (negatief = te laat)."""
        if self.next_inspection_date:
            return (self.next_inspection_date - date.today()).days
        return None

    @property
    def is_expired(self):
        """Is de vervaldatum verstreken?"""
        if self.next_inspection_date:
            return self.next_inspection_date < date.today()
        return False

    @property
    def countdown_status(self):
        """Status voor de kleurcodering: ok, warning, critical, expired."""
        days = self.days_remaining
        if days is None:
            return 'unknown'
        if days < 0:
            return 'expired'
        if days <= 7:
            return 'critical'
        if days <= 14:
            return 'warning'
        return 'ok'

    def save(self, *args, **kwargs):
        # Route overnemen van de wagen zolang er niets is ingevuld.
        if not self.route and self.vehicle_id:
            self.route = self.vehicle.ritnummer or ''
        super().save(*args, **kwargs)


class FireExtinguisherSettings(models.Model):
    """Instellingen voor de brandblusser-herinneringen (singleton)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email_profile = models.ForeignKey(
        'core.EmailProfile',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='fire_extinguisher_settings',
        verbose_name='Verzend-account',
        help_text='Leeg = de algemene SMTP-instellingen gebruiken.'
    )
    send_hour = models.PositiveSmallIntegerField(
        default=6,
        validators=[MinValueValidator(0), MaxValueValidator(23)],
        verbose_name='Verzenduur'
    )
    send_minute = models.PositiveSmallIntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(59)],
        verbose_name='Verzendminuut'
    )
    default_notify_users = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name='fire_extinguisher_default_notifications',
        verbose_name='Standaard ontvangers'
    )
    default_notify_extra_emails = models.JSONField(
        default=list,
        blank=True,
        verbose_name='Standaard extra e-mailadressen'
    )
    last_run_on = models.DateField(null=True, blank=True, verbose_name='Laatste run op')
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='updated_fire_extinguisher_settings'
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Brandblusser Instellingen'
        verbose_name_plural = 'Brandblusser Instellingen'

    def __str__(self):
        return f"Brandblusser instellingen ({self.send_hour:02d}:{self.send_minute:02d})"

    @classmethod
    def get_settings(cls):
        """Haal de instellingen op en maak ze aan als ze nog niet bestaan."""
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj


# =============================================================================
# ONDERHOUDSTAKEN (WORK ORDERS)
# =============================================================================

class MaintenanceStatus(models.TextChoices):
    SCHEDULED = 'scheduled', 'Gepland'
    IN_PROGRESS = 'in_progress', 'In uitvoering'
    COMPLETED = 'completed', 'Afgerond'
    CANCELLED = 'cancelled', 'Geannuleerd'
    OVERDUE = 'overdue', 'Te laat'


class MaintenancePriority(models.TextChoices):
    LOW = 'low', 'Laag'
    NORMAL = 'normal', 'Normaal'
    HIGH = 'high', 'Hoog'
    URGENT = 'urgent', 'Urgent'


class MaintenanceTask(models.Model):
    """
    Een specifieke onderhoudstaak / werkorder.
    Dit is de kern van het onderhoudssysteem.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    
    # Relaties
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='maintenance_tasks',
        verbose_name='Voertuig'
    )
    maintenance_type = models.ForeignKey(
        MaintenanceType,
        on_delete=models.CASCADE,
        related_name='tasks',
        verbose_name='Onderhoudstype'
    )
    
    # Status en prioriteit
    status = models.CharField(
        max_length=20,
        choices=MaintenanceStatus.choices,
        default=MaintenanceStatus.SCHEDULED,
        verbose_name='Status'
    )
    priority = models.CharField(
        max_length=10,
        choices=MaintenancePriority.choices,
        default=MaintenancePriority.NORMAL,
        verbose_name='Prioriteit'
    )
    
    # Planning
    title = models.CharField(max_length=200, verbose_name='Titel')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    scheduled_date = models.DateField(verbose_name='Geplande datum')
    completed_date = models.DateField(null=True, blank=True, verbose_name='Voltooide datum')
    
    # Kilometerstand
    mileage_at_service = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Kilometerstand bij onderhoud'
    )
    
    # Garage / werkplaats
    service_provider = models.CharField(
        max_length=200, blank=True,
        verbose_name='Werkplaats / Garage'
    )
    service_provider_contact = models.CharField(
        max_length=200, blank=True,
        verbose_name='Contact werkplaats'
    )
    
    # Kosten
    labor_cost = models.DecimalField(
        max_digits=10, decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Arbeidskosten (€)'
    )
    parts_cost = models.DecimalField(
        max_digits=10, decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Onderdelenkosten (€)'
    )
    total_cost = models.DecimalField(
        max_digits=10, decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Totale kosten (€)'
    )
    
    # Factuur
    invoice_number = models.CharField(max_length=100, blank=True, verbose_name='Factuurnummer')
    invoice_file = models.FileField(
        upload_to='maintenance/invoices/',
        blank=True, null=True,
        verbose_name='Factuur bestand'
    )
    
    # Opmerkingen en verslag
    work_performed = models.TextField(blank=True, verbose_name='Uitgevoerd werk')
    parts_replaced = models.TextField(blank=True, verbose_name='Vervangen onderdelen')
    technician_notes = models.TextField(blank=True, verbose_name='Monteur opmerkingen')
    
    # Wie
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='assigned_maintenance_tasks',
        verbose_name='Toegewezen aan'
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='created_maintenance_tasks',
        verbose_name='Aangemaakt door'
    )
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='completed_maintenance_tasks',
        verbose_name='Afgerond door'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Onderhoudstaak'
        verbose_name_plural = 'Onderhoudstaken'
        ordering = ['-scheduled_date']
        indexes = [
            models.Index(fields=['vehicle', 'status']),
            models.Index(fields=['scheduled_date']),
            models.Index(fields=['maintenance_type', 'vehicle']),
        ]

    def __str__(self):
        return f"{self.title} - {self.vehicle.kenteken}"

    def save(self, *args, **kwargs):
        """Auto-bereken totale kosten."""
        self.total_cost = self.labor_cost + self.parts_cost
        
        # Auto-titel als leeg
        if not self.title:
            self.title = f"{self.maintenance_type.name} - {self.vehicle.kenteken}"
        
        super().save(*args, **kwargs)

    @property
    def is_overdue(self):
        """Is de taak over de datum en nog niet afgerond?"""
        if self.status in [MaintenanceStatus.COMPLETED, MaintenanceStatus.CANCELLED]:
            return False
        return self.scheduled_date < date.today()


# =============================================================================
# ONDERDELEN REGISTRATIE
# =============================================================================

class MaintenancePart(models.Model):
    """Onderdelen gebruikt bij een onderhoudstaak."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(
        MaintenanceTask,
        on_delete=models.CASCADE,
        related_name='parts',
        verbose_name='Onderhoudstaak'
    )
    name = models.CharField(max_length=200, verbose_name='Onderdeelnaam')
    part_number = models.CharField(max_length=100, blank=True, verbose_name='Onderdeelnummer')
    quantity = models.PositiveIntegerField(default=1, verbose_name='Aantal')
    unit_price = models.DecimalField(
        max_digits=10, decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Stukprijs (€)'
    )
    total_price = models.DecimalField(
        max_digits=10, decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Totaalprijs (€)'
    )
    supplier = models.CharField(max_length=200, blank=True, verbose_name='Leverancier')
    warranty_months = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Garantie (maanden)'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Onderdeel'
        verbose_name_plural = 'Onderdelen'

    def __str__(self):
        return f"{self.name} ({self.quantity}x)"

    def save(self, *args, **kwargs):
        self.total_price = self.unit_price * self.quantity
        super().save(*args, **kwargs)


# =============================================================================
# BANDENREGISTRATIE
# =============================================================================

class TirePosition(models.TextChoices):
    FRONT_LEFT = 'front_left', 'Linksvoor'
    FRONT_RIGHT = 'front_right', 'Rechtsvoor'
    REAR_LEFT_OUTER = 'rear_left_outer', 'Linksachter buitenband'
    REAR_LEFT_INNER = 'rear_left_inner', 'Linksachter binnenband'
    REAR_RIGHT_OUTER = 'rear_right_outer', 'Rechtsachter buitenband'
    REAR_RIGHT_INNER = 'rear_right_inner', 'Rechtsachter binnenband'
    SPARE = 'spare', 'Reserveband'
    # Trekker extra assen
    DRIVE_LEFT_OUTER = 'drive_left_outer', 'Aandrijfas links buiten'
    DRIVE_LEFT_INNER = 'drive_left_inner', 'Aandrijfas links binnen'
    DRIVE_RIGHT_OUTER = 'drive_right_outer', 'Aandrijfas rechts buiten'
    DRIVE_RIGHT_INNER = 'drive_right_inner', 'Aandrijfas rechts binnen'
    # Trailer assen
    TRAILER_1_LEFT = 'trailer_1_left', 'Trailer as 1 links'
    TRAILER_1_RIGHT = 'trailer_1_right', 'Trailer as 1 rechts'
    TRAILER_2_LEFT = 'trailer_2_left', 'Trailer as 2 links'
    TRAILER_2_RIGHT = 'trailer_2_right', 'Trailer as 2 rechts'
    TRAILER_3_LEFT = 'trailer_3_left', 'Trailer as 3 links'
    TRAILER_3_RIGHT = 'trailer_3_right', 'Trailer as 3 rechts'


class TireType(models.TextChoices):
    SUMMER = 'summer', 'Zomerband'
    WINTER = 'winter', 'Winterband'
    ALL_SEASON = 'all_season', 'All-season'
    RETREADED = 'retreaded', 'Gecoverd'


class TireRecord(models.Model):
    """
    Bandenregistratie per voertuig.
    Bijhouden welke banden gemonteerd zijn, profieldiepte, etc.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='tire_records',
        verbose_name='Voertuig'
    )
    
    # Band informatie
    position = models.CharField(
        max_length=30,
        choices=TirePosition.choices,
        verbose_name='Positie'
    )
    brand = models.CharField(max_length=100, verbose_name='Merk')
    model = models.CharField(max_length=100, blank=True, verbose_name='Model')
    size = models.CharField(max_length=50, verbose_name='Maat',
                            help_text='Bijv. 315/80R22.5')
    tire_type = models.CharField(
        max_length=20,
        choices=TireType.choices,
        default=TireType.ALL_SEASON,
        verbose_name='Type band'
    )
    dot_code = models.CharField(max_length=20, blank=True, verbose_name='DOT code',
                                 help_text='Productiedatum code')
    serial_number = models.CharField(max_length=50, blank=True, verbose_name='Serienummer')
    
    # Status
    tread_depth_mm = models.DecimalField(
        max_digits=4, decimal_places=1,
        null=True, blank=True,
        verbose_name='Profieldiepte (mm)',
        help_text='Minimaal 1.6mm wettelijk vereist'
    )
    minimum_tread_depth = models.DecimalField(
        max_digits=4, decimal_places=1,
        default=Decimal('1.6'),
        verbose_name='Minimum profieldiepte (mm)'
    )
    
    # Montage
    mounted_date = models.DateField(verbose_name='Gemonteerd op')
    mounted_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Gemonteerd bij (km)'
    )
    expected_replacement_date = models.DateField(
        null=True, blank=True,
        verbose_name='Verwachte vervanging'
    )
    
    # Demontage
    removed_date = models.DateField(null=True, blank=True, verbose_name='Gedemonteerd op')
    removed_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Gedemonteerd bij (km)'
    )
    removal_reason = models.CharField(max_length=200, blank=True, verbose_name='Reden demontage')
    
    # Kosten
    purchase_cost = models.DecimalField(
        max_digits=10, decimal_places=2,
        default=Decimal('0.00'),
        verbose_name='Aanschafkosten (€)'
    )
    
    is_current = models.BooleanField(default=True, verbose_name='Huidige band')
    notes = models.TextField(blank=True, verbose_name='Opmerkingen')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Bandenrecord'
        verbose_name_plural = 'Bandenrecords'
        ordering = ['vehicle__kenteken', 'position']

    def __str__(self):
        return f"{self.vehicle.kenteken} - {self.get_position_display()} - {self.brand} {self.size}"

    @property
    def days_until_replacement(self):
        """Dagen tot verwachte vervanging."""
        if self.expected_replacement_date:
            delta = self.expected_replacement_date - date.today()
            return delta.days
        return None

    @property
    def km_driven(self):
        """Aantal gereden km op deze band."""
        if self.mounted_km and self.removed_km:
            return self.removed_km - self.mounted_km
        return None

    def extend_replacement(self, new_date):
        """Verleng de verwachte vervangingsdatum."""
        self.expected_replacement_date = new_date
        self.save(update_fields=['expected_replacement_date', 'updated_at'])


# =============================================================================
# ONDERHOUD THRESHOLDS & WAARSCHUWINGEN
# =============================================================================

class AlertSeverity(models.TextChoices):
    INFO = 'info', 'Informatie'
    WARNING = 'warning', 'Waarschuwing'
    CRITICAL = 'critical', 'Kritiek'
    URGENT = 'urgent', 'Urgent'


class MaintenanceThreshold(models.Model):
    """
    Threshold configuratie voor waarschuwingen.
    Bijv. "Stuur waarschuwing 30 dagen voor APK verloopdatum".
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name='Naam')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    
    # Wat triggert de waarschuwing
    maintenance_type = models.ForeignKey(
        MaintenanceType,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='thresholds',
        verbose_name='Onderhoudstype'
    )
    is_apk_threshold = models.BooleanField(
        default=False,
        verbose_name='APK threshold',
        help_text='Is dit een threshold voor APK verloopdatum?'
    )
    
    # Wanneer triggeren (dagen voor deadline)
    warning_days = models.PositiveIntegerField(
        default=30,
        verbose_name='Waarschuwing (dagen voor deadline)'
    )
    critical_days = models.PositiveIntegerField(
        default=14,
        verbose_name='Kritiek (dagen voor deadline)'
    )
    urgent_days = models.PositiveIntegerField(
        default=7,
        verbose_name='Urgent (dagen voor deadline)'
    )
    
    # Wanneer triggeren (km voor deadline)
    warning_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Waarschuwing (km voor deadline)'
    )
    critical_km = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Kritiek (km voor deadline)'
    )
    
    # Acties
    send_email = models.BooleanField(default=True, verbose_name='E-mail versturen')
    send_push = models.BooleanField(default=True, verbose_name='Push notificatie')
    send_to_admin = models.BooleanField(default=True, verbose_name='Naar admin')
    
    # Extra e-mail ontvangers
    extra_email_recipients = models.TextField(
        blank=True,
        verbose_name='Extra e-mail ontvangers',
        help_text='Komma-gescheiden e-mailadressen'
    )
    
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Onderhoud threshold'
        verbose_name_plural = 'Onderhoud thresholds'
        ordering = ['name']

    def __str__(self):
        return self.name

    def get_severity_for_days(self, days_remaining):
        """Bepaal de ernst op basis van resterende dagen."""
        if days_remaining <= self.urgent_days:
            return AlertSeverity.URGENT
        if days_remaining <= self.critical_days:
            return AlertSeverity.CRITICAL
        if days_remaining <= self.warning_days:
            return AlertSeverity.WARNING
        return AlertSeverity.INFO


class MaintenanceAlert(models.Model):
    """
    Gegenereerde waarschuwingen voor onderhoud.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='maintenance_alerts',
        verbose_name='Voertuig'
    )
    threshold = models.ForeignKey(
        MaintenanceThreshold,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='alerts',
        verbose_name='Threshold'
    )
    maintenance_task = models.ForeignKey(
        MaintenanceTask,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='alerts',
        verbose_name='Onderhoudstaak'
    )
    apk_record = models.ForeignKey(
        APKRecord,
        on_delete=models.CASCADE,
        null=True, blank=True,
        related_name='alerts',
        verbose_name='APK Record'
    )
    
    severity = models.CharField(
        max_length=20,
        choices=AlertSeverity.choices,
        default=AlertSeverity.WARNING,
        verbose_name='Ernst'
    )
    title = models.CharField(max_length=200, verbose_name='Titel')
    message = models.TextField(verbose_name='Bericht')
    
    # Status
    is_read = models.BooleanField(default=False, verbose_name='Gelezen')
    is_dismissed = models.BooleanField(default=False, verbose_name='Afgewezen')
    is_resolved = models.BooleanField(default=False, verbose_name='Opgelost')
    
    # E-mail tracking
    email_sent = models.BooleanField(default=False, verbose_name='E-mail verstuurd')
    email_sent_at = models.DateTimeField(null=True, blank=True, verbose_name='E-mail verstuurd op')
    push_sent = models.BooleanField(default=False, verbose_name='Push verstuurd')
    
    resolved_at = models.DateTimeField(null=True, blank=True, verbose_name='Opgelost op')
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='resolved_maintenance_alerts',
        verbose_name='Opgelost door'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Onderhoudswaarschuwing'
        verbose_name_plural = 'Onderhoudswaarschuwingen'
        ordering = ['-created_at']

    def __str__(self):
        return f"[{self.get_severity_display()}] {self.title}"

    def dismiss(self, user=None):
        """Wijs de waarschuwing af."""
        self.is_dismissed = True
        self.save(update_fields=['is_dismissed', 'updated_at'])

    def resolve(self, user=None):
        """Markeer als opgelost."""
        self.is_resolved = True
        self.resolved_at = timezone.now()
        self.resolved_by = user
        self.save(update_fields=['is_resolved', 'resolved_at', 'resolved_by', 'updated_at'])


# =============================================================================
# DASHBOARD WIDGETS & QUERIES
# =============================================================================

class DashboardWidgetType(models.TextChoices):
    APK_COUNTDOWN = 'apk_countdown', 'APK Countdown'
    MAINTENANCE_CALENDAR = 'maintenance_calendar', 'Onderhoudskalender'
    COST_PER_VEHICLE = 'cost_per_vehicle', 'Kosten per voertuig'
    COST_BY_TYPE = 'cost_by_type', 'Kosten per type'
    COST_TREND = 'cost_trend', 'Kosten trend'
    UPCOMING_MAINTENANCE = 'upcoming_maintenance', 'Aankomend onderhoud'
    OVERDUE_TASKS = 'overdue_tasks', 'Te late taken'
    ALERTS_SUMMARY = 'alerts_summary', 'Waarschuwingen overzicht'
    TIRE_STATUS = 'tire_status', 'Bandenstatus'
    FLEET_HEALTH = 'fleet_health', 'Vloot gezondheid'
    CUSTOM_QUERY = 'custom_query', 'Aangepaste query'
    KPI_CARD = 'kpi_card', 'KPI Kaart'
    TABLE = 'table', 'Tabel'
    CHART_BAR = 'chart_bar', 'Staafdiagram'
    CHART_LINE = 'chart_line', 'Lijndiagram'
    CHART_PIE = 'chart_pie', 'Taartdiagram'
    CHART_DONUT = 'chart_donut', 'Donutdiagram'


class DashboardWidgetSize(models.TextChoices):
    SMALL = 'small', 'Klein (1 kolom)'
    MEDIUM = 'medium', 'Middel (2 kolommen)'
    LARGE = 'large', 'Groot (3 kolommen)'
    FULL = 'full', 'Vol (4 kolommen)'


class MaintenanceDashboard(models.Model):
    """
    Configureerbaar dashboard voor onderhoudsbeheer.
    Gebruikers kunnen hun eigen dashboards samenstellen.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='maintenance_dashboards',
        verbose_name='Gebruiker'
    )
    name = models.CharField(max_length=100, verbose_name='Dashboard naam')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    is_default = models.BooleanField(default=False, verbose_name='Standaard dashboard')
    is_shared = models.BooleanField(default=False, verbose_name='Gedeeld',
                                     help_text='Zichtbaar voor andere gebruikers')
    layout = models.JSONField(
        default=dict, blank=True,
        verbose_name='Layout configuratie',
        help_text='Grid layout positie en grootte van widgets'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Onderhoud dashboard'
        verbose_name_plural = 'Onderhoud dashboards'
        ordering = ['-is_default', 'name']

    def __str__(self):
        return f"{self.name} ({self.user.email})"


class DashboardWidget(models.Model):
    """
    Widget/tegel configuratie voor een dashboard.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    dashboard = models.ForeignKey(
        MaintenanceDashboard,
        on_delete=models.CASCADE,
        related_name='widgets',
        verbose_name='Dashboard'
    )
    
    widget_type = models.CharField(
        max_length=30,
        choices=DashboardWidgetType.choices,
        verbose_name='Widget type'
    )
    title = models.CharField(max_length=200, verbose_name='Titel')
    
    # Grootte en positie
    size = models.CharField(
        max_length=10,
        choices=DashboardWidgetSize.choices,
        default=DashboardWidgetSize.MEDIUM,
        verbose_name='Grootte'
    )
    position_x = models.IntegerField(default=0, verbose_name='Positie X')
    position_y = models.IntegerField(default=0, verbose_name='Positie Y')
    sort_order = models.IntegerField(default=0, verbose_name='Sorteervolgorde')
    
    # Configuratie
    config = models.JSONField(
        default=dict, blank=True,
        verbose_name='Widget configuratie',
        help_text='Filters, kleurinstellingen, tijdsbereik etc.'
    )
    
    # Voor custom queries
    custom_query = models.ForeignKey(
        'MaintenanceQuery',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='widgets',
        verbose_name='Aangepaste query'
    )
    
    is_visible = models.BooleanField(default=True, verbose_name='Zichtbaar')
    refresh_interval_seconds = models.PositiveIntegerField(
        default=300,
        verbose_name='Verversingsinterval (sec)',
        help_text='Hoe vaak de widget data ververst (standaard 5 minuten)'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Dashboard widget'
        verbose_name_plural = 'Dashboard widgets'
        ordering = ['sort_order', 'position_y', 'position_x']

    def __str__(self):
        return f"{self.title} ({self.get_widget_type_display()})"


class MaintenanceQuery(models.Model):
    """
    Opgeslagen query's voor het dashboard.
    Gebruikers kunnen eigen queries maken of sample queries gebruiken.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, verbose_name='Query naam')
    description = models.TextField(blank=True, verbose_name='Beschrijving')
    
    # Query definitie (JSON-gebaseerd voor veiligheid)
    query_definition = models.JSONField(
        verbose_name='Query definitie',
        help_text='JSON query definitie met filters, groepering, aggregaties'
    )
    
    # Weergave
    result_type = models.CharField(
        max_length=30,
        choices=[
            ('table', 'Tabel'),
            ('chart_bar', 'Staafdiagram'),
            ('chart_line', 'Lijndiagram'),
            ('chart_pie', 'Taartdiagram'),
            ('chart_donut', 'Donutdiagram'),
            ('kpi', 'KPI Kaart'),
            ('number', 'Getal'),
        ],
        default='table',
        verbose_name='Resultaattype'
    )
    
    # Wie heeft de query gemaakt
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='maintenance_queries',
        verbose_name='Aangemaakt door'
    )
    
    is_sample = models.BooleanField(
        default=False,
        verbose_name='Voorbeeld query',
        help_text='Is dit een voorgedefinieerde sample query?'
    )
    is_public = models.BooleanField(
        default=False,
        verbose_name='Publiek',
        help_text='Zichtbaar voor alle gebruikers'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Onderhoudsquery'
        verbose_name_plural = 'Onderhoudsqueries'
        ordering = ['-is_sample', 'name']

    def __str__(self):
        return self.name


# =============================================================================
# OBD CONNECTOR VOORBEREIDING
# =============================================================================

class OBDConnectionType(models.TextChoices):
    BLUETOOTH = 'bluetooth', 'Bluetooth'
    WIFI = 'wifi', 'WiFi'
    USB = 'usb', 'USB'
    ONLINE_API = 'online_api', 'Online API'


class OBDDevice(models.Model):
    """
    OBD-II apparaat registratie per voertuig.
    Voorbereiding voor integratie met OBD dongles/connectors.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.OneToOneField(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='obd_device',
        verbose_name='Voertuig'
    )
    
    device_name = models.CharField(max_length=100, verbose_name='Apparaat naam')
    device_serial = models.CharField(max_length=100, blank=True, verbose_name='Serienummer')
    connection_type = models.CharField(
        max_length=20,
        choices=OBDConnectionType.choices,
        default=OBDConnectionType.ONLINE_API,
        verbose_name='Verbindingstype'
    )
    
    # Online API configuratie
    api_endpoint = models.URLField(blank=True, verbose_name='API endpoint')
    api_key = models.CharField(max_length=500, blank=True, verbose_name='API sleutel')
    api_provider = models.CharField(
        max_length=100, blank=True,
        verbose_name='API provider',
        help_text='Bijv. Geotab, Samsara, Fleetio, Teletrac'
    )
    
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    last_sync = models.DateTimeField(null=True, blank=True, verbose_name='Laatste synchronisatie')
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'OBD Apparaat'
        verbose_name_plural = 'OBD Apparaten'

    def __str__(self):
        return f"{self.device_name} - {self.vehicle.kenteken}"


class OBDReading(models.Model):
    """
    Individuele OBD-uitlezing / datapunt.
    Slaat telemetrie data op van het voertuig.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    device = models.ForeignKey(
        OBDDevice,
        on_delete=models.CASCADE,
        related_name='readings',
        verbose_name='OBD Apparaat'
    )
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.CASCADE,
        related_name='obd_readings',
        verbose_name='Voertuig'
    )
    
    timestamp = models.DateTimeField(verbose_name='Tijdstip')
    
    # Motor data
    engine_rpm = models.PositiveIntegerField(null=True, blank=True, verbose_name='Motor RPM')
    engine_temp_celsius = models.DecimalField(
        max_digits=5, decimal_places=1,
        null=True, blank=True,
        verbose_name='Motortemperatuur (°C)'
    )
    engine_load_percent = models.DecimalField(
        max_digits=5, decimal_places=1,
        null=True, blank=True,
        verbose_name='Motorbelasting (%)'
    )
    engine_hours = models.DecimalField(
        max_digits=10, decimal_places=1,
        null=True, blank=True,
        verbose_name='Motoruren'
    )
    
    # Snelheid & afstand
    speed_kmh = models.PositiveIntegerField(null=True, blank=True, verbose_name='Snelheid (km/h)')
    odometer_km = models.PositiveIntegerField(null=True, blank=True, verbose_name='Kilometerstand')
    
    # Brandstof
    fuel_level_percent = models.DecimalField(
        max_digits=5, decimal_places=1,
        null=True, blank=True,
        verbose_name='Brandstofniveau (%)'
    )
    fuel_rate_lph = models.DecimalField(
        max_digits=6, decimal_places=2,
        null=True, blank=True,
        verbose_name='Brandstofverbruik (l/h)'
    )
    fuel_type = models.CharField(max_length=20, blank=True, verbose_name='Brandstoftype')
    
    # Diagnose
    dtc_codes = models.JSONField(
        default=list, blank=True,
        verbose_name='DTC foutcodes',
        help_text='Diagnostic Trouble Codes'
    )
    mil_on = models.BooleanField(
        null=True, blank=True,
        verbose_name='Storingslamp aan',
        help_text='Malfunction Indicator Light'
    )
    
    # Olie
    oil_temp_celsius = models.DecimalField(
        max_digits=5, decimal_places=1,
        null=True, blank=True,
        verbose_name='Olietemperatuur (°C)'
    )
    oil_pressure_kpa = models.DecimalField(
        max_digits=7, decimal_places=1,
        null=True, blank=True,
        verbose_name='Oliedruk (kPa)'
    )
    
    # Bandendruk (TPMS)
    tire_pressure_data = models.JSONField(
        default=dict, blank=True,
        verbose_name='Bandendruk data',
        help_text='Per positie bandendruk in bar'
    )
    
    # Batterij
    battery_voltage = models.DecimalField(
        max_digits=5, decimal_places=2,
        null=True, blank=True,
        verbose_name='Accu spanning (V)'
    )
    
    # AdBlue (voor Euro 6 trucks)
    adblue_level_percent = models.DecimalField(
        max_digits=5, decimal_places=1,
        null=True, blank=True,
        verbose_name='AdBlue niveau (%)'
    )
    
    # GPS (indien beschikbaar)
    latitude = models.DecimalField(
        max_digits=10, decimal_places=7,
        null=True, blank=True,
        verbose_name='Breedtegraad'
    )
    longitude = models.DecimalField(
        max_digits=10, decimal_places=7,
        null=True, blank=True,
        verbose_name='Lengtegraad'
    )
    
    # Raw data
    raw_data = models.JSONField(
        default=dict, blank=True,
        verbose_name='Ruwe data',
        help_text='Alle onbewerkte OBD data'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'OBD Uitlezing'
        verbose_name_plural = 'OBD Uitlezingen'
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['vehicle', '-timestamp']),
            models.Index(fields=['device', '-timestamp']),
        ]

    def __str__(self):
        return f"OBD {self.vehicle.kenteken} - {self.timestamp}"

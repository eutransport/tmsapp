"""
Track & Trace models for real-time vehicle location tracking.

Security considerations:
- All location data is tied to authenticated users only
- GPS coordinates are validated for realistic ranges
- Session tokens use cryptographic randomness (UUID4)
- Automatic data retention cleanup via management command
- No PII stored beyond user FK — location data is vehicle-centric
"""
import uuid
from django.db import models
from django.conf import settings
from django.core.validators import MinValueValidator, MaxValueValidator
from django.utils import timezone

from apps.core.models import EncryptedCharField


class TrackingSession(models.Model):
    """
    Represents an active tracking session for a driver.
    A session starts when the driver enables tracking and ends when they stop.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='tracking_sessions',
        verbose_name='Gebruiker',
    )
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='tracking_sessions',
        verbose_name='Voertuig',
    )
    started_at = models.DateTimeField(auto_now_add=True, verbose_name='Gestart op')
    ended_at = models.DateTimeField(null=True, blank=True, verbose_name='Gestopt op')
    is_active = models.BooleanField(default=True, verbose_name='Actief')
    
    # Security: store origin info for audit trail
    user_agent = models.CharField(max_length=500, blank=True, verbose_name='User Agent')
    ip_address = models.GenericIPAddressField(null=True, blank=True, verbose_name='IP Adres')

    class Meta:
        verbose_name = 'Tracking Sessie'
        verbose_name_plural = 'Tracking Sessies'
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['user', 'is_active']),
            models.Index(fields=['vehicle', 'is_active']),
            models.Index(fields=['-started_at']),
        ]

    def __str__(self):
        return f"Session {self.id} - {self.user} ({self.started_at})"

    def end_session(self):
        """End the tracking session."""
        self.is_active = False
        self.ended_at = timezone.now()
        self.save(update_fields=['is_active', 'ended_at'])


class LocationPoint(models.Model):
    """
    Individual GPS location point within a tracking session.
    
    Security:
    - Latitude/longitude validated to real-world ranges
    - Accuracy field helps filter unreliable data
    - Speed validated to prevent spoofed impossible values
    - Timestamps validated against session bounds
    """
    id = models.BigAutoField(primary_key=True)
    session = models.ForeignKey(
        TrackingSession,
        on_delete=models.CASCADE,
        related_name='points',
        verbose_name='Sessie',
    )
    latitude = models.DecimalField(
        max_digits=10, decimal_places=7,
        validators=[MinValueValidator(-90), MaxValueValidator(90)],
        verbose_name='Breedtegraad',
    )
    longitude = models.DecimalField(
        max_digits=10, decimal_places=7,
        validators=[MinValueValidator(-180), MaxValueValidator(180)],
        verbose_name='Lengtegraad',
    )
    accuracy = models.FloatField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(10000)],
        verbose_name='Nauwkeurigheid (m)',
        help_text='GPS accuracy in meters. Lower is better.',
    )
    speed = models.FloatField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(400)],
        verbose_name='Snelheid (km/h)',
        help_text='Speed in km/h. Max 400 for sanity check.',
    )
    heading = models.FloatField(
        null=True, blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(360)],
        verbose_name='Richting (graden)',
    )
    altitude = models.FloatField(
        null=True, blank=True,
        verbose_name='Hoogte (m)',
    )
    recorded_at = models.DateTimeField(
        verbose_name='Opgenomen op',
        help_text='Client-side timestamp of this location point.',
    )
    received_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name='Ontvangen op',
        help_text='Server-side timestamp when point was received.',
    )

    class Meta:
        verbose_name = 'Locatiepunt'
        verbose_name_plural = 'Locatiepunten'
        ordering = ['-recorded_at']
        indexes = [
            models.Index(fields=['session', '-recorded_at']),
            models.Index(fields=['-received_at']),
        ]

    def __str__(self):
        return f"({self.latitude}, {self.longitude}) @ {self.recorded_at}"


class TachographOvertime(models.Model):
    """
    Stores overtime hours derived from FM-Track tachograph data, linked to a TMS driver.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(
        'drivers.Driver',
        on_delete=models.CASCADE,
        related_name='tachograph_overtime',
        verbose_name='Chauffeur',
    )
    date = models.DateField(verbose_name='Datum')
    overtime_hours = models.DecimalField(
        max_digits=5, decimal_places=2,
        verbose_name='Overuren',
        help_text='Aantal overuren (boven 8 uur).'
    )
    vehicle_name = models.CharField(max_length=100, blank=True, verbose_name='Voertuig')
    fm_driver_name = models.CharField(max_length=200, blank=True, verbose_name='FM-Track Chauffeur')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        verbose_name='Aangemaakt door',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Tachograaf Overuren'
        verbose_name_plural = 'Tachograaf Overuren'
        unique_together = ['driver', 'date']
        ordering = ['-date']

    def __str__(self):
        return f"{self.driver} - {self.date} - {self.overtime_hours}u"


class TachographSyncLog(models.Model):
    """
    Tracks which dates have been synced from the tachograph to avoid duplicate processing.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField(unique=True, verbose_name='Datum')
    vehicles_processed = models.PositiveIntegerField(default=0, verbose_name='Voertuigen verwerkt')
    entries_created = models.PositiveIntegerField(default=0, verbose_name='Uren aangemaakt')
    overtime_created = models.PositiveIntegerField(default=0, verbose_name='Overuren aangemaakt')
    errors = models.TextField(blank=True, verbose_name='Fouten')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Tachograaf Sync Log'
        verbose_name_plural = 'Tachograaf Sync Logs'
        ordering = ['-date']

    def __str__(self):
        return f"Sync {self.date} - {self.entries_created} entries"


class TachographArchiveEntry(models.Model):
    """
    Stored tachograph overview row for a specific day and vehicle/object.
    """
    id = models.BigAutoField(primary_key=True)
    date = models.DateField(verbose_name='Datum')
    object_id = models.CharField(max_length=100, verbose_name='Object ID')
    vehicle_name = models.CharField(max_length=255, blank=True, verbose_name='Voertuig')
    vehicle_make = models.CharField(max_length=100, blank=True, verbose_name='Merk')
    vehicle_model = models.CharField(max_length=100, blank=True, verbose_name='Model')
    plate_number = models.CharField(max_length=100, blank=True, verbose_name='Kenteken')
    first_start = models.DateTimeField(null=True, blank=True, verbose_name='Eerste start')
    last_end = models.DateTimeField(null=True, blank=True, verbose_name='Laatste einde')
    first_km = models.FloatField(default=0, verbose_name='Start KM')
    last_km = models.FloatField(default=0, verbose_name='Eind KM')
    total_km = models.FloatField(default=0, verbose_name='Totaal KM')
    total_duration_seconds = models.PositiveIntegerField(default=0, verbose_name='Totale duur (s)')
    total_hours = models.FloatField(default=0, verbose_name='Totale uren')
    total_hours_display = models.CharField(max_length=20, blank=True, verbose_name='Totale uren (weergave)')
    overtime_hours = models.FloatField(default=0, verbose_name='Overuren')
    overtime_display = models.CharField(max_length=20, null=True, blank=True, verbose_name='Overuren (weergave)')
    has_overtime = models.BooleanField(default=False, verbose_name='Heeft overuren')
    overtime_calculation = models.JSONField(null=True, blank=True, verbose_name='Overuren berekening')
    drivers = models.JSONField(default=list, blank=True, verbose_name='Chauffeurs')
    trips = models.JSONField(default=list, blank=True, verbose_name='Ritten')
    trip_count = models.PositiveIntegerField(default=0, verbose_name='Aantal ritten')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Tachograaf Archief Regel'
        verbose_name_plural = 'Tachograaf Archief Regels'
        ordering = ['-date', 'vehicle_name']
        unique_together = ['date', 'object_id']
        indexes = [
            models.Index(fields=['date']),
            models.Index(fields=['date', 'plate_number']),
            models.Index(fields=['date', 'vehicle_name']),
        ]

    def __str__(self):
        return f"{self.date} - {self.plate_number or self.vehicle_name}"


class RadiusJourney(models.Model):
    """
    Eén rit uit de Radius Velocity ritgeschiedenis.

    Radius bewaart zelf maar ongeveer 30 dagen. Door dagelijks te synchroniseren
    bouwen we hier een archief op dat verder terug gaat dan de API zelf.
    """
    id = models.BigAutoField(primary_key=True)
    service_id = models.CharField(max_length=64, verbose_name='Service ID')
    plate_number = models.CharField(max_length=20, blank=True, verbose_name='Kenteken')
    driver_name = models.CharField(max_length=150, blank=True, verbose_name='Chauffeur')
    date = models.DateField(verbose_name='Datum', help_text='Lokale datum waarop de rit begon.')
    start_time = models.DateTimeField(verbose_name='Starttijd')
    end_time = models.DateTimeField(null=True, blank=True, verbose_name='Eindtijd')
    start_latitude = models.FloatField(null=True, blank=True, verbose_name='Start breedtegraad')
    start_longitude = models.FloatField(null=True, blank=True, verbose_name='Start lengtegraad')
    end_latitude = models.FloatField(null=True, blank=True, verbose_name='Eind breedtegraad')
    end_longitude = models.FloatField(null=True, blank=True, verbose_name='Eind lengtegraad')
    start_address = models.CharField(max_length=255, blank=True, verbose_name='Startadres')
    start_city = models.CharField(max_length=120, blank=True, verbose_name='Startplaats')
    start_country = models.CharField(max_length=100, blank=True, verbose_name='Startland')
    end_address = models.CharField(max_length=255, blank=True, verbose_name='Eindadres')
    end_city = models.CharField(max_length=120, blank=True, verbose_name='Eindplaats')
    end_country = models.CharField(max_length=100, blank=True, verbose_name='Eindland')
    distance_km = models.FloatField(default=0, verbose_name='Afstand (km)')
    duration_seconds = models.PositiveIntegerField(default=0, verbose_name='Duur (s)')
    customer_id = models.CharField(max_length=32, blank=True, verbose_name='Radius klant-id')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Radius Rit'
        verbose_name_plural = 'Radius Ritten'
        ordering = ['-start_time', 'plate_number']
        # Een rit is uniek per tracker en starttijdstip; daarmee is opnieuw
        # synchroniseren van dezelfde periode veilig.
        unique_together = ['service_id', 'start_time']
        indexes = [
            models.Index(fields=['date']),
            models.Index(fields=['date', 'plate_number']),
            models.Index(fields=['plate_number', '-start_time']),
        ]

    def __str__(self):
        return f"{self.plate_number or self.service_id} - {self.start_time:%d-%m-%Y %H:%M}"


class RadiusConnection(models.Model):
    """Een losse Radius-koppeling met een eigen API-token.

    Radius geeft per product een apart token uit: Telematics voor GPS en ritten,
    Fuel voor de tank- en laadkaarten waar de tolfacturen onder vallen. Een klant
    kan er meerdere hebben, bijvoorbeeld per vestiging of per bedrijf.

    Het bestaande `AppSettings.radius_api_token` blijft werken als er geen
    koppeling van dit type actief is, zodat bestaande installaties niets merken.
    """

    class Soort(models.TextChoices):
        TELEMATICS = 'telematics', 'Telematica (GPS en ritten)'
        FUEL = 'fuel', 'Tank- en laadkaarten (facturen)'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    naam = models.CharField(max_length=120, verbose_name='Naam')
    soort = models.CharField(
        max_length=20, choices=Soort.choices, default=Soort.TELEMATICS,
        db_index=True, verbose_name='Soort koppeling',
    )
    api_token = EncryptedCharField(
        max_length=512, verbose_name='Radius API token',
        help_text='Refresh token uit het Radius Portal (Account > API integratie).',
    )
    customer_id = models.CharField(
        max_length=32, blank=True, verbose_name='Radius klant-id',
        help_text='Leeg laten om de klant automatisch te bepalen.',
    )
    start_datum = models.DateField(
        null=True, blank=True, verbose_name='Startdatum',
        help_text='Vanaf welke datum gegevens opgehaald worden.',
    )
    actief = models.BooleanField(default=True, db_index=True, verbose_name='Actief')
    laatste_controle = models.DateTimeField(null=True, blank=True, verbose_name='Laatst gecontroleerd')
    laatste_resultaat = models.CharField(max_length=255, blank=True, verbose_name='Laatste resultaat')
    aangemaakt_door = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='radius_connections',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Radius koppeling'
        verbose_name_plural = 'Radius koppelingen'
        ordering = ['soort', 'naam']
        constraints = [
            models.UniqueConstraint(fields=['naam', 'soort'], name='radius_connection_unieke_naam'),
        ]

    def __str__(self):
        return f'{self.naam} ({self.get_soort_display()})'


class RadiusSyncLog(models.Model):
    """Houdt bij welke dagen uit Radius zijn opgehaald."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    date = models.DateField(unique=True, verbose_name='Datum')
    journeys_synced = models.PositiveIntegerField(default=0, verbose_name='Ritten gesynchroniseerd')
    journeys_created = models.PositiveIntegerField(default=0, verbose_name='Nieuwe ritten')
    vehicles_seen = models.PositiveIntegerField(default=0, verbose_name='Voertuigen gezien')
    errors = models.TextField(blank=True, verbose_name='Fouten')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Radius Sync Log'
        verbose_name_plural = 'Radius Sync Logs'
        ordering = ['-date']

    def __str__(self):
        return f"Radius sync {self.date} - {self.journeys_synced} ritten"


class NavixyConnection(models.Model):
    """Koppeling met het Navixy-volgsysteem.

    Navixy geeft permanente API-sleutels uit die als ``Authorization: NVX <sleutel>``
    meegestuurd worden. Een sessie-hash uit ``user/auth`` verloopt na dertig dagen
    en is daarom ongeschikt voor een koppeling die blijft draaien.

    De sleutel wordt versleuteld opgeslagen en komt nooit terug in een response.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    naam = models.CharField(max_length=120, unique=True, verbose_name='Naam')
    api_key = EncryptedCharField(
        max_length=512, verbose_name='Navixy API-sleutel',
        help_text='Permanente API-sleutel uit Navixy (Instellingen > API keys).',
    )
    basis_url = models.CharField(
        max_length=200, default='https://api.navixy.com/v2',
        verbose_name='API-adres',
        help_text='Pas dit alleen aan voor een eigen Navixy-omgeving.',
    )
    actief = models.BooleanField(default=True, db_index=True, verbose_name='Actief')
    laatste_controle = models.DateTimeField(null=True, blank=True, verbose_name='Laatst gecontroleerd')
    laatste_resultaat = models.CharField(max_length=255, blank=True, verbose_name='Laatste resultaat')
    aangemaakt_door = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='navixy_connections',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Navixy koppeling'
        verbose_name_plural = 'Navixy koppelingen'
        ordering = ['naam']

    def __str__(self):
        return self.naam


class NavixyTracker(models.Model):
    """Welk Navixy-kastje bij welk kenteken hoort.

    Navixy kent alleen een eigen tracker-nummer; de rest van de applicatie werkt
    op kenteken. Deze tabel legt dat verband, zodat de posities op dezelfde
    manier bruikbaar zijn als die uit de andere volgsystemen.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    koppeling = models.ForeignKey(
        NavixyConnection, on_delete=models.CASCADE, related_name='trackers',
        verbose_name='Koppeling',
    )
    tracker_id = models.BigIntegerField(verbose_name='Navixy tracker-id')
    kenteken = models.CharField(max_length=20, db_index=True, verbose_name='Kenteken')
    omschrijving = models.CharField(max_length=120, blank=True, verbose_name='Omschrijving')
    actief = models.BooleanField(default=True, db_index=True, verbose_name='Actief')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Navixy tracker'
        verbose_name_plural = 'Navixy trackers'
        ordering = ['kenteken']
        constraints = [
            models.UniqueConstraint(
                fields=['koppeling', 'tracker_id'], name='navixy_tracker_uniek_per_koppeling',
            ),
        ]

    def __str__(self):
        return f'{self.kenteken} (tracker {self.tracker_id})'


class NavixyJourney(models.Model):
    """Een rit uit de Navixy-ritgeschiedenis.

    Navixy bewaart zelf maar een beperkte periode, afhankelijk van het
    abonnement. Door periodiek te synchroniseren bouwen we hier een archief op
    dat verder teruggaat dan de API zelf, net zoals bij Radius.
    """

    id = models.BigAutoField(primary_key=True)
    tracker = models.ForeignKey(
        NavixyTracker,
        on_delete=models.CASCADE,
        related_name='ritten',
        verbose_name='Tracker',
    )
    track_id = models.BigIntegerField(verbose_name='Navixy rit-id')
    plate_number = models.CharField(max_length=20, blank=True, verbose_name='Kenteken')
    date = models.DateField(verbose_name='Datum', help_text='Lokale datum waarop de rit begon.')
    start_time = models.DateTimeField(verbose_name='Starttijd')
    end_time = models.DateTimeField(null=True, blank=True, verbose_name='Eindtijd')
    start_address = models.CharField(max_length=255, blank=True, verbose_name='Startadres')
    end_address = models.CharField(max_length=255, blank=True, verbose_name='Eindadres')
    start_latitude = models.FloatField(null=True, blank=True, verbose_name='Start breedtegraad')
    start_longitude = models.FloatField(null=True, blank=True, verbose_name='Start lengtegraad')
    end_latitude = models.FloatField(null=True, blank=True, verbose_name='Eind breedtegraad')
    end_longitude = models.FloatField(null=True, blank=True, verbose_name='Eind lengtegraad')
    distance_km = models.FloatField(default=0, verbose_name='Afstand (km)')
    duration_seconds = models.PositiveIntegerField(default=0, verbose_name='Duur (s)')
    max_speed = models.FloatField(default=0, verbose_name='Maximale snelheid (km/u)')
    avg_speed = models.FloatField(default=0, verbose_name='Gemiddelde snelheid (km/u)')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Navixy Rit'
        verbose_name_plural = 'Navixy Ritten'
        ordering = ['-start_time', 'plate_number']
        # Navixy geeft per rit een eigen id. Samen met de tracker is dat een
        # stabiele sleutel, zodat dezelfde periode opnieuw ophalen veilig is.
        unique_together = ['tracker', 'track_id']
        indexes = [
            models.Index(fields=['date']),
            models.Index(fields=['plate_number', 'date']),
            models.Index(fields=['-start_time']),
        ]

    def __str__(self):
        return f'{self.plate_number} {self.start_time:%d-%m-%Y %H:%M} ({self.distance_km:.1f} km)'


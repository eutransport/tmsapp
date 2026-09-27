"""Fleet models - To be implemented in Fase 2."""
import uuid
from django.db import models


class Vehicle(models.Model):
    """Voertuig model."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kenteken = models.CharField(max_length=20, verbose_name='Kenteken')
    type_wagen = models.CharField(max_length=100, verbose_name='Type Wagen')
    ritnummer = models.CharField(max_length=50, verbose_name='Ritnummer')
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.CASCADE,
        related_name='vehicles',
        verbose_name='Bedrijf'
    )
    
    minimum_weken_per_jaar = models.PositiveIntegerField(
        null=True, blank=True,
        verbose_name='Minimum weken per jaar',
        help_text='Minimaal aantal weken dat dit voertuig per jaar moet draaien. Laat leeg om niet bij te houden.'
    )
    actief = models.BooleanField(
        default=True,
        verbose_name='Actief',
        help_text='Inactieve voertuigen worden niet getoond in selectielijsten maar hun historische data blijft beschikbaar.'
    )

    # ------------------------------------------------------------------
    # Gegevens uit het kentekenregister van de RDW
    #
    # Allemaal optioneel: een wagen zonder opgehaalde gegevens blijft
    # gewoon werken. De velden worden gevuld door apps.fleet.rdw en zijn
    # bedoeld om te lezen, niet om met de hand in te vullen.
    # ------------------------------------------------------------------

    # Identiteit
    rdw_merk = models.CharField(max_length=100, blank=True, verbose_name='Merk')
    rdw_handelsbenaming = models.CharField(
        max_length=200, blank=True, verbose_name='Handelsbenaming')
    rdw_voertuigsoort = models.CharField(
        max_length=100, blank=True, verbose_name='Voertuigsoort')
    rdw_inrichting = models.CharField(
        max_length=100, blank=True, verbose_name='Inrichting')
    rdw_voertuigcategorie = models.CharField(
        max_length=20, blank=True, verbose_name='Voertuigcategorie',
        help_text='Europese categorie, bijvoorbeeld N3.')
    rdw_voertuigcategorie_omschrijving = models.CharField(
        max_length=200, blank=True, verbose_name='Voertuigcategorie in woorden')
    rdw_carrosserie = models.CharField(
        max_length=200, blank=True, verbose_name='Soort opbouw')
    rdw_datum_eerste_toelating = models.DateField(
        null=True, blank=True, verbose_name='Datum eerste toelating')
    rdw_bouwjaar = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Bouwjaar')

    # Keuringen
    rdw_apk_vervaldatum = models.DateField(
        null=True, blank=True, verbose_name='APK geldig tot')
    rdw_tachograaf_vervaldatum = models.DateField(
        null=True, blank=True, verbose_name='Tachograaf geldig tot')

    # Gewichten in kilogram
    rdw_massa_ledig = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Massa leeg (kg)')
    rdw_massa_rijklaar = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Massa rijklaar (kg)')
    rdw_max_massa = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Toegestane maximummassa (kg)')
    rdw_technisch_max_massa = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Technisch toegestane massa (kg)')
    rdw_max_massa_samenstelling = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Maximum massa samenstelling (kg)',
        help_text='Het totaalgewicht van trekker en oplegger samen.')
    rdw_laadvermogen = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Laadvermogen (kg)',
        help_text='Toegestane maximummassa min de massa rijklaar.')

    # Afmetingen in centimeters
    rdw_lengte_cm = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Lengte (cm)')
    rdw_breedte_cm = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Breedte (cm)')
    rdw_wielbasis_cm = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Wielbasis (cm)')

    # Milieu en tolheffing
    rdw_brandstof = models.CharField(
        max_length=100, blank=True, verbose_name='Brandstof')
    rdw_emissieklasse = models.CharField(
        max_length=50, blank=True, verbose_name='Uitlaatemissieniveau',
        help_text='Bijvoorbeeld EURO VI E.')
    rdw_euronorm = models.CharField(
        max_length=50, blank=True, verbose_name='Euronorm')
    rdw_co2_klasse = models.CharField(
        max_length=10, blank=True, verbose_name='CO2-klasse',
        help_text='Bepaalt mede het Duitse Maut-tarief.')
    rdw_co2_klasse_omschrijving = models.CharField(
        max_length=200, blank=True, verbose_name='CO2-klasse in woorden')
    rdw_vermogen_kw = models.DecimalField(
        max_digits=8, decimal_places=2, null=True, blank=True,
        verbose_name='Vermogen (kW)')
    rdw_geluidsniveau = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Geluidsniveau rijdend (dB)')
    rdw_cilinderinhoud = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Cilinderinhoud (cm3)')

    # Assen en wielen
    rdw_aantal_assen = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Aantal assen')
    rdw_aantal_wielen = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Aantal wielen')
    rdw_max_aslast = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Zwaarste toegestane aslast (kg)')
    rdw_assen = models.JSONField(
        default=list, blank=True, verbose_name='Assen',
        help_text='Per as de plaats, aandrijving en toegestane aslast.')

    # Overig
    rdw_aantal_zitplaatsen = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Aantal zitplaatsen')
    rdw_max_snelheid = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Maximumconstructiesnelheid (km/u)')

    # Signalen
    rdw_wam_verzekerd = models.BooleanField(
        null=True, blank=True, verbose_name='WAM-verzekerd')
    rdw_terugroepactie_open = models.BooleanField(
        null=True, blank=True, verbose_name='Openstaande terugroepactie')
    rdw_export = models.BooleanField(
        null=True, blank=True, verbose_name='Geregistreerd voor export')

    # Administratie van de koppeling zelf
    rdw_opgehaald_op = models.DateTimeField(
        null=True, blank=True, verbose_name='Laatst opgehaald bij de RDW')
    rdw_status = models.CharField(
        max_length=250, blank=True, verbose_name='Uitkomst laatste ophaling',
        help_text='Leeg betekent: nog nooit opgehaald.')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Voertuig'
        verbose_name_plural = 'Voertuigen'
        ordering = ['kenteken']
        constraints = [
            models.UniqueConstraint(
                fields=['kenteken'],
                condition=models.Q(actief=True),
                name='unique_kenteken_actief'
            )
        ]
    
    def __str__(self):
        return f"{self.kenteken} - {self.type_wagen}"


class VehicleRitnummer(models.Model):
    """Ritnummer van een wagen met de datum waarop het ingaat.

    Elke wagen heeft minstens een periode zonder begindatum: die geldt
    'vanaf het begin'. Een nieuwe periode met een ingangsdatum laat de
    vorige automatisch tot de dag ervoor lopen, zodat er nooit een moment
    is waarop geen ritnummer geldt.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        Vehicle,
        on_delete=models.CASCADE,
        related_name='ritnummer_periodes',
        verbose_name='Voertuig',
    )
    ritnummer = models.CharField(max_length=50, blank=True, verbose_name='Ritnummer')
    geldig_vanaf = models.DateField(
        null=True, blank=True,
        verbose_name='Geldig vanaf',
        help_text='Laat leeg voor de oudste periode; die geldt vanaf het begin.',
    )
    notitie = models.CharField(max_length=200, blank=True, verbose_name='Notitie')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Ritnummerperiode'
        verbose_name_plural = 'Ritnummerperiodes'
        ordering = [models.F('geldig_vanaf').asc(nulls_first=True), 'created_at']
        constraints = [
            # Per wagen mag er maar een periode 'vanaf het begin' bestaan...
            models.UniqueConstraint(
                fields=['vehicle'],
                condition=models.Q(geldig_vanaf__isnull=True),
                name='uniek_open_ritnummerperiode',
            ),
            # ... en maar een periode per ingangsdatum.
            models.UniqueConstraint(
                fields=['vehicle', 'geldig_vanaf'],
                name='uniek_ritnummerperiode_per_datum',
            ),
        ]
        indexes = [
            models.Index(fields=['vehicle', 'geldig_vanaf']),
        ]

    def __str__(self):
        vanaf = self.geldig_vanaf.isoformat() if self.geldig_vanaf else 'vanaf het begin'
        return f"{self.ritnummer or '(leeg)'} ({vanaf})"


class VehicleBedrijf(models.Model):
    """Bedrijf waarvoor een wagen rijdt, met de datum waarop dat ingaat.

    Werkt precies zoals :class:`VehicleRitnummer`: elke wagen heeft minstens
    een periode zonder begindatum die 'vanaf het begin' geldt. Gaat een wagen
    van bedrijf A naar bedrijf B, dan komt er een periode bij met de datum van
    de overgang. Zo blijft de tolheffing die voor bedrijf A gereden is ook aan
    bedrijf A hangen in plaats van met terugwerkende kracht naar B te
    verspringen.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    vehicle = models.ForeignKey(
        Vehicle,
        on_delete=models.CASCADE,
        related_name='bedrijf_periodes',
        verbose_name='Voertuig',
    )
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.CASCADE,
        related_name='vehicle_periodes',
        verbose_name='Bedrijf',
    )
    geldig_vanaf = models.DateField(
        null=True, blank=True,
        verbose_name='Geldig vanaf',
        help_text='Laat leeg voor de oudste periode; die geldt vanaf het begin.',
    )
    notitie = models.CharField(max_length=200, blank=True, verbose_name='Notitie')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Bedrijfsperiode'
        verbose_name_plural = 'Bedrijfsperiodes'
        ordering = [models.F('geldig_vanaf').asc(nulls_first=True), 'created_at']
        constraints = [
            # Per wagen mag er maar een periode 'vanaf het begin' bestaan...
            models.UniqueConstraint(
                fields=['vehicle'],
                condition=models.Q(geldig_vanaf__isnull=True),
                name='uniek_open_bedrijfsperiode',
            ),
            # ... en maar een periode per ingangsdatum.
            models.UniqueConstraint(
                fields=['vehicle', 'geldig_vanaf'],
                name='uniek_bedrijfsperiode_per_datum',
            ),
        ]
        indexes = [
            models.Index(fields=['vehicle', 'geldig_vanaf']),
        ]

    def __str__(self):
        vanaf = self.geldig_vanaf.isoformat() if self.geldig_vanaf else 'vanaf het begin'
        return f"{self.bedrijf_id} ({vanaf})"

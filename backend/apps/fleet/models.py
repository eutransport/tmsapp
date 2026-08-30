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

"""Drivers models - To be implemented in Fase 2."""
import uuid
from django.db import models
from django.conf import settings


class Charter(models.Model):
    """Ingehuurde vervoerder die chauffeurs (en soms wagens) levert.

    Staat bewust los van ``companies.Company``: het bedrijf op een chauffeur of
    wagen blijft de opdrachtgever waarvoor hij rijdt. Een charter krijgt een
    eigen, zeer beperkte inzage (uren, tol en kaart) via ``/api/charter/``.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    naam = models.CharField(max_length=200, verbose_name='Naam')
    kvk = models.CharField(max_length=20, blank=True, verbose_name='KVK Nummer')
    contactpersoon = models.CharField(max_length=200, blank=True, verbose_name='Contactpersoon')
    email = models.EmailField(blank=True, verbose_name='E-mail')
    telefoon = models.CharField(max_length=20, blank=True, verbose_name='Telefoon')

    # Alleen beheerders vullen dit; bepaalt wat de charter op de kaart ziet.
    voertuigen = models.ManyToManyField(
        'fleet.Vehicle',
        blank=True,
        related_name='volgbaar_voor_charters',
        verbose_name='Volgbare voertuigen'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Charter'
        verbose_name_plural = 'Charters'
        ordering = ['naam']

    def __str__(self):
        return self.naam


class Driver(models.Model):
    """Chauffeur model."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    naam = models.CharField(max_length=200, verbose_name='Naam')
    telefoon = models.CharField(max_length=20, blank=True, verbose_name='Telefoon')
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='drivers',
        verbose_name='Bedrijf'
    )
    gekoppelde_gebruiker = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='driver_profile',
        verbose_name='Gekoppelde Gebruiker'
    )
    voertuig = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='chauffeurs',
        verbose_name='Voertuig (Ritnummer)'
    )
    charter = models.ForeignKey(
        Charter,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='chauffeurs',
        verbose_name='Charter',
        help_text='Leeg voor eigen personeel. Bepaalt welke charter de uren mag inzien.'
    )
    adr = models.BooleanField(default=False, verbose_name='ADR Gecertificeerd')
    minimum_uren_per_week = models.DecimalField(
        max_digits=5, decimal_places=2,
        null=True, blank=True,
        verbose_name='Minimum uren per week',
        help_text='Standaard minimum uren per week voor deze chauffeur. Wordt gebruikt als er geen specifieke weekinstelling is.'
    )
    standaard_pauze = models.PositiveIntegerField(
        default=30,
        verbose_name='Standaard pauze (minuten)',
        help_text='Standaard pauzetijd in minuten die automatisch wordt ingevuld bij tachograaf uren.'
    )
    auto_uren = models.BooleanField(
        default=False,
        verbose_name='Automatisch uren registreren',
        help_text='Automatisch tijdregistratie aanmaken op basis van tachograaf gegevens.'
    )
    tacho_kenteken = models.CharField(
        max_length=20,
        blank=True,
        default='',
        verbose_name='Tachograaf kenteken',
        help_text='Kenteken uit de tachograaf lijst om deze chauffeur aan te koppelen.'
    )
    standaard_begintijd = models.TimeField(
        null=True,
        blank=True,
        verbose_name='Standaard begintijd',
        help_text='Vaste begintijd voor automatische uren. Als ingesteld wordt deze altijd gebruikt als aanvangstijd in plaats van de tachograaf starttijd.'
    )
    uren_per_dag = models.DecimalField(
        max_digits=4, decimal_places=2,
        null=True, blank=True,
        verbose_name='Uren per dag',
        help_text='Standaard werkuren per dag. Wordt gebruikt om overwerk te berekenen in het vergelijkingsrapport.'
    )
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = 'Chauffeur'
        verbose_name_plural = 'Chauffeurs'
        ordering = ['naam']
    
    def __str__(self):
        return self.naam


class DriverBedrijfPeriode(models.Model):
    """Bij welk bedrijf een chauffeur in welke periode hoorde.

    Het bedrijf op de chauffeur zelf kent geen geschiedenis; zonder deze
    periodes zou een opdrachtgever na een wissel ook de uren zien van de tijd
    dat de chauffeur elders reed.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(
        Driver, on_delete=models.CASCADE, related_name='bedrijf_periodes'
    )
    bedrijf = models.ForeignKey(
        'companies.Company', on_delete=models.CASCADE, related_name='chauffeur_periodes'
    )
    vanaf = models.DateField(verbose_name='Vanaf')
    tot = models.DateField(null=True, blank=True, verbose_name='Tot en met')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Chauffeursperiode bij bedrijf'
        verbose_name_plural = 'Chauffeursperiodes bij bedrijf'
        ordering = ['driver__naam', '-vanaf']

    def __str__(self):
        return f'{self.driver} @ {self.bedrijf} ({self.vanaf} - {self.tot or "heden"})'



class DriverCharterPeriode(models.Model):
    """In welke periode een chauffeur via welke charter reed.

    Alleen uren en tol binnen een periode zijn zichtbaar voor die charter.
    Een lege ``vanaf`` betekent 'vanaf het begin', zodat een charter bij de
    eerste koppeling met terugwerkende kracht alle weken ziet. Wordt de
    chauffeur eigen personeel, dan sluit de periode en ziet de charter niets
    meer van daarna.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    driver = models.ForeignKey(
        Driver, on_delete=models.CASCADE, related_name='charter_periodes'
    )
    charter = models.ForeignKey(
        Charter, on_delete=models.CASCADE, related_name='chauffeur_periodes'
    )
    vanaf = models.DateField(
        null=True, blank=True, verbose_name='Vanaf',
        help_text='Leeg betekent vanaf het begin.'
    )
    tot = models.DateField(null=True, blank=True, verbose_name='Tot en met')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Chauffeursperiode bij charter'
        verbose_name_plural = 'Chauffeursperiodes bij charter'
        ordering = ['driver__naam', models.F('vanaf').desc(nulls_last=True)]

    def __str__(self):
        return f'{self.driver} @ {self.charter} ({self.vanaf or "begin"} - {self.tot or "heden"})'

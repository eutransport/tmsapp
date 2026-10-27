"""Opdrachten die een opdrachtgever aan een chauffeur geeft."""
import os
import uuid

from django.db import IntegrityError, models, transaction

from .mail_teksten import TALEN as MAIL_TALEN


def opdracht_bijlage_pad(instance, filename):
    ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else 'bin'
    return os.path.join('opdrachten', f'{uuid.uuid4().hex}.{ext}')


class OpdrachtStatus(models.TextChoices):
    NIEUW = 'nieuw', 'Nieuw'
    GESTART = 'gestart', 'Onderweg'
    AFGELEVERD = 'afgeleverd', 'Afgeleverd'
    NIET_GELEVERD = 'niet_geleverd', 'Niet geleverd'
    INGETROKKEN = 'ingetrokken', 'Ingetrokken'


class OpdrachtFase(models.TextChoices):
    """Voortgang binnen een lopende rit.

    Staat los van `status`: die blijft 'gestart' tot de opdracht echt is
    afgehandeld, zodat alle bestaande filters, mail en archief blijven werken.
    """

    ONDERWEG = 'onderweg', 'Onderweg'
    AANGEKOMEN = 'aangekomen', 'Aangekomen bij klant'
    WACHTEN = 'wachten_op_klant', 'Wachten op klant'
    BEZIG_LADEN = 'bezig_laden', 'Bezig met laden'
    BEZIG_LOSSEN = 'bezig_lossen', 'Bezig met lossen'


class RegelSoort(models.TextChoices):
    LADEN = 'laden', 'Laden'
    LOSSEN = 'lossen', 'Lossen'


RITNUMMER_PREFIX = 'DHO-'
RITNUMMER_START = 10000001


def volgend_ritnummer():
    """Hoogste bestaande nummer plus een; alle nummers zijn even lang zodat sorteren klopt."""
    laatste = (
        Opdracht.objects
        .filter(ritnummer__startswith=RITNUMMER_PREFIX)
        .order_by('-ritnummer')
        .values_list('ritnummer', flat=True)
        .first()
    )
    volgnummer = RITNUMMER_START
    if laatste:
        try:
            volgnummer = int(laatste[len(RITNUMMER_PREFIX):]) + 1
        except ValueError:
            pass
    return f'{RITNUMMER_PREFIX}{volgnummer}'


class Opdracht(models.Model):
    """Eén afleveropdracht voor één chauffeur."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    bedrijf = models.ForeignKey(
        'companies.Company', on_delete=models.CASCADE,
        related_name='opdrachten', verbose_name='Opdrachtgever'
    )
    aangemaakt_door = models.ForeignKey(
        'accounts.User', on_delete=models.PROTECT,
        related_name='aangemaakte_opdrachten', verbose_name='Aangemaakt door'
    )
    chauffeur = models.ForeignKey(
        'drivers.Driver', on_delete=models.PROTECT,
        related_name='opdrachten', verbose_name='Chauffeur'
    )

    ritnummer = models.CharField(
        max_length=30, unique=True, blank=True, null=True, verbose_name='Ritnummer'
    )

    # Afleveradres
    klant_naam = models.CharField(max_length=200, verbose_name='Bedrijfsnaam')
    adres = models.CharField(max_length=255, verbose_name='Adres')
    postcode = models.CharField(max_length=10, blank=True, verbose_name='Postcode')
    plaats = models.CharField(max_length=100, blank=True, verbose_name='Plaats')
    contactpersoon = models.CharField(max_length=200, blank=True, verbose_name='Contactpersoon')
    telefoon = models.CharField(max_length=30, blank=True, verbose_name='Telefoonnummer')
    notitie = models.TextField(blank=True, verbose_name='Notitie')
    geopend_tot = models.TimeField(null=True, blank=True, verbose_name='Geopend tot')

    volgorde = models.PositiveIntegerField(default=0, verbose_name='Volgorde')
    status = models.CharField(
        max_length=20, choices=OpdrachtStatus.choices,
        default=OpdrachtStatus.NIEUW, verbose_name='Status'
    )

    gestart_op = models.DateTimeField(null=True, blank=True, verbose_name='Gestart op')

    # Wat de chauffeur op dit adres moet doen. Bestaande opdrachten waren altijd
    # bezorgingen, vandaar dat lossen standaard aan staat.
    werk_laden = models.BooleanField(default=False, verbose_name='Laden/ophalen')
    werk_lossen = models.BooleanField(default=True, verbose_name='Lossen/bezorgen')

    fase = models.CharField(
        max_length=20, choices=OpdrachtFase.choices,
        default=OpdrachtFase.ONDERWEG, verbose_name='Fase'
    )
    aangekomen_op = models.DateTimeField(null=True, blank=True, verbose_name='Aangekomen op')
    aangekomen_automatisch = models.BooleanField(
        default=False, verbose_name='Aankomst automatisch vastgesteld'
    )
    wachten_sinds = models.DateTimeField(null=True, blank=True, verbose_name='Wacht op klant sinds')
    laden_gestart_op = models.DateTimeField(
        null=True, blank=True, verbose_name='Begonnen met laden op'
    )
    lossen_gestart_op = models.DateTimeField(
        null=True, blank=True, verbose_name='Begonnen met lossen op'
    )
    afgeleverd_op = models.DateTimeField(null=True, blank=True, verbose_name='Afgeleverd op')
    ingetrokken_op = models.DateTimeField(null=True, blank=True, verbose_name='Ingetrokken op')
    niet_geleverd_op = models.DateTimeField(
        null=True, blank=True, verbose_name='Niet geleverd op'
    )
    niet_geleverd_reden = models.TextField(blank=True, verbose_name='Reden niet geleverd')

    # Leeg betekent: laatste melding is verstuurd of er hoefde niets verstuurd te worden.
    laatste_mail_fout = models.CharField(
        max_length=255, blank=True, verbose_name='Laatste mailfout'
    )

    chauffeur_reactie = models.TextField(blank=True, verbose_name='Reactie chauffeur')
    # Vastgelegd bij het afmelden, zodat een latere voertuigwissel de opdracht niet verandert.
    kenteken = models.CharField(max_length=20, blank=True, verbose_name='Kenteken')

    # Aankomstvoorspelling: bestemming wordt eenmalig gegeocodeerd, de rest komt
    # van de GPS-positie en de routeplanner.
    bestemming_lat = models.FloatField(null=True, blank=True)
    bestemming_lng = models.FloatField(null=True, blank=True)
    eta_aankomst = models.DateTimeField(null=True, blank=True, verbose_name='Verwachte aankomst')
    eta_minuten = models.PositiveIntegerField(null=True, blank=True, verbose_name='Minuten te gaan')
    eta_start_minuten = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Minuten bij de start'
    )
    eta_afstand_km = models.FloatField(null=True, blank=True, verbose_name='Afstand te gaan (km)')
    eta_bijgewerkt_op = models.DateTimeField(null=True, blank=True)
    eta_fout = models.CharField(max_length=120, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Opdracht'
        verbose_name_plural = 'Opdrachten'
        ordering = ['volgorde', 'created_at']
        indexes = [
            models.Index(fields=['bedrijf', 'status']),
            models.Index(fields=['chauffeur', 'status']),
            models.Index(fields=['-created_at']),
        ]

    def __str__(self):
        return f'{self.klant_naam} ({self.get_status_display()})'

    def save(self, *args, **kwargs):
        if not self.ritnummer:
            # Twee gelijktijdige aanmaken kunnen hetzelfde nummer pakken; dan opnieuw proberen.
            for _ in range(5):
                self.ritnummer = volgend_ritnummer()
                try:
                    with transaction.atomic():
                        return super().save(*args, **kwargs)
                except IntegrityError:
                    kwargs.pop('force_insert', None)
            raise IntegrityError('Kon geen vrij ritnummer bepalen.')
        return super().save(*args, **kwargs)

    @property
    def is_actief_voor_chauffeur(self):
        return self.status in (OpdrachtStatus.NIEUW, OpdrachtStatus.GESTART)

    @property
    def is_afgehandeld(self):
        return self.status in (OpdrachtStatus.AFGELEVERD, OpdrachtStatus.NIET_GELEVERD)

    @property
    def werksoort(self):
        """'laden', 'lossen', 'beide' of 'geen'."""
        if self.werk_laden and self.werk_lossen:
            return 'beide'
        if self.werk_laden:
            return 'laden'
        if self.werk_lossen:
            return 'lossen'
        return 'geen'

    @property
    def werk_omschrijving(self):
        return {
            'laden': 'Laden',
            'lossen': 'Lossen',
            'beide': 'Laden en lossen',
            'geen': 'Lossen',
        }[self.werksoort]

    @property
    def is_ter_plaatse(self):
        return self.fase in (
            OpdrachtFase.AANGEKOMEN,
            OpdrachtFase.WACHTEN,
            OpdrachtFase.BEZIG_LADEN,
            OpdrachtFase.BEZIG_LOSSEN,
        )

    @property
    def is_bezig(self):
        return self.fase in (OpdrachtFase.BEZIG_LADEN, OpdrachtFase.BEZIG_LOSSEN)


class OpdrachtRegel(models.Model):
    """Eén regel werk bij een opdracht, bijvoorbeeld 'HMMU6426781 - PEAR 999 BOX - 9 PLT'."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    opdracht = models.ForeignKey(
        Opdracht, on_delete=models.CASCADE,
        related_name='regels', verbose_name='Opdracht'
    )
    ordernummer = models.CharField(max_length=60, blank=True, verbose_name='Ordernummer')
    omschrijving = models.CharField(max_length=255, blank=True, verbose_name='Detail')
    aantal_pallets = models.PositiveIntegerField(
        null=True, blank=True, verbose_name='Aantal pallets'
    )
    # Leeg mag: niet elke opdrachtgever splitst zijn regels naar laden en lossen.
    soort = models.CharField(
        max_length=10, choices=RegelSoort.choices, blank=True, verbose_name='Soort'
    )
    volgorde = models.PositiveIntegerField(default=0, verbose_name='Volgorde')

    class Meta:
        verbose_name = 'Opdrachtregel'
        verbose_name_plural = 'Opdrachtregels'
        ordering = ['volgorde', 'ordernummer']

    def __str__(self):
        delen = [self.ordernummer, self.omschrijving]
        if self.aantal_pallets is not None:
            delen.append(f'{self.aantal_pallets} PLT')
        return ' - '.join(d for d in delen if d)


class OpdrachtBijlage(models.Model):
    """Bestand bij een opdracht, van de opdrachtgever of van de chauffeur."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    opdracht = models.ForeignKey(
        Opdracht, on_delete=models.CASCADE,
        related_name='bijlagen', verbose_name='Opdracht'
    )
    bestand = models.FileField(upload_to=opdracht_bijlage_pad, verbose_name='Bestand')
    bestandsnaam = models.CharField(max_length=255, verbose_name='Bestandsnaam')
    geupload_door = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True,
        related_name='opdracht_bijlagen', verbose_name='Geüpload door'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = 'Opdrachtbijlage'
        verbose_name_plural = 'Opdrachtbijlagen'
        ordering = ['created_at']

    def __str__(self):
        return self.bestandsnaam


class OpdrachtKlant(models.Model):
    """Adresboek van de opdrachtgever: zijn eigen klanten."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bedrijf = models.ForeignKey(
        'companies.Company', on_delete=models.CASCADE,
        related_name='opdracht_klanten', verbose_name='Opdrachtgever'
    )
    naam = models.CharField(max_length=200, verbose_name='Bedrijfsnaam')
    adres = models.CharField(max_length=255, blank=True, verbose_name='Adres')
    postcode = models.CharField(max_length=10, blank=True, verbose_name='Postcode')
    plaats = models.CharField(max_length=100, blank=True, verbose_name='Plaats')
    contactpersoon = models.CharField(max_length=200, blank=True, verbose_name='Contactpersoon')
    telefoon = models.CharField(max_length=30, blank=True, verbose_name='Telefoonnummer')
    notitie = models.TextField(blank=True, verbose_name='Notitie')
    geopend_tot = models.TimeField(null=True, blank=True, verbose_name='Geopend tot')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Klant van opdrachtgever'
        verbose_name_plural = 'Klanten van opdrachtgevers'
        ordering = ['naam']
        constraints = [
            models.UniqueConstraint(
                fields=['bedrijf', 'naam'], name='uniek_klant_per_opdrachtgever'
            ),
        ]

    def __str__(self):
        return self.naam


class OpdrachtMailInstelling(models.Model):
    """Per opdrachtgever instellen wie welke melding krijgt."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bedrijf = models.OneToOneField(
        'companies.Company', on_delete=models.CASCADE,
        related_name='opdracht_mailinstelling', verbose_name='Opdrachtgever'
    )
    # Alleen een beheerder mag dit wijzigen; het bepaalt vanaf welk adres wij versturen.
    afzender = models.EmailField(
        default='info@moveo-bv.nl', verbose_name='Afzender'
    )
    ontvangers = models.JSONField(
        default=list, blank=True, verbose_name='Ontvangers',
        help_text='E-mailadressen die een melding krijgen.'
    )
    mail_bij_start = models.BooleanField(default=True, verbose_name='Mail bij starten')
    mail_bij_aflevering = models.BooleanField(default=True, verbose_name='Mail bij afleveren')
    mail_bij_niet_geleverd = models.BooleanField(
        default=True, verbose_name='Mail bij niet geleverd'
    )
    taal = models.CharField(
        max_length=5, choices=MAIL_TALEN, default='nl', verbose_name='Taal van de mail'
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = 'Mailinstelling opdrachten'
        verbose_name_plural = 'Mailinstellingen opdrachten'

    def __str__(self):
        return f'Mailinstelling {self.bedrijf.naam}'

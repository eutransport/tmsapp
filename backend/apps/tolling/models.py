"""Models voor de Tolheffing-import module.

- `TollingImportBatch`: metadata over een CSV upload.
- `TollingEvent`: individueel toll-event (per rit) uit de CSV.

Kentekens worden opgeslagen in de originele CSV-vorm (raw) én
een genormaliseerde variant (alleen alfanumeriek, upper case) zodat
we kunnen matchen met `Vehicle.kenteken` waar streepjes in staan.
"""
import re
import uuid
from datetime import time

from django.conf import settings
from django.db import models


def normalize_plate(value: str) -> str:
    if not value:
        return ''
    return re.sub(r'[^A-Z0-9]', '', value.upper())


class TollingImportBatch(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name='tolling_import_batches',
    )
    filename = models.CharField(max_length=255, blank=True)
    rows_total = models.PositiveIntegerField(default=0)
    rows_imported = models.PositiveIntegerField(default=0)
    rows_duplicate = models.PositiveIntegerField(default=0)
    rows_invalid = models.PositiveIntegerField(default=0)
    # Passages van 0 euro worden niet doorbelast en dus niet opgeslagen; ze
    # worden hier geteld zodat zichtbaar blijft wat er is overgeslagen.
    rows_zero_amount = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Tolheffing import batch'
        verbose_name_plural = 'Tolheffing import batches'

    def __str__(self) -> str:
        return f"{self.filename or 'batch'} ({self.rows_imported}/{self.rows_total})"


class TollingEvent(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    batch = models.ForeignKey(
        TollingImportBatch,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='events',
    )
    start_at = models.DateTimeField(verbose_name='Startdatum')
    end_at = models.DateTimeField(verbose_name='Einddatum')
    distance_km = models.DecimalField(max_digits=10, decimal_places=3, verbose_name='Afstand (km)')
    amount = models.DecimalField(max_digits=10, decimal_places=2, verbose_name='Bedrag')
    license_plate_raw = models.CharField(max_length=32, verbose_name='Kenteken (bron)')
    license_plate_normalized = models.CharField(max_length=32, db_index=True, verbose_name='Kenteken (genormaliseerd)')
    obu = models.CharField(max_length=64, blank=True, verbose_name='OBU')

    # --- Momentopname van de vloot op het moment van importeren ---------
    # Het ritnummer van een wagen kan later wijzigen (bijvoorbeeld omdat de
    # wagen op een andere rit wordt ingezet). Door het ritnummer, de wagen en
    # het bedrijf hier vast te leggen blijft de historie kloppen: eerder
    # geïmporteerde regels houden de rit waarop ze destijds gereden zijn.
    vehicle = models.ForeignKey(
        'fleet.Vehicle',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tolling_events',
        verbose_name='Voertuig',
    )
    ritnummer = models.CharField(
        max_length=50,
        blank=True,
        db_index=True,
        verbose_name='Ritnummer',
        help_text='Ritnummer van de wagen op het moment van importeren.',
    )
    bedrijf = models.ForeignKey(
        'companies.Company',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tolling_events',
        verbose_name='Bedrijf',
    )

    invoice_line = models.ForeignKey(
        'invoicing.InvoiceLine',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tolling_events',
    )
    invoiced_at = models.DateTimeField(null=True, blank=True, verbose_name='Gefactureerd op')

    private_registration = models.ForeignKey(
        'tolling.PrivateTollRegistration',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='matched_events',
        verbose_name='Privé registratie',
    )
    is_private = models.BooleanField(default=False, db_index=True, verbose_name='Privé rit')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_at']
        verbose_name = 'Tolheffing event'
        verbose_name_plural = 'Tolheffing events'
        constraints = [
            models.UniqueConstraint(
                fields=['start_at', 'end_at', 'license_plate_normalized', 'amount', 'obu'],
                name='tolling_event_unique_fingerprint',
            ),
        ]
        indexes = [
            models.Index(fields=['license_plate_normalized', 'start_at']),
            models.Index(fields=['invoiced_at']),
            models.Index(fields=['license_plate_normalized', 'ritnummer']),
        ]

    def __str__(self) -> str:
        return f"{self.license_plate_raw} {self.start_at:%d-%m-%Y %H:%M} €{self.amount}"


class PrivateTollRegistration(models.Model):
    """Registratie door een chauffeur van privé-gebruik van een voertuig.

    De chauffeur geeft datum + start/eind tijd + kenteken op. Alle geïmporteerde
    TollingEvents die binnen dit tijdsvenster en op dit kenteken vallen worden
    automatisch als privé gemarkeerd en niet meegefactureerd.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='private_toll_registrations',
        verbose_name='Chauffeur',
    )
    datum = models.DateField(verbose_name='Datum')
    begin_tijd = models.TimeField(verbose_name='Begintijd')
    eind_tijd = models.TimeField(verbose_name='Eindtijd')
    license_plate_raw = models.CharField(max_length=32, verbose_name='Kenteken')
    license_plate_normalized = models.CharField(max_length=32, db_index=True, verbose_name='Kenteken (genormaliseerd)')
    notitie = models.CharField(max_length=255, blank=True, verbose_name='Notitie')
    admin_invoiced = models.BooleanField(default=False, db_index=True, verbose_name='Gefactureerd aan chauffeur')
    admin_invoiced_at = models.DateTimeField(null=True, blank=True, verbose_name='Gefactureerd op')
    admin_invoiced_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='private_toll_admin_invoiced',
        verbose_name='Gemarkeerd door',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-datum', '-begin_tijd']
        verbose_name = 'Privé tolregistratie'
        verbose_name_plural = 'Privé tolregistraties'
        indexes = [
            models.Index(fields=['user', 'datum']),
            models.Index(fields=['license_plate_normalized', 'datum']),
        ]

    def __str__(self) -> str:
        return f"{self.user} {self.datum} {self.begin_tijd}-{self.eind_tijd} {self.license_plate_raw}"

    def save(self, *args, **kwargs):
        if self.license_plate_raw and not self.license_plate_normalized:
            self.license_plate_normalized = normalize_plate(self.license_plate_raw)
        super().save(*args, **kwargs)


class RitnummerCorrectie(models.Model):
    """Vastlegging van een terugwerkende ritnummerwijziging op tolregels.

    Per correctie bewaren we van elke aangeraakte regel het oude ritnummer, in
    ``oude_waarden`` als ``{tolregel-id: oud ritnummer}``. Alleen zo kan een
    correctie ook teruggedraaid worden wanneer er in de periode verschillende
    ritnummers door elkaar stonden. Correcties worden na een maand automatisch
    opgeruimd.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    license_plate_normalized = models.CharField(
        max_length=32, db_index=True, verbose_name='Kenteken (genormaliseerd)')
    license_plate_raw = models.CharField(max_length=32, blank=True, verbose_name='Kenteken')
    van = models.DateField(verbose_name='Van')
    tot = models.DateField(verbose_name='Tot en met')
    van_ritnummer = models.CharField(
        max_length=50, null=True, blank=True,
        verbose_name='Alleen dit oude ritnummer',
        help_text='Leeg betekent: alle ritnummers in de periode.')
    naar_ritnummer = models.CharField(max_length=50, verbose_name='Nieuw ritnummer')
    inclusief_gefactureerd = models.BooleanField(
        default=False, verbose_name='Ook gefactureerde regels')
    aantal = models.PositiveIntegerField(default=0, verbose_name='Aantal regels')
    oude_waarden = models.JSONField(default=dict, verbose_name='Oude ritnummers per regel')
    uitgevoerd_door = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='ritnummer_correcties', verbose_name='Uitgevoerd door')
    uitgevoerd_op = models.DateTimeField(auto_now_add=True, db_index=True,
                                         verbose_name='Uitgevoerd op')
    teruggedraaid_op = models.DateTimeField(null=True, blank=True,
                                            verbose_name='Teruggedraaid op')
    teruggedraaid_door = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='ritnummer_correcties_teruggedraaid', verbose_name='Teruggedraaid door')
    teruggedraaid_aantal = models.PositiveIntegerField(
        default=0, verbose_name='Aantal teruggezette regels')

    class Meta:
        ordering = ['-uitgevoerd_op']
        verbose_name = 'Ritnummercorrectie'
        verbose_name_plural = 'Ritnummercorrecties'
        indexes = [models.Index(fields=['license_plate_normalized', '-uitgevoerd_op'])]

    def __str__(self) -> str:
        return (f'{self.license_plate_normalized} {self.van}..{self.tot} '
                f'-> {self.naar_ritnummer} ({self.aantal} regels)')


class TolAfrekening(models.Model):
    """Een van de opdrachtgever ontvangen afrekening met tolvergoeding.

    De opdrachtgever stuurt per periode een PDF met per voertuig het bedrag dat
    hij ons voor tolheffing vergoedt (de 'Maut'). Hier bewaren we wat er in dat
    bestand stond; de vergelijking met onze eigen tolregels wordt steeds
    opnieuw berekend zodat latere tolimports en correcties meetellen.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    bestandsnaam = models.CharField(max_length=255, blank=True, verbose_name='Bestandsnaam')
    bestand = models.FileField(
        upload_to='tolling/afrekeningen/%Y/%m/', null=True, blank=True,
        verbose_name='Bestand')
    bedrijf = models.ForeignKey(
        'companies.Company', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='tol_afrekeningen', verbose_name='Opdrachtgever')
    bonnummer = models.CharField(max_length=64, blank=True, verbose_name='Bonnummer')
    klantnummer = models.CharField(max_length=64, blank=True, verbose_name='Klantnummer')
    factuurdatum = models.DateField(null=True, blank=True, verbose_name='Factuurdatum')
    periode_van = models.DateField(verbose_name='Periode van')
    periode_tot = models.DateField(verbose_name='Periode tot en met')

    # De werkdagvensters waarbinnen de vergoeding van de opdrachtgever geldt.
    werktijd_van = models.TimeField(default=time(6, 0), verbose_name='Werktijd van')
    werktijd_tot = models.TimeField(default=time(18, 0), verbose_name='Werktijd tot')

    totaal_netto = models.DecimalField(
        max_digits=12, decimal_places=2, default=0, verbose_name='Totaal netto')
    totaal_maut = models.DecimalField(
        max_digits=12, decimal_places=2, default=0, verbose_name='Totaal tolvergoeding')
    waarschuwingen = models.JSONField(default=list, blank=True, verbose_name='Waarschuwingen')

    geuploaded_door = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name='tol_afrekeningen', verbose_name='Geupload door')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-periode_van', '-created_at']
        verbose_name = 'Tolafrekening opdrachtgever'
        verbose_name_plural = 'Tolafrekeningen opdrachtgever'
        constraints = [
            # Dezelfde bon twee keer inlezen levert dubbele bedragen op.
            models.UniqueConstraint(
                fields=['bonnummer', 'periode_van', 'periode_tot'],
                condition=models.Q(bonnummer__gt=''),
                name='tol_afrekening_unieke_bon',
            ),
        ]
        indexes = [models.Index(fields=['periode_van', 'periode_tot'])]

    def __str__(self) -> str:
        return f'{self.bonnummer or self.bestandsnaam} ({self.periode_van}..{self.periode_tot})'


class TolAfrekeningRegel(models.Model):
    """Een voertuigregel van de afrekening, gekoppeld aan onze eigen wagen."""

    class Koppeling(models.TextChoices):
        GEKOPPELD = 'gekoppeld', 'Gekoppeld'
        GEEN_VOERTUIG = 'geen_voertuig', 'Ritnummer onbekend'
        MEERDERE = 'meerdere', 'Meerdere voertuigen'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    afrekening = models.ForeignKey(
        TolAfrekening, on_delete=models.CASCADE, related_name='regels')
    regelnummer = models.CharField(max_length=8, blank=True, verbose_name='Regelnummer')
    voertuig_label = models.CharField(max_length=64, verbose_name='Voertuig op afrekening')
    ritnummer = models.CharField(max_length=50, db_index=True, verbose_name='Ritnummer')

    inzetdagen = models.PositiveIntegerField(default=0, verbose_name='Inzetdagen')
    ritten = models.PositiveIntegerField(default=0, verbose_name='Aantal ritten')
    kilometers = models.DecimalField(
        max_digits=12, decimal_places=2, default=0, verbose_name='Kilometers')
    netto_bedrag = models.DecimalField(
        max_digits=12, decimal_places=2, default=0, verbose_name='Netto bedrag')
    dagforfait = models.DecimalField(
        max_digits=12, decimal_places=2, default=0, verbose_name='Dagforfait')
    brandstoftoeslag = models.DecimalField(
        max_digits=12, decimal_places=2, default=0, verbose_name='Brandstoftoeslag')
    maut_ontvangen = models.DecimalField(
        max_digits=12, decimal_places=2, default=0, verbose_name='Ontvangen tolvergoeding')
    maut_gevonden = models.BooleanField(default=False, verbose_name='Tolvergoeding op afrekening')

    vehicle = models.ForeignKey(
        'fleet.Vehicle', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='tol_afrekening_regels', verbose_name='Voertuig')
    kenteken = models.CharField(max_length=64, blank=True, verbose_name='Kenteken')
    # Een ritnummer hoort bij een wagen, maar staat er per ongeluk op twee,
    # dan tellen de tolregels van beide mee. Daarom een lijst.
    kentekens = models.JSONField(
        default=list, blank=True, verbose_name='Kentekens (genormaliseerd)')
    koppeling = models.CharField(
        max_length=20, choices=Koppeling.choices, default=Koppeling.GEEN_VOERTUIG,
        verbose_name='Koppeling')

    dagen = models.JSONField(default=list, blank=True, verbose_name='Dagregels')

    class Meta:
        ordering = ['afrekening', 'regelnummer']
        verbose_name = 'Tolafrekening regel'
        verbose_name_plural = 'Tolafrekening regels'
        constraints = [
            models.UniqueConstraint(
                fields=['afrekening', 'voertuig_label'],
                name='tol_afrekening_regel_uniek_voertuig',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.voertuig_label} -> {self.kenteken or "?"} (EUR {self.maut_ontvangen})'

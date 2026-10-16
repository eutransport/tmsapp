"""Zet een ingelezen Radius-factuur om in tolheffing-events.

Staat bewust los van `services.import_csv`: de bestaande CSV-import blijft
ongewijzigd werken. Wel hergebruiken we daar de vlootopzoeking en de
ritnummer-momentopname uit, zodat beide routes dezelfde historie opbouwen.

Per factuurregel wordt gezocht naar de GPS-rit die op dat tijdstip liep. Die
levert twee dingen: de gereden kilometers en het land van de passage. Zonder
rit wordt de regel wel ingelezen, maar zonder kilometers en zonder land.
"""
import logging
from dataclasses import dataclass, field
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.fleet.bedrijven import bouw_bedrijf_index, zoek_bedrijf_in_index
from apps.fleet.ritnummers import bouw_ritnummer_index, zoek_in_index

from .km_bepaling import BRON_TARIEF, bouw_tarieftabel, maand_van
from .planning_koppeling import BRON_VOERTUIG, koppel_events
from .land_bepaling import BRON_FACTUUR, bepaal_land, land_van_rit, zoek_rit
from .models import TollingEvent, TollingImportBatch, normalize_plate
from .services import build_vehicle_lookup, filter_reeds_aanwezig

logger = logging.getLogger(__name__)

# De factuur noemt alleen het tijdstip van de passage, geen eindtijd. We geven
# elk event een venster van een minuut, net als de handmatige import-CSV.
PASSAGE_DUUR = timedelta(minutes=1)
# Speling waarmee een passage nog bij een GPS-rit mag horen.
STANDAARD_SPELING_MINUTEN = 5


@dataclass
class RegelAnalyse:
    datum: str
    tijdstip: str
    kenteken: str
    kenteken_genormaliseerd: str
    bedrag: Decimal
    kaartnummer: str
    product: str
    land: str = ''
    land_bron: str = ''
    afstand_km: Decimal | None = None
    km_bron: str = ''
    gps_km: Decimal | None = None
    rit_venster: str = ''
    voertuig_bekend: bool = False
    ritnummer: str = ''
    bedrijf: str = ''
    bestaat_al: bool = False
    opmerking: str = ''


@dataclass
class ImportAnalyse:
    factuurnummer: str = ''
    factuurdatum: str = ''
    regels: list = field(default_factory=list)

    @property
    def totaal_bedrag(self) -> Decimal:
        return sum((r.bedrag for r in self.regels), Decimal('0'))

    def per_land(self) -> dict:
        totalen: dict = {}
        for regel in self.regels:
            sleutel = regel.land or 'onbekend'
            huidig = totalen.setdefault(sleutel, {'regels': 0, 'bedrag': Decimal('0'),
                                                  'km': Decimal('0')})
            huidig['regels'] += 1
            huidig['bedrag'] += regel.bedrag
            huidig['km'] += regel.afstand_km or Decimal('0')
        return totalen

def _aware(moment):
    """Maak een naief tijdstip uit de factuur bewust van de lokale tijdzone."""
    if timezone.is_aware(moment):
        return moment
    return timezone.make_aware(moment, timezone.get_current_timezone())


def _bedrijfsnamen(bedrijf_index) -> dict:
    """{bedrijf_id: naam}, ook voor wagens die nog geen periode hebben."""
    from apps.companies.models import Company

    return dict(Company.objects.values_list('pk', 'naam'))


def _land_van_regel(regel, rit, start):
    """Het land van de bron wint; de GPS-rit is de terugval."""
    land = (getattr(regel, 'land', '') or '').strip().upper()
    if len(land) == 2:
        return land, BRON_FACTUUR
    if rit is not None:
        return land_van_rit(rit, start)
    return '', ''


def analyseer(factuur, speling_minuten: int = STANDAARD_SPELING_MINUTEN) -> ImportAnalyse:
    """Bekijk wat een import zou opleveren, zonder iets op te slaan."""
    analyse = ImportAnalyse(
        factuurnummer=factuur.factuurnummer,
        factuurdatum=factuur.factuurdatum,
    )
    vlootopzoeking = build_vehicle_lookup()
    wagen_ids = {v.pk for v in vlootopzoeking.values() if v is not None}
    ritnummer_index = bouw_ritnummer_index(wagen_ids)
    bedrijf_index = bouw_bedrijf_index(wagen_ids)
    bedrijfsnamen = _bedrijfsnamen(bedrijf_index)
    tijdzone = timezone.get_current_timezone()
    tarieven = bouw_tarieftabel()

    for regel in factuur.tolregels:
        kenteken_norm = normalize_plate(regel.kenteken)
        start = _aware(regel.tijdstempel)
        voertuig = vlootopzoeking.get(kenteken_norm)

        rit = zoek_rit(kenteken_norm, start, speling_minuten)
        land, land_bron = _land_van_regel(regel, rit, start)
        gps_km = None
        venster = ''
        if rit is not None:
            gps_km = Decimal(str(rit.distance_km or 0))
            venster = (
                f'{timezone.localtime(rit.start_time, tijdzone):%H:%M}-'
                f'{timezone.localtime(rit.end_time, tijdzone):%H:%M}'
                if rit.end_time else ''
            )
        # De GPS-rit loopt ook over tolvrije wegen; terugrekenen uit het
        # bedrag geeft de werkelijk getolde afstand.
        afstand = tarieven.kilometers(kenteken_norm, maand_van(start), regel.totaal)
        km_bron = BRON_TARIEF if afstand is not None else ''

        passagedatum = timezone.localtime(start, tijdzone).date()
        bestaat = TollingEvent.objects.filter(
            start_at=start,
            end_at=start + PASSAGE_DUUR,
            license_plate_normalized=kenteken_norm,
            amount=regel.totaal,
            obu=regel.kaartnummer or '',
        ).exists()

        opmerkingen = []
        if voertuig is None:
            opmerkingen.append('kenteken niet in de vloot')
        if afstand is None:
            opmerkingen.append('geen tarief bekend voor km')
        if rit is None:
            opmerkingen.append('geen GPS-rit gevonden')
        if bestaat:
            opmerkingen.append('al ingelezen')

        analyse.regels.append(RegelAnalyse(
            datum=regel.datum,
            tijdstip=regel.tijdstip,
            kenteken=regel.kenteken,
            kenteken_genormaliseerd=kenteken_norm,
            bedrag=regel.totaal,
            kaartnummer=regel.kaartnummer,
            product=regel.product,
            land=land,
            land_bron=land_bron,
            afstand_km=afstand,
            km_bron=km_bron,
            gps_km=gps_km,
            rit_venster=venster,
            voertuig_bekend=voertuig is not None,
            ritnummer=zoek_in_index(ritnummer_index, voertuig, passagedatum),
            bedrijf=bedrijfsnamen.get(
                zoek_bedrijf_in_index(bedrijf_index, voertuig, passagedatum), ''),
            bestaat_al=bestaat,
            opmerking=', '.join(opmerkingen),
        ))
    return analyse


@dataclass
class ImportUitkomst:
    batch: TollingImportBatch
    totaal: int = 0
    geimporteerd: int = 0
    duplicaten: int = 0
    ongeldig: int = 0
    zonder_bedrag: int = 0
    zonder_gps: int = 0
    zonder_km: int = 0


def importeer(factuur, user, filename: str = '',
              speling_minuten: int = STANDAARD_SPELING_MINUTEN) -> ImportUitkomst:
    """Sla de tolregels van een Radius-factuur op als tolheffing-events."""
    batch = TollingImportBatch.objects.create(
        uploaded_by=user if getattr(user, 'is_authenticated', False) else None,
        filename=filename or f'Radius factuur {factuur.factuurnummer}'.strip(),
    )

    vlootopzoeking = build_vehicle_lookup()
    wagen_ids = {v.pk for v in vlootopzoeking.values() if v is not None}
    ritnummer_index = bouw_ritnummer_index(wagen_ids)
    bedrijf_index = bouw_bedrijf_index(wagen_ids)
    tijdzone = timezone.get_current_timezone()
    tarieven = bouw_tarieftabel()

    uitkomst = ImportUitkomst(batch=batch)
    nieuwe: list[TollingEvent] = []

    for regel in factuur.tolregels:
        uitkomst.totaal += 1
        kenteken_norm = normalize_plate(regel.kenteken)
        if not kenteken_norm or regel.totaal is None:
            uitkomst.ongeldig += 1
            continue
        # Passages van nul euro worden niet doorbelast; net als bij de
        # CSV-import slaan we die over zodat de totalen blijven kloppen.
        if regel.totaal == 0:
            uitkomst.zonder_bedrag += 1
            continue

        start = _aware(regel.tijdstempel)
        rit = zoek_rit(kenteken_norm, start, speling_minuten)
        land, land_bron = _land_van_regel(regel, rit, start)
        if rit is None:
            uitkomst.zonder_gps += 1

        afstand = tarieven.kilometers(kenteken_norm, land, regel.totaal)
        if afstand is None:
            uitkomst.zonder_km += 1
            afstand, km_bron = Decimal('0'), ''
        else:
            km_bron = BRON_TARIEF

        voertuig = vlootopzoeking.get(kenteken_norm)
        passagedatum = timezone.localtime(start, tijdzone).date()

        nieuwe.append(TollingEvent(
            batch=batch,
            start_at=start,
            end_at=start + PASSAGE_DUUR,
            distance_km=afstand,
            amount=regel.totaal,
            license_plate_raw=regel.kenteken,
            license_plate_normalized=kenteken_norm,
            obu=regel.kaartnummer or '',
            land=land,
            land_bron=land_bron,
            km_bron=km_bron,
            vehicle=voertuig,
            ritnummer=zoek_in_index(ritnummer_index, voertuig, passagedatum),
            bedrijf_id=zoek_bedrijf_in_index(bedrijf_index, voertuig, passagedatum),
            rit_bron=BRON_VOERTUIG,
        ))

    if nieuwe:
        nieuwe, uitkomst.duplicaten = filter_reeds_aanwezig(nieuwe)
    if nieuwe:
        try:
            with transaction.atomic():
                TollingEvent.objects.bulk_create(nieuwe)
                uitkomst.geimporteerd = len(nieuwe)
        except IntegrityError:
            # Eén of meer regels bestonden al; per regel opslaan om te tellen.
            for event in nieuwe:
                try:
                    with transaction.atomic():
                        event.save()
                        uitkomst.geimporteerd += 1
                except IntegrityError:
                    uitkomst.duplicaten += 1

    batch.rows_total = uitkomst.totaal
    batch.rows_imported = uitkomst.geimporteerd
    batch.rows_duplicate = uitkomst.duplicaten
    batch.rows_invalid = uitkomst.ongeldig
    batch.rows_zero_amount = uitkomst.zonder_bedrag
    batch.save(update_fields=['rows_total', 'rows_imported', 'rows_duplicate',
                              'rows_invalid', 'rows_zero_amount'])

    try:
        from .services import match_events_to_private_registrations
        match_events_to_private_registrations(TollingEvent.objects.filter(batch=batch))
    except Exception as exc:  # pragma: no cover - mag de import niet blokkeren
        logger.warning('Privé-tolregistratie matching mislukt voor batch %s: %s', batch.id, exc)

    try:
        koppel_events(list(TollingEvent.objects.filter(batch=batch)))
    except Exception as exc:  # pragma: no cover - mag de import niet blokkeren
        logger.warning('Planningkoppeling mislukt voor batch %s: %s', batch.id, exc)

    return uitkomst


def vul_land_aan(events_qs, speling_minuten: int = STANDAARD_SPELING_MINUTEN) -> int:
    """Bepaal alsnog het land van eerder ingelezen events.

    Handig zodra het GPS-archief verder terugloopt dan op het moment van
    importeren. Handmatig gezette landen blijven staan.
    """
    bijgewerkt = 0
    for event in events_qs.exclude(land_bron='handmatig').iterator():
        land, bron = bepaal_land(event.license_plate_normalized, event.start_at, speling_minuten)
        if land and (land != event.land or bron != event.land_bron):
            event.land = land
            event.land_bron = bron
            event.save(update_fields=['land', 'land_bron'])
            bijgewerkt += 1
    return bijgewerkt

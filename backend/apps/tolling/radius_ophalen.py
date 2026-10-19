"""Eén ronde: facturen ophalen, GPS erbij halen, vergelijken en inlezen.

De volgorde is bewust vast:

1. de toltransacties bij Radius ophalen voor de gevraagde periode;
2. de GPS-ritten van diezelfde periode synchroniseren, zodat elke gefactureerde
   passage een rit heeft om aan te koppelen;
3. de tolregels analyseren of inlezen;
4. vergelijken welke gereden dagen nog geen tol hebben en die vastleggen als
   openstaande toldag, zodat een volgende ronde ze gericht kan aanvullen.

Stap 4 is het geheugen van deze module: Radius factureert met vertraging, dus
een wagen die vandaag rijdt heeft morgen pas een tolregel.
"""
import logging
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, Sum
from django.utils import timezone

from apps.tracking.radius_archive_service import sync_alle_koppelingen
from apps.tracking.models import RadiusJourney
from apps.tracking.radius_service import RadiusError

from .models import OpenstaandeTolDag, normalize_plate
from .radius_factuur_parser import Factuur
from .radius_factuur_service import STANDAARD_SPELING_MINUTEN, analyseer, importeer
from .radius_fuel_service import haal_tolregels
from .services import build_vehicle_lookup

logger = logging.getLogger(__name__)

# Zonder opgegeven periode kijken we deze termijn terug.
STANDAARD_PERIODE_DAGEN = 30
# De GPS-sync haalt per dag alle wagens op; een te lange periode laat het
# ophalen minutenlang duren. We begrenzen het en melden dat eerlijk.
MAX_GPS_DAGEN = 92


def _periode(van, tot):
    vandaag = timezone.localdate()
    tot = tot or vandaag
    van = van or (tot - timedelta(days=STANDAARD_PERIODE_DAGEN - 1))
    return van, tot


def _gereden_dagen(van, tot):
    """{(kenteken, datum): {'ritten': n, 'km': Decimal}} uit het GPS-archief."""
    rijen = (RadiusJourney.objects
             .filter(date__gte=van, date__lte=tot)
             .values('plate_number', 'date')
             .annotate(ritten=Count('id'), km=Sum('distance_km')))
    gereden = {}
    for rij in rijen:
        kenteken = normalize_plate(rij['plate_number'])
        if not kenteken:
            continue
        sleutel = (kenteken, rij['date'])
        huidig = gereden.setdefault(sleutel, {'ritten': 0, 'km': Decimal('0')})
        huidig['ritten'] += rij['ritten']
        huidig['km'] += Decimal(str(rij['km'] or 0))
    return gereden


def _gefactureerde_dagen(regels):
    """{(kenteken, datum): {'regels': n, 'bedrag': Decimal}} uit de tolregels."""
    gefactureerd = {}
    for regel in regels:
        kenteken = normalize_plate(regel.kenteken)
        if not kenteken:
            continue
        sleutel = (kenteken, regel.tijdstempel.date())
        huidig = gefactureerd.setdefault(sleutel, {'regels': 0, 'bedrag': Decimal('0')})
        huidig['regels'] += 1
        huidig['bedrag'] += regel.totaal or Decimal('0')
    return gefactureerd


def werk_openstaande_dagen_bij(van, tot, regels):
    """Vergelijk gereden dagen met gefactureerde dagen en houd het verschil bij.

    Openstaande dagen van buiten deze periode worden ook nagelopen: als er nu
    wel een tolregel voor is, mogen ze dicht.
    """
    gereden = _gereden_dagen(van, tot)
    gefactureerd = _gefactureerde_dagen(regels)
    vloot = build_vehicle_lookup()
    nu = timezone.now()

    nieuw = aangevuld = bijgewerkt = 0

    # Elke gereden dag zonder tol blijft of wordt openstaand.
    for (kenteken, datum), cijfers in gereden.items():
        if (kenteken, datum) in gefactureerd:
            continue
        rij, gemaakt = OpenstaandeTolDag.objects.get_or_create(
            kenteken=kenteken, datum=datum,
            defaults={
                'vehicle': vloot.get(kenteken),
                'gps_ritten': cijfers['ritten'],
                'gps_km': cijfers['km'],
            },
        )
        if gemaakt:
            nieuw += 1
            continue
        if rij.status == OpenstaandeTolDag.Status.GENEGEERD:
            continue
        rij.vehicle = rij.vehicle or vloot.get(kenteken)
        rij.gps_ritten = cijfers['ritten']
        rij.gps_km = cijfers['km']
        rij.pogingen += 1
        rij.status = OpenstaandeTolDag.Status.OPEN
        rij.save(update_fields=['vehicle', 'gps_ritten', 'gps_km', 'pogingen',
                                'status', 'laatst_gecontroleerd'])
        bijgewerkt += 1

    # Openstaande dagen die nu wel tol hebben, mogen dicht.
    openstaand = OpenstaandeTolDag.objects.filter(
        afsluiting__isnull=True, status=OpenstaandeTolDag.Status.OPEN)
    for rij in openstaand.iterator():
        cijfers = gefactureerd.get((rij.kenteken, rij.datum))
        if not cijfers:
            continue
        rij.status = OpenstaandeTolDag.Status.AANGEVULD
        rij.aangevuld_op = nu
        rij.tolregels = cijfers['regels']
        rij.tolbedrag = cijfers['bedrag']
        rij.save(update_fields=['status', 'aangevuld_op', 'tolregels', 'tolbedrag',
                                'laatst_gecontroleerd'])
        aangevuld += 1

    nog_open = OpenstaandeTolDag.objects.filter(
        afsluiting__isnull=True, status=OpenstaandeTolDag.Status.OPEN)
    return {
        'gereden_dagen': len(gereden),
        'gefactureerde_dagen': len(gefactureerd),
        'nieuw_openstaand': nieuw,
        'opnieuw_gecontroleerd': bijgewerkt,
        'alsnog_aangevuld': aangevuld,
        'totaal_openstaand': nog_open.count(),
        'oudste_openstaand': (nog_open.order_by('datum')
                              .values_list('datum', flat=True).first()),
    }


def _sync_gps(van, tot):
    """Haal de ritten van de periode op. Een storing mag de import niet blokkeren."""
    dagen = (tot - van).days + 1
    begrensd = dagen > MAX_GPS_DAGEN
    gps_van = tot - timedelta(days=MAX_GPS_DAGEN - 1) if begrensd else van
    try:
        uitkomst = sync_alle_koppelingen(gps_van, tot)
    except RadiusError as exc:
        return {'gelukt': False, 'melding': str(exc), 'date_from': gps_van.isoformat(),
                'date_to': tot.isoformat(), 'begrensd': begrensd}
    uitkomst['gelukt'] = True
    uitkomst['begrensd'] = begrensd
    return uitkomst


def haal_ronde(user, van=None, tot=None, importeren=False,
               speling_minuten=STANDAARD_SPELING_MINUTEN):
    """Doorloop de hele keten en geef terug wat er is gebeurd."""
    van, tot = _periode(van, tot)

    regels, overgeslagen, koppelingen = haal_tolregels(van, tot)

    # De GPS-sync draait ook zonder tolregels: dan leggen we juist vast welke
    # wagens wel gereden hebben en nog op een factuur wachten.
    gps = _sync_gps(van, tot)

    factuur = Factuur(
        factuurnummer='Radius API',
        factuurdatum=timezone.localdate().isoformat(),
        regels=regels,
    )

    resultaat = {
        'date_from': van.isoformat(),
        'date_to': tot.isoformat(),
        'koppelingen': koppelingen,
        'overgeslagen': overgeslagen,
        'gps': gps,
    }

    if importeren:
        naam = f'Radius API {van} t/m {tot}'
        uitkomst = importeer(factuur, user, naam, speling_minuten)
        resultaat['import'] = {
            'batch_id': str(uitkomst.batch.id),
            'totaal': uitkomst.totaal,
            'geimporteerd': uitkomst.geimporteerd,
            'duplicaten': uitkomst.duplicaten,
            'ongeldig': uitkomst.ongeldig,
            'zonder_bedrag': uitkomst.zonder_bedrag,
            'zonder_gps': uitkomst.zonder_gps,
            'zonder_km': uitkomst.zonder_km,
        }
    else:
        analyse = analyseer(factuur, speling_minuten)
        resultaat['analyse'] = analyse

    # Pas vergelijken nadat de GPS binnen is, anders missen we net gereden dagen.
    resultaat['openstaand'] = werk_openstaande_dagen_bij(van, tot, regels)
    return resultaat

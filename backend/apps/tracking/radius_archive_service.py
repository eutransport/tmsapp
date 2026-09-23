"""
Archiefopbouw voor de Radius Velocity ritgeschiedenis.

Radius bewaart zelf ongeveer 30 dagen aan ritten. Door dagelijks te
synchroniseren bouwen we een eigen archief op dat verder terug gaat.
"""
import logging
from datetime import date, timedelta

from django.db import transaction
from django.db.models import Count, Max, Min, Sum
from django.utils import timezone

from .models import RadiusJourney, RadiusSyncLog
from .radius_service import (
    RadiusError,
    get_journeys,
    get_telematics_customers,
)

logger = logging.getLogger('tracking')

# Radius kan ritten met terugwerkende kracht aanvullen; daarom halen we bij een
# dagelijkse sync standaard een paar dagen terug opnieuw op.
STANDAARD_TERUGBLIK_DAGEN = 3


def bepaal_klant_id(customer_id=None):
    """Gebruik de opgegeven klant of de eerste klant met Telematics."""
    if customer_id:
        return str(customer_id)
    klanten = get_telematics_customers()
    if not klanten:
        raise RadiusError('Er is geen Radius klant met een Telematics-abonnement gevonden.')
    return klanten[0]['id']


def _naar_lokale_datum(tijdstip):
    return timezone.localtime(tijdstip).date()


@transaction.atomic
def sync_radius_journeys(van, tot, customer_id=None):
    """
    Haal de ritten voor een periode op en sla ze op in het archief.

    Bestaande ritten worden bijgewerkt in plaats van gedupliceerd, zodat
    opnieuw synchroniseren van dezelfde periode veilig is.
    """
    klant_id = bepaal_klant_id(customer_id)
    resultaat = get_journeys(klant_id, van, tot)

    bestaande = {
        (rit.service_id, rit.start_time): rit
        for rit in RadiusJourney.objects.filter(
            start_time__date__gte=resultaat['date_from'],
            start_time__date__lte=resultaat['date_to'],
        )
    }

    nieuw = []
    bijwerken = []
    kentekens = set()
    datums = set()

    for rit in resultaat['journeys']:
        sleutel = (rit['service_id'], rit['start_time'])
        rit_datum = _naar_lokale_datum(rit['start_time'])
        kentekens.add(rit['plate_number'])
        datums.add(rit_datum)

        velden = {
            'plate_number': rit['plate_number'],
            'driver_name': rit['driver_name'],
            'date': rit_datum,
            'end_time': rit['end_time'],
            'start_latitude': rit['start_latitude'],
            'start_longitude': rit['start_longitude'],
            'end_latitude': rit['end_latitude'],
            'end_longitude': rit['end_longitude'],
            'start_address': rit['start_address'][:255],
            'start_city': rit['start_city'][:120],
            'start_country': rit['start_country'][:100],
            'end_address': rit['end_address'][:255],
            'end_city': rit['end_city'][:120],
            'end_country': rit['end_country'][:100],
            'distance_km': rit['distance_km'],
            'duration_seconds': rit['duration_seconds'],
            'customer_id': klant_id,
        }

        huidig = bestaande.get(sleutel)
        if huidig is None:
            nieuw.append(RadiusJourney(
                service_id=rit['service_id'],
                start_time=rit['start_time'],
                **velden,
            ))
        else:
            gewijzigd = False
            for naam, waarde in velden.items():
                if getattr(huidig, naam) != waarde:
                    setattr(huidig, naam, waarde)
                    gewijzigd = True
            if gewijzigd:
                bijwerken.append(huidig)

    if nieuw:
        RadiusJourney.objects.bulk_create(nieuw, batch_size=500, ignore_conflicts=True)
    if bijwerken:
        RadiusJourney.objects.bulk_update(
            bijwerken,
            [
                'plate_number', 'driver_name', 'date', 'end_time',
                'start_latitude', 'start_longitude', 'end_latitude', 'end_longitude',
                'start_address', 'start_city', 'start_country',
                'end_address', 'end_city', 'end_country',
                'distance_km', 'duration_seconds', 'customer_id',
            ],
            batch_size=500,
        )

    for dag in datums:
        RadiusSyncLog.objects.update_or_create(
            date=dag,
            defaults={
                'journeys_synced': sum(
                    1 for r in resultaat['journeys'] if _naar_lokale_datum(r['start_time']) == dag
                ),
                'journeys_created': sum(1 for r in nieuw if r.date == dag),
                'vehicles_seen': len({
                    r['plate_number'] for r in resultaat['journeys']
                    if _naar_lokale_datum(r['start_time']) == dag
                }),
                'errors': '',
            },
        )

    return {
        'customer': klant_id,
        'date_from': resultaat['date_from'],
        'date_to': resultaat['date_to'],
        'journeys_fetched': resultaat['count'],
        'journeys_created': len(nieuw),
        'journeys_updated': len(bijwerken),
        'vehicles': len({k for k in kentekens if k}),
    }


def sync_recente_dagen(dagen=STANDAARD_TERUGBLIK_DAGEN, customer_id=None):
    """Synchroniseer vandaag en de voorgaande dagen (voor de dagelijkse taak)."""
    tot = timezone.localdate()
    van = tot - timedelta(days=max(0, dagen - 1))
    return sync_radius_journeys(van, tot, customer_id=customer_id)


def get_radius_archive(van, tot, plate_number=None):
    """
    Geef het archief samengevat per dag en voertuig, met de losse ritten erbij.

    Deze functie leest uitsluitend uit onze eigen database en is dus niet
    afhankelijk van de 30-dagen-bewaartermijn van Radius.
    """
    ritten = RadiusJourney.objects.filter(date__gte=van, date__lte=tot)
    if plate_number:
        ritten = ritten.filter(plate_number=plate_number)

    regels = {}
    for rit in ritten.order_by('date', 'plate_number', 'start_time'):
        sleutel = (rit.date, rit.plate_number)
        regel = regels.setdefault(sleutel, {
            'date': rit.date.isoformat(),
            'plate_number': rit.plate_number,
            'driver_name': rit.driver_name,
            'first_start': rit.start_time,
            'last_end': rit.end_time,
            'distance_km': 0.0,
            'duration_seconds': 0,
            'journey_count': 0,
            'journeys': [],
        })
        regel['distance_km'] += rit.distance_km or 0
        regel['duration_seconds'] += rit.duration_seconds or 0
        regel['journey_count'] += 1
        if rit.end_time and (not regel['last_end'] or rit.end_time > regel['last_end']):
            regel['last_end'] = rit.end_time
        if not regel['driver_name'] and rit.driver_name:
            regel['driver_name'] = rit.driver_name
        regel['journeys'].append({
            'service_id': rit.service_id,
            'start_time': rit.start_time,
            'end_time': rit.end_time,
            'start_address': rit.start_address,
            'end_address': rit.end_address,
            'start_latitude': rit.start_latitude,
            'start_longitude': rit.start_longitude,
            'end_latitude': rit.end_latitude,
            'end_longitude': rit.end_longitude,
            'distance_km': round(rit.distance_km or 0, 1),
            'duration_seconds': rit.duration_seconds or 0,
        })

    resultaat = sorted(regels.values(), key=lambda r: (r['date'], r['plate_number']), reverse=True)
    for regel in resultaat:
        regel['distance_km'] = round(regel['distance_km'], 1)

    totalen = ritten.aggregate(
        km=Sum('distance_km'),
        seconden=Sum('duration_seconds'),
        aantal=Count('id'),
    )
    return {
        'entries': resultaat,
        'count': len(resultaat),
        'total_distance_km': round(totalen['km'] or 0, 1),
        'total_duration_seconds': int(totalen['seconden'] or 0),
        'journey_count': totalen['aantal'] or 0,
        'date_from': van.isoformat() if hasattr(van, 'isoformat') else str(van),
        'date_to': tot.isoformat() if hasattr(tot, 'isoformat') else str(tot),
    }


def get_archief_kentekens():
    """Alle kentekens die in het archief voorkomen, voor filters in de UI."""
    return list(
        RadiusJourney.objects
        .exclude(plate_number='')
        .values_list('plate_number', flat=True)
        .distinct()
        .order_by('plate_number')
    )

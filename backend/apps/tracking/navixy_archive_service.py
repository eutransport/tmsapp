"""Navixy-ritten ophalen en bewaren.

Navixy bewaart zelf maar een beperkte periode, afhankelijk van het abonnement.
Door periodiek te synchroniseren bouwen we een eigen archief op dat verder
teruggaat dan de API, net zoals bij Radius.

Opnieuw ophalen van dezelfde periode is veilig: een rit is uniek per tracker en
Navixy-rit-id.
"""
import logging
from datetime import timedelta

from django.utils import timezone

from apps.tracking import navixy_service
from apps.tracking.models import NavixyJourney, NavixyTracker

logger = logging.getLogger('tracking')

# Velden die bijgewerkt mogen worden als Navixy een rit herberekent nadat er
# late of gebufferde punten zijn binnengekomen.
BIJWERKBARE_VELDEN = [
    'plate_number', 'date', 'start_time', 'end_time',
    'start_address', 'end_address',
    'start_latitude', 'start_longitude', 'end_latitude', 'end_longitude',
    'distance_km', 'duration_seconds', 'max_speed', 'avg_speed',
]


def sync_navixy_journeys(van=None, tot=None, dagen=2, tracker=None):
    """Haal ritten op en schrijf ze weg.

    Geeft een overzicht terug met het aantal nieuwe en bijgewerkte ritten en
    eventuele fouten per tracker. Een storing bij één tracker laat de andere
    trackers ongemoeid.
    """
    tot = tot or timezone.now()
    van = van or (tot - timedelta(days=dagen))

    if tracker is not None:
        trackers = [tracker]
    else:
        trackers = list(
            NavixyTracker.objects
            .filter(actief=True, koppeling__actief=True)
            .select_related('koppeling')
        )

    overzicht = {'nieuw': 0, 'bijgewerkt': 0, 'trackers': 0, 'fouten': []}

    for huidige in trackers:
        try:
            ritten = navixy_service.get_journeys(huidige, van, tot)
        except navixy_service.NavixyError as fout:
            logger.warning('Navixy-ritten ophalen mislukt voor tracker %s: %s',
                           huidige.tracker_id, fout)
            overzicht['fouten'].append({
                'tracker_id': huidige.tracker_id,
                'kenteken': huidige.kenteken,
                'fout': str(fout),
            })
            continue

        overzicht['trackers'] += 1
        nieuw, bijgewerkt = _wegschrijven(huidige, ritten)
        overzicht['nieuw'] += nieuw
        overzicht['bijgewerkt'] += bijgewerkt

    return overzicht


def _wegschrijven(tracker, ritten):
    """Sla nieuwe ritten op en werk gewijzigde ritten bij."""
    if not ritten:
        return 0, 0

    bestaand = {
        rit.track_id: rit
        for rit in NavixyJourney.objects.filter(
            tracker=tracker,
            track_id__in=[r['track_id'] for r in ritten],
        )
    }

    aanmaken = []
    bijwerken = []
    for gegevens in ritten:
        huidige = bestaand.get(gegevens['track_id'])
        if huidige is None:
            aanmaken.append(NavixyJourney(tracker=tracker, **gegevens))
            continue

        gewijzigd = False
        for veld in BIJWERKBARE_VELDEN:
            if getattr(huidige, veld) != gegevens[veld]:
                setattr(huidige, veld, gegevens[veld])
                gewijzigd = True
        if gewijzigd:
            bijwerken.append(huidige)

    if aanmaken:
        # ignore_conflicts vangt de zeldzame botsing af wanneer twee
        # synchronisaties elkaar overlappen.
        NavixyJourney.objects.bulk_create(aanmaken, batch_size=500, ignore_conflicts=True)
    if bijwerken:
        NavixyJourney.objects.bulk_update(bijwerken, BIJWERKBARE_VELDEN, batch_size=500)

    return len(aanmaken), len(bijwerken)

"""Het land achter een stationsnaam op een tolfactuur.

De stationsnaam is de enige landbron die voor de hele vloot werkt: ook wagens
zonder tracker hebben hem. Elke naam die we tegenkomen wordt vastgelegd met
een voorstel; pas na bevestiging telt het land mee. Een onbekend buitenlands
wegvak krijgt dus geen land in plaats van een verkeerd land.
"""
from django.utils import timezone

from .land_bepaling import expliciete_landcode, land_uit_station
from .models import TolStation


def _stations(namen):
    bestaand = {s.naam: s for s in TolStation.objects.filter(naam__in=set(namen))}
    return bestaand


def onthoud_stations(namen) -> int:
    """Leg nieuwe stationsnamen vast en tel hoe vaak we ze zien.

    Returnt het aantal namen dat nog bevestigd moet worden.
    """
    namen = [(n or '').strip() for n in namen]
    namen = [n for n in namen if n]
    if not namen:
        return 0

    nu = timezone.now()
    bestaand = _stations(namen)
    nieuw = []
    for naam in namen:
        station = bestaand.get(naam)
        if station is None:
            # Staat de landcode letterlijk in de naam, dan valt er niets te
            # raden en hoeft niemand dat te bevestigen.
            expliciet = expliciete_landcode(naam)
            station = TolStation(
                naam=naam[:255],
                land=expliciet,
                voorstel=land_uit_station(naam),
                bevestigd_op=nu if expliciet else None,
                aantal_regels=0,
                laatst_gezien=nu,
            )
            bestaand[naam] = station
            nieuw.append(station)
        station.aantal_regels += 1
        station.laatst_gezien = nu

    if nieuw:
        TolStation.objects.bulk_create(nieuw, ignore_conflicts=True)
        bestaand = _stations(namen)
    TolStation.objects.bulk_update(
        [s for s in bestaand.values() if s.pk],
        ['aantal_regels', 'laatst_gezien'],
    )
    return sum(1 for s in bestaand.values() if s.bevestigd_op is None)


def landen_per_station(namen) -> dict:
    """Het bevestigde land per stationsnaam; onbevestigde namen ontbreken."""
    return {
        s.naam: s.land
        for s in TolStation.objects.filter(
            naam__in={(n or '').strip() for n in namen if n},
            bevestigd_op__isnull=False,
        )
        if s.land
    }


def openstaand_aantal() -> int:
    return TolStation.objects.filter(bevestigd_op__isnull=True).count()

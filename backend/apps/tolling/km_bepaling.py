"""Kilometers bepalen voor tolregels die alleen een bedrag hebben.

De Radius-API levert per toltransactie wel het bedrag en het land, maar geen
afstand. De GPS-rit is daar geen vervanging voor: tol wordt alleen over de
tolplichtige weggedeelten geheven, waardoor de rit structureel te lang is
(gemeten op 289 regels: +47%).

Wat wel werkt is terugrekenen. Het toltarief ligt vast per voertuig en land,
en dat tarief leiden we af uit de tolregels die wel kilometers hebben --
de eerder ingelezen bestanden van de tolaanbieder. Zo is er geen officiele
tarieflijst nodig en volgt de tabel automatisch een tariefwijziging.
"""
import logging
from decimal import Decimal, ROUND_HALF_UP

from django.db.models import Q

logger = logging.getLogger(__name__)

BRON_TARIEF = 'tarief'
BRON_BESTAND = 'bestand'

# Onder dit aantal waarnemingen vertrouwen we een tarief niet.
MIN_WAARNEMINGEN = 5
# Een wagen zonder landindeling krijgt alleen een tarief als zijn tolregels
# om een duidelijk punt liggen. Ligt de spreiding breder, dan rijdt hij in
# meerdere landen tegen verschillende tarieven en is terugrekenen onbetrouwbaar.
MIN_WAARNEMINGEN_WAGEN = 20
MAX_SPREIDING = Decimal('0.02')
MIN_AANDEEL_DICHTBIJ = Decimal('0.70')
# Een tarief buiten deze grenzen is geen toltarief maar een meetfout.
MIN_TARIEF = Decimal('0.01')
MAX_TARIEF = Decimal('2.00')


def _mediaan(waarden):
    geordend = sorted(waarden)
    midden = len(geordend) // 2
    if len(geordend) % 2:
        return geordend[midden]
    return (geordend[midden - 1] + geordend[midden]) / 2


class Tarieftabel:
    """Tarief per kilometer, per wagen en per maand.

    De maand telt mee omdat het tarief verandert: per 1 september 2026 ging er
    een tijdelijke korting van 22,3 procent op de vrachtwagenheffing af, en
    per 1 januari 2027 gaan de bedragen weer omhoog. Een tarief dat over die
    grens heen wordt gemiddeld is voor geen van beide perioden juist.
    """

    def __init__(self, per_wagen_maand, waarnemingen, per_groep_maand=None, groep_van=None):
        self.per_wagen_maand = per_wagen_maand
        self.waarnemingen = waarnemingen
        # Vangnet voor wagens zonder eigen historie, zoals een nieuwe trekker.
        self.per_groep_maand = per_groep_maand or {}
        self.groep_van = groep_van or {}

    def tarief(self, kenteken, maand):
        return (self.per_wagen_maand.get((kenteken, maand))
                or self.per_groep_maand.get((self.groep_van.get(kenteken), maand)))

    def kilometers(self, kenteken, maand, bedrag):
        """Geef de afstand in kilometers, of None als het tarief onbekend is."""
        if not bedrag or bedrag <= 0:
            return None
        tarief = self.tarief(kenteken, maand)
        if not tarief:
            return None
        return (Decimal(bedrag) / tarief).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    def als_lijst(self):
        rijen = [{'kenteken': k, 'maand': maand, 'tarief': str(round(t, 4)),
                  'waarnemingen': self.waarnemingen.get((k, maand), 0)}
                 for (k, maand), t in self.per_wagen_maand.items()]
        rijen.sort(key=lambda r: (r['kenteken'], r['maand']))
        return rijen


def maand_van(tijdstip) -> str:
    from django.utils import timezone
    plaatselijk = timezone.localtime(tijdstip) if timezone.is_aware(tijdstip) else tijdstip
    return plaatselijk.strftime('%Y-%m')


def bouw_tarieftabel():
    """Leid het tarief per kilometer af uit de tolregels die afstand hebben."""
    from .models import TollingEvent

    rijen = (TollingEvent.objects
             .filter(amount__gt=0, distance_km__gt=0)
             .exclude(km_bron=BRON_TARIEF)
             .values_list('license_plate_normalized', 'start_at', 'amount', 'distance_km'))

    per_sleutel = {}
    for kenteken, start, bedrag, afstand in rijen:
        tarief = Decimal(bedrag) / Decimal(afstand)
        if not (MIN_TARIEF <= tarief <= MAX_TARIEF):
            continue
        per_sleutel.setdefault((kenteken, maand_van(start)), []).append(tarief)

    waarnemingen = {sleutel: len(lijst) for sleutel, lijst in per_sleutel.items()}
    per_wagen_maand = {}
    for sleutel, lijst in per_sleutel.items():
        if len(lijst) < MIN_WAARNEMINGEN:
            continue
        midden = _mediaan(lijst)
        dichtbij = sum(1 for t in lijst if abs(t - midden) / midden <= MAX_SPREIDING)
        if Decimal(dichtbij) / len(lijst) >= MIN_AANDEEL_DICHTBIJ:
            per_wagen_maand[sleutel] = midden

    per_groep_maand, groep_van = _groepstarieven(per_wagen_maand)
    return Tarieftabel(per_wagen_maand, waarnemingen, per_groep_maand, groep_van)


def _groepstarieven(per_wagen_maand):
    """Tarief per soort wagen per maand, voor kentekens zonder eigen historie.

    Het RDW noteert bij een trekker altijd twee assen -- de assen van de
    oplegger tellen daar niet mee -- dus dat zegt niets. Het aantal wielen
    scheidt de bakwagen (vier) wel van de trekker (zes), en de CO2-klasse
    scheidt de schone wagens van de rest.
    """
    from apps.fleet.models import Vehicle
    from .models import normalize_plate

    groep_van = {}
    for kenteken, wielen, klasse in Vehicle.objects.values_list(
            'kenteken', 'rdw_aantal_wielen', 'rdw_co2_klasse'):
        plat = normalize_plate(kenteken)
        if plat and wielen:
            groep_van[plat] = (wielen, klasse or '')

    ruw = {}
    for (plat, maand), tarief in per_wagen_maand.items():
        groep = groep_van.get(plat)
        if groep:
            ruw.setdefault((groep, maand), []).append(tarief)

    return {sleutel: _mediaan(lijst) for sleutel, lijst in ruw.items()}, groep_van


def vul_kilometers_aan(events_qs, tabel=None) -> dict:
    """Vul alsnog de afstand van eerder ingelezen tolregels zonder kilometers."""
    from .models import TollingEvent

    tabel = tabel or bouw_tarieftabel()
    bijgewerkt = 0
    zonder_tarief = 0
    for event in (events_qs.filter(Q(distance_km=0) | Q(distance_km__isnull=True))
                  .iterator()):
        km = tabel.kilometers(event.license_plate_normalized,
                              maand_van(event.start_at), event.amount)
        if km is None:
            zonder_tarief += 1
            continue
        event.distance_km = km
        event.km_bron = BRON_TARIEF
        event.save(update_fields=['distance_km', 'km_bron'])
        bijgewerkt += 1
    return {'bijgewerkt': bijgewerkt, 'zonder_tarief': zonder_tarief,
            'tarieven': len(tabel.per_wagen_maand)}

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
    """Tarief per kilometer: eerst per voertuig en land, anders per voertuig."""

    def __init__(self, per_voertuig_land, per_voertuig, waarnemingen):
        self.per_voertuig_land = per_voertuig_land
        self.per_voertuig = per_voertuig
        self.waarnemingen = waarnemingen

    def tarief(self, kenteken, land):
        return (self.per_voertuig_land.get((kenteken, land))
                or self.per_voertuig.get(kenteken))

    def kilometers(self, kenteken, land, bedrag):
        """Geef de afstand in kilometers, of None als het tarief onbekend is."""
        if not bedrag or bedrag <= 0:
            return None
        tarief = self.tarief(kenteken, land)
        if not tarief:
            return None
        return (Decimal(bedrag) / tarief).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    def als_lijst(self):
        rijen = [{'kenteken': k, 'land': land, 'tarief': str(round(t, 4)),
                  'waarnemingen': self.waarnemingen.get((k, land), 0)}
                 for (k, land), t in self.per_voertuig_land.items()]
        rijen += [{'kenteken': k, 'land': '', 'tarief': str(round(t, 4)),
                   'waarnemingen': self.waarnemingen.get((k, ''), 0)}
                  for k, t in self.per_voertuig.items()]
        rijen.sort(key=lambda r: (r['kenteken'], r['land']))
        return rijen


def bouw_tarieftabel():
    """Leid het tarief per kilometer af uit de tolregels die afstand hebben."""
    from .models import TollingEvent

    rijen = (TollingEvent.objects
             .filter(amount__gt=0, distance_km__gt=0)
             .values_list('license_plate_normalized', 'land', 'amount', 'distance_km'))

    per_sleutel = {}
    per_wagen_ruw = {}
    for kenteken, land, bedrag, afstand in rijen:
        tarief = Decimal(bedrag) / Decimal(afstand)
        if not (MIN_TARIEF <= tarief <= MAX_TARIEF):
            continue
        per_wagen_ruw.setdefault(kenteken, []).append(tarief)
        if land:
            per_sleutel.setdefault((kenteken, land), []).append(tarief)

    waarnemingen = {sleutel: len(lijst) for sleutel, lijst in per_sleutel.items()}
    per_voertuig_land = {sleutel: _mediaan(lijst)
                         for sleutel, lijst in per_sleutel.items()
                         if len(lijst) >= MIN_WAARNEMINGEN}

    per_voertuig = {}
    for kenteken, lijst in per_wagen_ruw.items():
        waarnemingen[(kenteken, '')] = len(lijst)
        if len(lijst) < MIN_WAARNEMINGEN_WAGEN:
            continue
        midden = _mediaan(lijst)
        dichtbij = sum(1 for t in lijst if abs(t - midden) / midden <= MAX_SPREIDING)
        if Decimal(dichtbij) / len(lijst) >= MIN_AANDEEL_DICHTBIJ:
            per_voertuig[kenteken] = midden

    return Tarieftabel(per_voertuig_land, per_voertuig, waarnemingen)


def vul_kilometers_aan(events_qs, tabel=None) -> dict:
    """Vul alsnog de afstand van eerder ingelezen tolregels zonder kilometers."""
    from .models import TollingEvent

    tabel = tabel or bouw_tarieftabel()
    bijgewerkt = 0
    zonder_tarief = 0
    for event in (events_qs.filter(Q(distance_km=0) | Q(distance_km__isnull=True))
                  .exclude(land='').iterator()):
        km = tabel.kilometers(event.license_plate_normalized, event.land, event.amount)
        if km is None:
            zonder_tarief += 1
            continue
        event.distance_km = km
        event.km_bron = BRON_TARIEF
        event.save(update_fields=['distance_km', 'km_bron'])
        bijgewerkt += 1
    return {'bijgewerkt': bijgewerkt, 'zonder_tarief': zonder_tarief,
            'tarieven': len(tabel.per_voertuig)}

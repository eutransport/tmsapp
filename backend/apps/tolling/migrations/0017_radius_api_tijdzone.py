"""Zet de tijd van via de Radius-API ingelezen tolregels recht.

``tran_date`` draagt een Z-suffix maar bevat plaatselijke tijd. De import
rekende die om vanuit UTC, waardoor elke passage in de zomer twee uur en in
de winter een uur te laat in de database stond. Het bedrag en de afstand
klopten wel.

Het verschuiven gebeurt in twee stappen. Twee passages van dezelfde kaart
liggen soms precies het verschoven aantal uren uit elkaar; dan zou de ene
regel bovenop de andere landen en breekt de uniciteitsregel
(start, eind, kenteken, bedrag, obu). Daarom gaan alle regels eerst naar een
tijdstip ver buiten het bereik van echte data en daarna pas naar hun plaats.
"""
from datetime import timedelta, timezone as dt_timezone

from django.db import migrations

API_BATCH = 'Radius API'
PASSAGE_DUUR = timedelta(minutes=1)
PARKEERPLAATS = timedelta(days=36500)
UTC = dt_timezone.utc


def _te_verschuiven():
    """De regels die we mogen aanraken: via de API binnen en nog niet belast."""
    from apps.tolling.models import TollingEvent

    return list(TollingEvent.objects
                .filter(batch__filename__startswith=API_BATCH,
                        invoiced_at__isnull=True,
                        invoice_line__isnull=True))


def _bezette_plekken(eigen_ids):
    """Vingerafdrukken van alle regels die we juist niet verschuiven."""
    from apps.tolling.models import TollingEvent

    return set(TollingEvent.objects
               .exclude(id__in=eigen_ids)
               .values_list('start_at', 'end_at', 'license_plate_normalized',
                            'amount', 'obu'))


def _verplaats(events, nieuwe_tijd):
    """Verschuif in twee stappen, zodat regels niet op elkaar botsen."""
    from apps.tolling.models import TollingEvent

    bezet = _bezette_plekken([e.id for e in events])
    te_doen = []
    overgeslagen = 0
    for event in events:
        start = nieuwe_tijd(event)
        if start == event.start_at:
            continue
        afdruk = (start, start + PASSAGE_DUUR, event.license_plate_normalized,
                  event.amount, event.obu)
        if afdruk in bezet:
            overgeslagen += 1
            continue
        te_doen.append((event, start))

    if te_doen:
        for event, _ in te_doen:
            event.start_at += PARKEERPLAATS
            event.end_at += PARKEERPLAATS
        TollingEvent.objects.bulk_update(
            [e for e, _ in te_doen], ['start_at', 'end_at'], batch_size=200)

        for event, start in te_doen:
            event.start_at = start
            event.end_at = start + PASSAGE_DUUR
        TollingEvent.objects.bulk_update(
            [e for e, _ in te_doen], ['start_at', 'end_at'], batch_size=200)

    return [e for e, _ in te_doen], overgeslagen


def _rechtzetten(apps, schema_editor):
    from django.utils import timezone

    from apps.tolling.planning_koppeling import koppel_events

    tijdzone = timezone.get_current_timezone()

    def juist(event):
        # Lees de UTC-klok af en hang daar de plaatselijke tijdzone aan.
        klok = event.start_at.astimezone(UTC).replace(tzinfo=None)
        return timezone.make_aware(klok, tijdzone)

    events = _te_verschuiven()
    verschoven, overgeslagen = _verplaats(events, juist)
    if verschoven:
        # De dag kan door de verschuiving veranderd zijn, dus de koppeling
        # met de planning moet opnieuw.
        koppel_events(verschoven)

    melding = f'  {len(verschoven)} van {len(events)} Radius-API regels rechtgezet'
    if overgeslagen:
        melding += f', {overgeslagen} overgeslagen (stond er al)'
    print(melding)


def _terugdraaien(apps, schema_editor):
    """Zet de tijden terug zoals ze stonden, met de oude UTC-aanname."""
    from django.utils import timezone

    tijdzone = timezone.get_current_timezone()

    def oud(event):
        klok = timezone.localtime(event.start_at, tijdzone).replace(tzinfo=None)
        return klok.replace(tzinfo=UTC)

    _verplaats(_te_verschuiven(), oud)


class Migration(migrations.Migration):

    dependencies = [('tolling', '0016_tollcollect_duitsland_2026')]

    operations = [migrations.RunPython(_rechtzetten, _terugdraaien)]

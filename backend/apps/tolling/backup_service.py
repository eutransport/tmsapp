"""Backup en herstel van tolregels, per ISO-week.

Bewust los van `views.py` en `services.py`: de import blijft ongewijzigd.

Een backup legt de tolregels van de laatste `WEKEN_IN_BACKUP` weken vast,
opgesplitst per week. Terugzetten doe je per week, zodat een foute import van
één week niet de rest van de periode raakt.

Twee regels die het terugzetten veilig houden:

1. Een tolregel die al op een factuur staat wordt nooit verwijderd en nooit
   overschreven. Anders zou een verstuurde factuur niet meer kloppen met de
   administratie.
2. Regels die na de backup zijn bijgekomen en niet gefactureerd zijn worden
   wél verwijderd; dat is precies wat je wilt als je een import terugdraait.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from .models import TolBackup, TolBackupWeek, TollingEvent

logger = logging.getLogger(__name__)

WEKEN_IN_BACKUP = 5
MAX_BACKUPS = 10

# Velden die we één op één vastleggen en terugzetten.
VELDEN = (
    'start_at', 'end_at', 'distance_km', 'amount',
    'license_plate_raw', 'license_plate_normalized', 'obu',
    'vehicle_id', 'ritnummer', 'land', 'land_bron', 'km_bron', 'rit_bron',
    'bedrijf_id', 'invoice_line_id', 'invoiced_at',
    'private_registration_id', 'is_private', 'batch_id',
)
DECIMAL_VELDEN = ('distance_km', 'amount')
DATETIME_VELDEN = ('start_at', 'end_at', 'invoiced_at')


def _waarde_uit(event: TollingEvent, veld: str):
    waarde = getattr(event, veld)
    if waarde is None:
        return None
    if isinstance(waarde, Decimal):
        return str(waarde)
    if isinstance(waarde, datetime):
        return waarde.isoformat()
    return str(waarde) if veld.endswith('_id') else waarde


def _waarde_terug(veld: str, waarde):
    if waarde is None:
        return None
    if veld in DECIMAL_VELDEN:
        return Decimal(str(waarde))
    if veld in DATETIME_VELDEN:
        return datetime.fromisoformat(waarde)
    return waarde


def _als_dict(event: TollingEvent) -> dict:
    data = {veld: _waarde_uit(event, veld) for veld in VELDEN}
    data['id'] = str(event.id)
    return data


def weken_terug(aantal: int = WEKEN_IN_BACKUP, vandaag: date | None = None) -> list[tuple]:
    """De laatste `aantal` ISO-weken als (jaar, week, maandag, zondag)."""
    vandaag = vandaag or timezone.localdate()
    maandag = vandaag - timedelta(days=vandaag.weekday())
    weken = []
    for stap in range(aantal):
        start = maandag - timedelta(weeks=stap)
        eind = start + timedelta(days=6)
        jaar, week, _ = start.isocalendar()
        weken.append((jaar, week, start, eind))
    return weken


def _venster(van: date, tot: date):
    """Lokale dagvensters omzetten naar een tijdzone-bewust bereik."""
    start = timezone.make_aware(datetime.combine(van, datetime.min.time()))
    eind = timezone.make_aware(datetime.combine(tot + timedelta(days=1), datetime.min.time()))
    return start, eind


@transaction.atomic
def maak_backup(user=None, omschrijving: str = '', aantal_weken: int = WEKEN_IN_BACKUP) -> TolBackup:
    """Legt de tolregels van de laatste weken vast en ruimt oude backups op."""
    weken = weken_terug(aantal_weken)
    van = min(w[2] for w in weken)
    tot = max(w[3] for w in weken)

    backup = TolBackup.objects.create(
        omschrijving=omschrijving[:200],
        van_datum=van,
        tot_datum=tot,
        gemaakt_door=user if user and user.is_authenticated else None,
    )

    totaal_regels = 0
    totaal_bedrag = Decimal('0.00')
    for jaar, week, start, eind in weken:
        vanaf, totdat = _venster(start, eind)
        events = list(TollingEvent.objects.filter(start_at__gte=vanaf, start_at__lt=totdat))
        bedrag = sum((e.amount for e in events), Decimal('0.00'))
        TolBackupWeek.objects.create(
            backup=backup,
            jaar=jaar,
            weeknummer=week,
            van_datum=start,
            tot_datum=eind,
            aantal_regels=len(events),
            totaal_bedrag=bedrag,
            regels=[_als_dict(e) for e in events],
        )
        totaal_regels += len(events)
        totaal_bedrag += bedrag

    backup.aantal_regels = totaal_regels
    backup.totaal_bedrag = totaal_bedrag
    backup.save(update_fields=['aantal_regels', 'totaal_bedrag'])

    _ruim_op()
    return backup


def _ruim_op() -> int:
    """Houdt alleen de nieuwste backups; oudere worden verwijderd."""
    overtollig = list(TolBackup.objects.order_by('-gemaakt_op')[MAX_BACKUPS:].values_list('id', flat=True))
    if not overtollig:
        return 0
    TolBackup.objects.filter(id__in=overtollig).delete()
    return len(overtollig)


@transaction.atomic
def zet_week_terug(week: TolBackupWeek, user=None) -> dict:
    """Zet de tolregels van één week terug naar de momentopname."""
    vanaf, totdat = _venster(week.van_datum, week.tot_datum)
    huidig = {str(e.id): e for e in
              TollingEvent.objects.filter(start_at__gte=vanaf, start_at__lt=totdat)}

    bewaard = {rij['id']: rij for rij in week.regels}

    hersteld = 0
    teruggezet = 0
    verwijderd = 0
    overgeslagen_gefactureerd = 0

    for event_id, rij in bewaard.items():
        bestaand = huidig.get(event_id)
        if bestaand is None:
            velden = {veld: _waarde_terug(veld, rij.get(veld)) for veld in VELDEN}
            TollingEvent.objects.create(id=event_id, **velden)
            hersteld += 1
            continue
        if bestaand.invoice_line_id or bestaand.invoiced_at:
            overgeslagen_gefactureerd += 1
            continue
        gewijzigd = []
        for veld in VELDEN:
            nieuw = _waarde_terug(veld, rij.get(veld))
            if getattr(bestaand, veld) != nieuw:
                setattr(bestaand, veld, nieuw)
                gewijzigd.append(veld)
        if gewijzigd:
            bestaand.save(update_fields=gewijzigd)
            teruggezet += 1

    for event_id, bestaand in huidig.items():
        if event_id in bewaard:
            continue
        if bestaand.invoice_line_id or bestaand.invoiced_at:
            overgeslagen_gefactureerd += 1
            continue
        bestaand.delete()
        verwijderd += 1

    week.teruggezet_op = timezone.now()
    week.teruggezet_door = user if user and user.is_authenticated else None
    week.save(update_fields=['teruggezet_op', 'teruggezet_door'])

    logger.info(
        'Tolbackup week %s-%s teruggezet: %s hersteld, %s bijgewerkt, %s verwijderd, '
        '%s overgeslagen omdat ze gefactureerd zijn',
        week.weeknummer, week.jaar, hersteld, teruggezet, verwijderd, overgeslagen_gefactureerd,
    )
    return {
        'jaar': week.jaar,
        'weeknummer': week.weeknummer,
        'hersteld': hersteld,
        'bijgewerkt': teruggezet,
        'verwijderd': verwijderd,
        'overgeslagen_gefactureerd': overgeslagen_gefactureerd,
    }


def verschil_week(week: TolBackupWeek) -> dict:
    """Wat zou er veranderen als je deze week terugzet? Verandert niets."""
    vanaf, totdat = _venster(week.van_datum, week.tot_datum)
    huidig = {str(e.id): e for e in
              TollingEvent.objects.filter(start_at__gte=vanaf, start_at__lt=totdat)}
    bewaard = {rij['id']: rij for rij in week.regels}

    nieuw_sinds_backup = [e for key, e in huidig.items() if key not in bewaard]
    verdwenen = [rij for key, rij in bewaard.items() if key not in huidig]
    # Alles wat op een factuur staat blijft hoe dan ook ongemoeid.
    gefactureerd = [e for e in huidig.values() if e.invoice_line_id or e.invoiced_at]
    nieuw_en_vrij = [e for e in nieuw_sinds_backup
                     if not (e.invoice_line_id or e.invoiced_at)]

    huidig_bedrag = sum((e.amount for e in huidig.values()), Decimal('0.00'))
    return {
        'jaar': week.jaar,
        'weeknummer': week.weeknummer,
        'van_datum': week.van_datum.isoformat(),
        'tot_datum': week.tot_datum.isoformat(),
        'in_backup': len(bewaard),
        'nu_aanwezig': len(huidig),
        'bedrag_backup': str(week.totaal_bedrag),
        'bedrag_nu': str(huidig_bedrag),
        'wordt_verwijderd': len(nieuw_en_vrij),
        'wordt_hersteld': len(verdwenen),
        'blijft_staan_gefactureerd': len(gefactureerd),
    }

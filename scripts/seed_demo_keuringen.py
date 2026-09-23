"""
Tijdelijke demo-data voor de handleiding: APK, ADR en brandblussers voor de
hele vloot. Bewaart vooraf welke records er al waren, zodat het opschonen
alleen de verzonnen regels weghaalt.

Gebruik:
    python manage.py shell < scripts/seed_demo_keuringen.py          (vullen)
    DEMO_OPSCHONEN=1 python manage.py shell < scripts/seed_demo_keuringen.py
"""
import json
import os
from datetime import date, timedelta

from apps.fleet.models import Vehicle
from apps.maintenance.models import (
    APKRecord, ADRRecord, ADRSettings,
    FireExtinguisherRecord, FireExtinguisherSettings,
)

BESTAND = '/app/demo_keuringen_backup.json'
VANDAAG = date.today()


def opschonen():
    with open(BESTAND) as fh:
        backup = json.load(fh)

    apk = APKRecord.objects.exclude(id__in=backup['apk']).delete()
    adr = ADRRecord.objects.exclude(id__in=backup['adr']).delete()
    blus = FireExtinguisherRecord.objects.exclude(id__in=backup['blussers']).delete()

    # Herinneringsdatums van de echte regels terugzetten zoals ze waren.
    for rid, waarde in backup['adr_reminders'].items():
        ADRRecord.objects.filter(id=rid).update(
            last_reminder_sent_on=date.fromisoformat(waarde) if waarde else None
        )
    ADRSettings.objects.update(
        last_run_on=date.fromisoformat(backup['adr_last_run']) if backup['adr_last_run'] else None
    )
    if not backup['blusser_settings']:
        FireExtinguisherSettings.objects.all().delete()

    print('APK verwijderd:', apk[0], '| ADR verwijderd:', adr[0], '| blussers verwijderd:', blus[0])
    print('Over:', APKRecord.objects.count(), 'APK,', ADRRecord.objects.count(), 'ADR,',
          FireExtinguisherRecord.objects.count(), 'blussers')


def vullen():
    backup = {
        'apk': [str(i) for i in APKRecord.objects.values_list('id', flat=True)],
        'adr': [str(i) for i in ADRRecord.objects.values_list('id', flat=True)],
        'blussers': [str(i) for i in FireExtinguisherRecord.objects.values_list('id', flat=True)],
        'adr_reminders': {
            str(r.id): r.last_reminder_sent_on.isoformat() if r.last_reminder_sent_on else None
            for r in ADRRecord.objects.all()
        },
        'adr_last_run': None,
        'blusser_settings': FireExtinguisherSettings.objects.exists(),
    }
    instelling = ADRSettings.objects.first()
    if instelling and instelling.last_run_on:
        backup['adr_last_run'] = instelling.last_run_on.isoformat()
    with open(BESTAND, 'w') as fh:
        json.dump(backup, fh)
    print('Backup gemaakt van', len(backup['apk']), 'APK en', len(backup['adr']), 'ADR-regels')

    wagens = list(Vehicle.objects.all().order_by('kenteken'))
    print('Vloot:', len(wagens), 'voertuigen')

    # Een realistische spreiding: een paar te laat, een paar deze week,
    # een paar deze maand en de rest ruim op tijd.
    apk_dagen = [-6, 4, 11, 19, 27, 38, 52, 74, 96, 118, 141, 163,
                 186, 204, 223, 247, 268, 289, 301, 318, 334, 347, 358, 364]
    adr_dagen = [-9, 2, 6, 13, 21, 29, 44, 61, 83, 105, 127, 149,
                 171, 192, 213, 235, 256, 277, 295, 312, 329, 341, 353, 361]
    stations = ['Truckcenter Rotterdam', 'RDW Keurpunt Barendrecht', 'Garage Van Dijk',
                'Truckland Zuid-Holland', 'Bandenservice Ridderkerk']
    posities = ['Cabine, naast bestuurdersstoel', 'Chassis links', 'Chassis rechts',
                'Achterzijde oplegger', 'Naast instap bijrijder']

    nieuw_apk = nieuw_adr = nieuw_blus = 0

    for index, wagen in enumerate(wagens):
        # ---------------- APK ----------------
        if not APKRecord.objects.filter(vehicle=wagen, is_current=True).exists():
            dagen = apk_dagen[index % len(apk_dagen)]
            verval = VANDAAG + timedelta(days=dagen)
            APKRecord.objects.create(
                vehicle=wagen,
                inspection_date=verval - timedelta(days=365),
                expiry_date=verval,
                passed=True,
                inspection_station=stations[index % len(stations)],
                inspector_name=['M. de Vries', 'J. Bakker', 'R. Yilmaz', 'P. Jansen'][index % 4],
                mileage_at_inspection=180000 + index * 14500,
                remarks='Geen bijzonderheden.' if index % 3 else 'Remblokken vooras vervangen.',
                is_current=True,
            )
            nieuw_apk += 1

        # ---------------- ADR ----------------
        if not ADRRecord.objects.filter(vehicle=wagen).exists():
            dagen = adr_dagen[index % len(adr_dagen)]
            volgende = VANDAAG + timedelta(days=dagen)
            ADRRecord.objects.create(
                vehicle=wagen,
                has_adr=True,
                case_sealed=index % 4 != 0,
                inspection_date=volgende - timedelta(days=365),
                next_inspection_date=volgende,
                remarks='Koffer compleet gecontroleerd.' if index % 2 else '',
            )
            nieuw_adr += 1

        # ---------------- BRANDBLUSSERS ----------------
        if not FireExtinguisherRecord.objects.filter(vehicle=wagen).exists():
            aantal = [3, 2, 2, 3, 1][index % 5]
            # Blussers van dezelfde wagen lopen bewust uit elkaar: dat is precies
            # waarom elke blusser zijn eigen regel en eigen datum heeft.
            spreiding = [-4, 8, 25, 61, 140, 198, 246, 288, 333]
            for nr in range(1, aantal + 1):
                dagen = spreiding[(index * 2 + nr) % len(spreiding)]
                volgende = VANDAAG + timedelta(days=dagen)
                FireExtinguisherRecord.objects.create(
                    vehicle=wagen,
                    volgnummer=nr,
                    positie=posities[(index + nr) % len(posities)],
                    serienummer=f'BLS-{2200 + index * 7 + nr}',
                    inspection_date=volgende - timedelta(days=365),
                    next_inspection_date=volgende,
                )
                nieuw_blus += 1

    print('Aangemaakt:', nieuw_apk, 'APK |', nieuw_adr, 'ADR |', nieuw_blus, 'blussers')
    print('Totaal nu:', APKRecord.objects.count(), 'APK,', ADRRecord.objects.count(), 'ADR,',
          FireExtinguisherRecord.objects.count(), 'blussers')


if os.environ.get('DEMO_OPSCHONEN'):
    opschonen()
else:
    vullen()

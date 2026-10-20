"""50-BXN-5 reed 12 en 13 oktober nog voor Mainfreight, niet voor DACHSER.

De wagen staat twee keer in de vloot: een inactief record bij Mainfreight met
ritnummer E&UTRANS1 en een actief record bij DACHSER met ritnummer 794. Omdat
er voor die dagen geen planningsregel was, viel de tolimport terug op het
actieve voertuig en kwamen de passages bij DACHSER terecht. De urenregistratie
laat zien dat Patrick op 12 oktober nog een Mainfreight-rit draaide
(1115528293, 07:30-14:12).

Alleen nog niet gefactureerde passages worden omgezet.
"""
from datetime import date

from django.db import migrations

KENTEKEN = '50BXN5'
VANAF = date(2026, 10, 10)
TOT = date(2026, 10, 14)


def _naar_mainfreight(apps, schema_editor):
    Company = apps.get_model('companies', 'Company')
    TollingEvent = apps.get_model('tolling', 'TollingEvent')

    bedrijf = Company.objects.filter(naam__startswith='Mainfreight').first()
    if bedrijf is None:
        return

    (TollingEvent.objects
     .filter(license_plate_normalized=KENTEKEN,
             start_at__date__gte=VANAF,
             start_at__date__lt=TOT,
             invoiced_at__isnull=True)
     .update(bedrijf=bedrijf))


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0025_bb625l_dubbele_tolpassages_rest'),
        ('companies', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(_naar_mainfreight, migrations.RunPython.noop),
    ]

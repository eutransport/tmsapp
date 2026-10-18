"""BD-894-H reed eind juli en augustus voor AG Logistics.

Die tolpassages kregen geen opdrachtgever omdat ze buiten de planning om
geboekt zijn. Ze zijn met AG Logistics afgerekend, dus ze horen hier op
gefactureerd te staan. Eenmalig, want nieuwe passages lopen weer via de
planningskoppeling.
"""

from django.db import migrations
from django.utils import timezone

KENTEKEN = 'BD894H'
VAN = '2026-07-27'
TOT = '2026-08-28'
BEDRIJF = 'AG Logistics'


def koppel(apps, schema_editor):
    Company = apps.get_model('companies', 'Company')
    TollingEvent = apps.get_model('tolling', 'TollingEvent')

    bedrijf = Company.objects.filter(naam=BEDRIJF).first()
    if bedrijf is None:
        return

    nu = timezone.now()
    passages = TollingEvent.objects.filter(
        license_plate_normalized=KENTEKEN,
        bedrijf__isnull=True,
        is_private=False,
        start_at__date__gte=VAN,
        start_at__date__lte=TOT,
    )
    passages.filter(invoiced_at__isnull=True).update(invoiced_at=nu)
    passages.update(bedrijf=bedrijf)


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0017_radius_api_tijdzone'),
        ('companies', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(koppel, migrations.RunPython.noop),
    ]

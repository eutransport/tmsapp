"""Tolafrekeningen zonder opdrachtgever alsnog koppelen.

Het bedrijf werd alleen bij het inlezen bepaald en bleef leeg wanneer de
wagens toen nog niet gekoppeld waren. Herkoppelen vult het nu wel in; hier
doen we dat eenmalig voor de bonnen die al in de database staan.
"""

from django.db import migrations


def koppel(apps, schema_editor):
    from apps.tolling import afrekening_service as service
    from apps.tolling.models import TolAfrekening

    bonnen = list(TolAfrekening.objects.filter(bedrijf__isnull=True))
    if not bonnen:
        return
    service.herkoppel(bonnen)
    gevuld = TolAfrekening.objects.filter(
        id__in=[b.id for b in bonnen], bedrijf__isnull=False).count()
    print(f'  {gevuld} van {len(bonnen)} tolafrekeningen kregen een opdrachtgever')


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0020_tol_zonder_bedrijf_koppelen'),
    ]

    operations = [
        migrations.RunPython(koppel, migrations.RunPython.noop),
    ]

from django.db import migrations


def corrigeer(apps, schema_editor):
    """Radius levert deze twee wagens met omgedraaide letters aan."""
    RadiusJourney = apps.get_model('tracking', 'RadiusJourney')
    for fout, goed in (('31-BNL-8', '31-BLN-8'), ('32-BNL-8', '32-BLN-8')):
        RadiusJourney.objects.filter(plate_number=fout).update(plate_number=goed)


class Migration(migrations.Migration):

    dependencies = [
        ('tracking', '0005_radiusconnection'),
    ]

    operations = [
        migrations.RunPython(corrigeer, migrations.RunPython.noop),
    ]

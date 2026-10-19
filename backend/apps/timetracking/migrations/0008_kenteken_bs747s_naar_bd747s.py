from datetime import date

from django.db import migrations


# De uren van deze wagen zijn op vijf dagen als BS-747-S geboekt; dat kenteken
# bestaat niet in de vloot en heeft in deze periode geen enkele tolpassage.
VAN = 'BS-747-S'
NAAR = 'BD-747-S'
VANAF = date(2026, 9, 24)
TOT = date(2026, 10, 16)


def _corrigeer(apps, schema_editor):
    TimeEntry = apps.get_model('timetracking', 'TimeEntry')
    TimeEntry.objects.filter(
        kenteken=VAN, datum__gte=VANAF, datum__lte=TOT,
    ).update(kenteken=NAAR)


class Migration(migrations.Migration):

    dependencies = [
        ('timetracking', '0007_alter_tolregistratie_bijlage_and_more'),
    ]

    operations = [
        migrations.RunPython(_corrigeer, migrations.RunPython.noop),
    ]

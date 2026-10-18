"""31-BLN-8 stond in de weekplanning als 31-BNL-8.

De letters zijn omgedraaid ingevoerd en zijn zo in het kentekenveld van de
planningsregels blijven staan, ook nadat de wagen zelf gecorrigeerd was. De
tolpassages van die wagen vonden daardoor geen planningsregel en bleven
zonder opdrachtgever. Hier zetten we de momentopname gelijk aan de wagen en
koppelen we de tol alsnog.
"""

from django.db import migrations

FOUT = '31-BNL-8'
GOED = '31-BLN-8'


def rechtzetten(apps, schema_editor):
    from apps.tolling.models import TollingEvent, normalize_plate
    from apps.tolling.planning_koppeling import koppel_events

    PlanningEntry = apps.get_model('planning', 'PlanningEntry')

    aangepast = (PlanningEntry.objects
                 .filter(vehicle_kenteken=FOUT, vehicle__kenteken=GOED)
                 .update(vehicle_kenteken=GOED))

    events = list(TollingEvent.objects.filter(
        license_plate_normalized=normalize_plate(GOED),
        bedrijf__isnull=True,
        is_private=False,
    ))
    uitkomst = koppel_events(events) if events else {'gekoppeld': 0}
    print(f'  {aangepast} planningsregels hernoemd, '
          f'{uitkomst["gekoppeld"]} tolpassages gekoppeld')


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0018_ag_logistics_bd894h'),
        ('planning', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(rechtzetten, migrations.RunPython.noop),
    ]

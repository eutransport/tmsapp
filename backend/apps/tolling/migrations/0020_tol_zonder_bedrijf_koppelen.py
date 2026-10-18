"""Tolpassages zonder opdrachtgever alsnog aan de planning koppelen.

Een deel van de passages bleef zonder bedrijf staan: deels omdat de wagen in
de planning verkeerd gespeld stond, deels omdat de koppeling nooit opnieuw
gedraaid is. Eenmalig rechtzetten; nieuwe passages lopen weer via de import.
"""

from django.db import migrations


def koppel(apps, schema_editor):
    from apps.tolling import planning_koppeling as pk
    from apps.tolling.models import TollingEvent

    events = list(TollingEvent.objects.filter(
        is_private=False, bedrijf__isnull=True))
    if not events:
        return
    dagen = {e.id: pk.planning_datum(e.start_at) for e in events}
    index = pk.bouw_dagindex(set(dagen.values()))

    # De gewone koppeling laat gefactureerde regels met rust, want hun
    # ritnummer hoort bij een verstuurde factuur. Het bedrijf mag wel.
    alleen_bedrijf = []
    for event in events:
        if event.invoiced_at is None:
            continue
        regel = index.get((event.license_plate_normalized, dagen[event.id]))
        if regel is None or not regel.planning.bedrijf_id:
            continue
        event.bedrijf_id = regel.planning.bedrijf_id
        alleen_bedrijf.append(event)
    if alleen_bedrijf:
        TollingEvent.objects.bulk_update(alleen_bedrijf, ['bedrijf'])

    open_regels = [e for e in events if e.invoiced_at is None]
    uitkomst = pk.koppel_events(open_regels, index) if open_regels else {}
    print(f'  {len(alleen_bedrijf)} gefactureerde passages kregen een bedrijf, '
          f'{uitkomst.get("gekoppeld", 0)} open passages gekoppeld')


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0019_planning_kenteken_31bln8'),
        ('planning', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(koppel, migrations.RunPython.noop),
    ]

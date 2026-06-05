"""Backfill snapshot-velden op PlanningEntry voor bestaande rijen.

Reden: WeekPlanningViewSet.perform_create gebruikte PlanningEntry.objects.bulk_create,
wat de save()-methode (die de snapshots vulde) niet aanroept. Voor planningen die
na migratie 0004 zijn aangemaakt zijn vehicle_kenteken/vehicle_type_wagen/
vehicle_ritnummer dus leeg gebleven. Dit zorgde voor:
  - geen ritnummer naast het wagenicoon in de UI;
  - onstabiele sortering (Meta.ordering = ['vehicle_ritnummer', 'dag']),
    waardoor een rij na het toewijzen van een chauffeur leek te 'verspringen'
    naar onderen.

Deze migratie vult de lege snapshotvelden alsnog vanuit de gekoppelde Vehicle.
"""
from django.db import migrations


def backfill_vehicle_snapshots(apps, schema_editor):
    PlanningEntry = apps.get_model('planning', 'PlanningEntry')

    qs = PlanningEntry.objects.select_related('vehicle').filter(vehicle__isnull=False)
    for pe in qs:
        update_fields = []
        veh = pe.vehicle
        if not pe.vehicle_kenteken and getattr(veh, 'kenteken', ''):
            pe.vehicle_kenteken = veh.kenteken
            update_fields.append('vehicle_kenteken')
        if not pe.vehicle_type_wagen and getattr(veh, 'type_wagen', ''):
            pe.vehicle_type_wagen = veh.type_wagen
            update_fields.append('vehicle_type_wagen')
        if not pe.vehicle_ritnummer and getattr(veh, 'ritnummer', ''):
            pe.vehicle_ritnummer = veh.ritnummer
            update_fields.append('vehicle_ritnummer')
        if update_fields:
            pe.save(update_fields=update_fields)


def reverse_noop(apps, schema_editor):
    # Snapshot-data verwijderen heeft geen zin; deze migratie is data-only en idempotent.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('planning', '0004_history_snapshot'),
    ]

    operations = [
        migrations.RunPython(backfill_vehicle_snapshots, reverse_noop),
        migrations.AlterModelOptions(
            name='planningentry',
            options={
                'ordering': ['vehicle_ritnummer', 'vehicle_kenteken', 'vehicle_id', 'dag'],
                'verbose_name': 'Planningsregel',
                'verbose_name_plural': 'Planningsregels',
            },
        ),
    ]

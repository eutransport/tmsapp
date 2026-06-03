"""Voeg snapshot-velden toe en backfill bestaande planningsregels.

- WeekPlanning.bedrijf: CASCADE -> SET_NULL + null=True; bedrijf_naam toegevoegd
- PlanningEntry.vehicle: CASCADE -> SET_NULL + null=True
- PlanningEntry: vehicle_kenteken, vehicle_type_wagen, vehicle_ritnummer,
  chauffeur_naam snapshots toegevoegd
- ordering -> vehicle_ritnummer, dag
- Backfill bestaande rijen met huidige FK-waarden zodat historie behouden blijft
"""
from django.db import migrations, models


def backfill_snapshots(apps, schema_editor):
    WeekPlanning = apps.get_model('planning', 'WeekPlanning')
    PlanningEntry = apps.get_model('planning', 'PlanningEntry')

    # WeekPlanning.bedrijf_naam
    for wp in WeekPlanning.objects.select_related('bedrijf').all():
        if not wp.bedrijf_naam and wp.bedrijf_id:
            wp.bedrijf_naam = wp.bedrijf.naam or ''
            wp.save(update_fields=['bedrijf_naam'])

    # PlanningEntry snapshots
    for pe in PlanningEntry.objects.select_related('vehicle', 'chauffeur').all():
        update_fields = []
        if pe.vehicle_id:
            if not pe.vehicle_kenteken:
                pe.vehicle_kenteken = pe.vehicle.kenteken or ''
                update_fields.append('vehicle_kenteken')
            if not pe.vehicle_type_wagen:
                pe.vehicle_type_wagen = pe.vehicle.type_wagen or ''
                update_fields.append('vehicle_type_wagen')
            if not pe.vehicle_ritnummer:
                pe.vehicle_ritnummer = pe.vehicle.ritnummer or ''
                update_fields.append('vehicle_ritnummer')
        if pe.chauffeur_id and not pe.chauffeur_naam:
            pe.chauffeur_naam = pe.chauffeur.naam or ''
            update_fields.append('chauffeur_naam')
            # telefoon en adr bestaan al, alleen vullen als leeg
            if not pe.telefoon:
                pe.telefoon = pe.chauffeur.telefoon or ''
                update_fields.append('telefoon')
            if not pe.adr:
                pe.adr = bool(pe.chauffeur.adr)
                update_fields.append('adr')
        if update_fields:
            pe.save(update_fields=update_fields)


def reverse_noop(apps, schema_editor):
    # Snapshot data laten staan bij rollback van schema is veiliger dan terugzetten
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('planning', '0003_alter_planningentry_options'),
        ('companies', '0001_initial'),
        ('fleet', '0001_initial'),
        ('drivers', '0001_initial'),
    ]

    operations = [
        # WeekPlanning: bedrijf FK on_delete + bedrijf_naam snapshot
        migrations.AlterField(
            model_name='weekplanning',
            name='bedrijf',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='plannings',
                to='companies.company',
                verbose_name='Bedrijf',
            ),
        ),
        migrations.AddField(
            model_name='weekplanning',
            name='bedrijf_naam',
            field=models.CharField(blank=True, max_length=200, verbose_name='Bedrijfsnaam (snapshot)'),
        ),

        # PlanningEntry: vehicle FK on_delete + snapshots
        migrations.AlterField(
            model_name='planningentry',
            name='vehicle',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name='planning_entries',
                to='fleet.vehicle',
                verbose_name='Voertuig',
            ),
        ),
        migrations.AddField(
            model_name='planningentry',
            name='vehicle_kenteken',
            field=models.CharField(blank=True, max_length=20, verbose_name='Kenteken (snapshot)'),
        ),
        migrations.AddField(
            model_name='planningentry',
            name='vehicle_type_wagen',
            field=models.CharField(blank=True, max_length=100, verbose_name='Type wagen (snapshot)'),
        ),
        migrations.AddField(
            model_name='planningentry',
            name='vehicle_ritnummer',
            field=models.CharField(blank=True, max_length=50, verbose_name='Voertuig ritnummer (snapshot)'),
        ),
        migrations.AddField(
            model_name='planningentry',
            name='chauffeur_naam',
            field=models.CharField(blank=True, max_length=200, verbose_name='Chauffeursnaam (snapshot)'),
        ),

        # Verbose-name updates van telefoon/adr/ritnummer (alleen metadata)
        migrations.AlterField(
            model_name='planningentry',
            name='telefoon',
            field=models.CharField(blank=True, max_length=20, verbose_name='Telefoon (snapshot)'),
        ),
        migrations.AlterField(
            model_name='planningentry',
            name='adr',
            field=models.BooleanField(default=False, verbose_name='ADR (snapshot)'),
        ),
        migrations.AlterField(
            model_name='planningentry',
            name='ritnummer',
            field=models.CharField(blank=True, max_length=50, verbose_name='Ritnummer (override)'),
        ),

        # Nieuwe ordering: snapshot ritnummer in plaats van vehicle__ritnummer
        migrations.AlterModelOptions(
            name='planningentry',
            options={
                'ordering': ['vehicle_ritnummer', 'dag'],
                'verbose_name': 'Planningsregel',
                'verbose_name_plural': 'Planningsregels',
            },
        ),

        migrations.RunPython(backfill_snapshots, reverse_noop),
    ]

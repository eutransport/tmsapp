"""Ritnummer met ingangsdatum per wagen.

Elke bestaande wagen krijgt precies een periode zonder begindatum met zijn
huidige ritnummer. Daardoor geeft een opzoeking op elke datum hetzelfde
antwoord als voorheen en verandert er functioneel niets tot er zelf een
tweede periode wordt toegevoegd.
"""
import uuid

import django.db.models.deletion
from django.db import migrations, models


def backfill_periodes(apps, schema_editor):
    """Maak per wagen een openstaande periode met het huidige ritnummer."""
    Vehicle = apps.get_model('fleet', 'Vehicle')
    VehicleRitnummer = apps.get_model('fleet', 'VehicleRitnummer')

    bestaand = set(
        VehicleRitnummer.objects.filter(geldig_vanaf__isnull=True)
        .values_list('vehicle_id', flat=True)
    )
    nieuw = [
        VehicleRitnummer(
            id=uuid.uuid4(),
            vehicle_id=wagen.id,
            ritnummer=(wagen.ritnummer or '').strip(),
            geldig_vanaf=None,
            notitie='Automatisch aangemaakt bij invoeren van ingangsdatums.',
        )
        for wagen in Vehicle.objects.all().only('id', 'ritnummer')
        if wagen.id not in bestaand
    ]
    if nieuw:
        VehicleRitnummer.objects.bulk_create(nieuw, batch_size=500)


def verwijder_periodes(apps, schema_editor):
    """Terugdraaien: de tabel verdwijnt toch, dus niets te doen."""


class Migration(migrations.Migration):

    dependencies = [
        ('fleet', '0005_remove_old_kenteken_unique_index'),
    ]

    operations = [
        migrations.CreateModel(
            name='VehicleRitnummer',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False,
                                        primary_key=True, serialize=False)),
                ('ritnummer', models.CharField(blank=True, max_length=50,
                                               verbose_name='Ritnummer')),
                ('geldig_vanaf', models.DateField(
                    blank=True, null=True,
                    help_text='Laat leeg voor de oudste periode; die geldt vanaf het begin.',
                    verbose_name='Geldig vanaf')),
                ('notitie', models.CharField(blank=True, max_length=200,
                                             verbose_name='Notitie')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('vehicle', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ritnummer_periodes',
                    to='fleet.vehicle', verbose_name='Voertuig')),
            ],
            options={
                'verbose_name': 'Ritnummerperiode',
                'verbose_name_plural': 'Ritnummerperiodes',
                'ordering': [models.F('geldig_vanaf').asc(nulls_first=True), 'created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='vehicleritnummer',
            index=models.Index(fields=['vehicle', 'geldig_vanaf'],
                               name='fleet_vehic_vehicle_52146c_idx'),
        ),
        migrations.AddConstraint(
            model_name='vehicleritnummer',
            constraint=models.UniqueConstraint(
                condition=models.Q(('geldig_vanaf__isnull', True)),
                fields=('vehicle',), name='uniek_open_ritnummerperiode'),
        ),
        migrations.AddConstraint(
            model_name='vehicleritnummer',
            constraint=models.UniqueConstraint(
                fields=('vehicle', 'geldig_vanaf'),
                name='uniek_ritnummerperiode_per_datum'),
        ),
        migrations.RunPython(backfill_periodes, verwijder_periodes),
    ]

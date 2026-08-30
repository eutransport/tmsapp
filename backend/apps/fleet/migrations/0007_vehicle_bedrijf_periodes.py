"""Bedrijf met ingangsdatum per wagen.

Elke bestaande wagen krijgt precies een periode zonder begindatum met zijn
huidige bedrijf. Daardoor geeft een opzoeking op elke datum hetzelfde
antwoord als voorheen en verandert er functioneel niets tot er zelf een
tweede periode wordt toegevoegd.
"""
import uuid

import django.db.models.deletion
from django.db import migrations, models


def backfill_periodes(apps, schema_editor):
    """Maak per wagen een openstaande periode met het huidige bedrijf."""
    Vehicle = apps.get_model('fleet', 'Vehicle')
    VehicleBedrijf = apps.get_model('fleet', 'VehicleBedrijf')

    bestaand = set(
        VehicleBedrijf.objects.filter(geldig_vanaf__isnull=True)
        .values_list('vehicle_id', flat=True)
    )
    nieuw = [
        VehicleBedrijf(
            id=uuid.uuid4(),
            vehicle_id=wagen.id,
            bedrijf_id=wagen.bedrijf_id,
            geldig_vanaf=None,
            notitie='Automatisch aangemaakt bij invoeren van ingangsdatums.',
        )
        for wagen in Vehicle.objects.all().only('id', 'bedrijf_id')
        if wagen.id not in bestaand and wagen.bedrijf_id is not None
    ]
    if nieuw:
        VehicleBedrijf.objects.bulk_create(nieuw, batch_size=500)


def verwijder_periodes(apps, schema_editor):
    """Terugdraaien: de tabel verdwijnt toch, dus niets te doen."""


class Migration(migrations.Migration):

    dependencies = [
        ('companies', '0001_initial'),
        ('fleet', '0006_vehicle_ritnummer_periodes'),
    ]

    operations = [
        migrations.CreateModel(
            name='VehicleBedrijf',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False,
                                        primary_key=True, serialize=False)),
                ('geldig_vanaf', models.DateField(
                    blank=True, null=True,
                    help_text='Laat leeg voor de oudste periode; die geldt vanaf het begin.',
                    verbose_name='Geldig vanaf')),
                ('notitie', models.CharField(blank=True, max_length=200,
                                             verbose_name='Notitie')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('bedrijf', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='vehicle_periodes',
                    to='companies.company', verbose_name='Bedrijf')),
                ('vehicle', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='bedrijf_periodes',
                    to='fleet.vehicle', verbose_name='Voertuig')),
            ],
            options={
                'verbose_name': 'Bedrijfsperiode',
                'verbose_name_plural': 'Bedrijfsperiodes',
                'ordering': [models.F('geldig_vanaf').asc(nulls_first=True), 'created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='vehiclebedrijf',
            index=models.Index(fields=['vehicle', 'geldig_vanaf'],
                               name='fleet_vehic_vehicle_f95f27_idx'),
        ),
        migrations.AddConstraint(
            model_name='vehiclebedrijf',
            constraint=models.UniqueConstraint(
                condition=models.Q(('geldig_vanaf__isnull', True)),
                fields=('vehicle',), name='uniek_open_bedrijfsperiode'),
        ),
        migrations.AddConstraint(
            model_name='vehiclebedrijf',
            constraint=models.UniqueConstraint(
                fields=('vehicle', 'geldig_vanaf'),
                name='uniek_bedrijfsperiode_per_datum'),
        ),
        migrations.RunPython(backfill_periodes, verwijder_periodes),
    ]

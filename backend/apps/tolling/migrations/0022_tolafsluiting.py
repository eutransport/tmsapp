"""Periode-afsluiting voor de tolheffing.

Een afsluiting zet alles tot en met een gekozen dag opzij, zodat de overzichten
weer bij nul beginnen. De records blijven staan en wijzen naar de afsluiting
waarin ze zijn opgeborgen; leeg betekent lopende administratie.
"""
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import apps.tolling.models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('tolling', '0021_afrekening_bedrijf_koppelen'),
    ]

    operations = [
        migrations.CreateModel(
            name='TolAfsluiting',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False,
                                        primary_key=True, serialize=False)),
                ('tot_datum', models.DateField(
                    db_index=True,
                    help_text='Alles met een rijdatum op of voor deze dag valt in deze afsluiting.',
                    verbose_name='Afgesloten tot en met')),
                ('omschrijving', models.CharField(blank=True, max_length=200)),
                ('openstaand_meegenomen', models.BooleanField(
                    default=False, verbose_name='Openstaande passages meegenomen')),
                ('samenvatting', models.JSONField(blank=True, default=dict)),
                ('uitgevoerd_op', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('teruggedraaid_op', models.DateTimeField(blank=True, null=True)),
                ('uitgevoerd_door', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='tol_afsluitingen', to=settings.AUTH_USER_MODEL,
                    verbose_name='Afgesloten door')),
                ('teruggedraaid_door', models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='teruggedraaide_tol_afsluitingen',
                    to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'verbose_name': 'Tolafsluiting',
                'verbose_name_plural': 'Tolafsluitingen',
                'ordering': ['-tot_datum', '-uitgevoerd_op'],
            },
        ),
        migrations.AddField(
            model_name='tollingimportbatch',
            name='afsluiting',
            field=apps.tolling.models.afsluiting_veld('import_batches'),
        ),
        migrations.AddField(
            model_name='tollingevent',
            name='afsluiting',
            field=apps.tolling.models.afsluiting_veld('events'),
        ),
        migrations.AddField(
            model_name='tollingevent',
            name='archief_onafgehandeld',
            field=models.BooleanField(
                default=False, verbose_name='Afgesloten zonder facturatie'),
        ),
        migrations.AddField(
            model_name='openstaandetoldag',
            name='afsluiting',
            field=apps.tolling.models.afsluiting_veld('tol_dagen'),
        ),
        migrations.AddField(
            model_name='privatetollregistration',
            name='afsluiting',
            field=apps.tolling.models.afsluiting_veld('prive_registraties'),
        ),
        migrations.AddField(
            model_name='tolafrekening',
            name='afsluiting',
            field=apps.tolling.models.afsluiting_veld('afrekeningen'),
        ),
    ]

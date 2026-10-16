import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('tolling', '0014_tariefbron'),
    ]

    operations = [
        migrations.CreateModel(
            name='TolStation',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('naam', models.CharField(max_length=255, unique=True, verbose_name='Stationsnaam')),
                ('land', models.CharField(blank=True, max_length=2, verbose_name='Land')),
                ('voorstel', models.CharField(blank=True, max_length=2, verbose_name='Voorgesteld land')),
                ('bevestigd_op', models.DateTimeField(blank=True, null=True, verbose_name='Bevestigd op')),
                ('aantal_regels', models.PositiveIntegerField(default=0, verbose_name='Aantal regels gezien')),
                ('laatst_gezien', models.DateTimeField(blank=True, null=True, verbose_name='Laatst gezien')),
                ('bevestigd_door', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='bevestigde_tolstations', to=settings.AUTH_USER_MODEL,
                    verbose_name='Bevestigd door')),
            ],
            options={
                'verbose_name': 'Tolstation',
                'verbose_name_plural': 'Tolstations',
                'ordering': ['-laatst_gezien', 'naam'],
            },
        ),
    ]

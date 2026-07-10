"""Add PrivateTollRegistration model + private fields on TollingEvent."""
import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0001_initial'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='PrivateTollRegistration',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('datum', models.DateField(verbose_name='Datum')),
                ('begin_tijd', models.TimeField(verbose_name='Begintijd')),
                ('eind_tijd', models.TimeField(verbose_name='Eindtijd')),
                ('license_plate_raw', models.CharField(max_length=32, verbose_name='Kenteken')),
                ('license_plate_normalized', models.CharField(db_index=True, max_length=32, verbose_name='Kenteken (genormaliseerd)')),
                ('notitie', models.CharField(blank=True, max_length=255, verbose_name='Notitie')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='private_toll_registrations', to=settings.AUTH_USER_MODEL, verbose_name='Chauffeur')),
            ],
            options={
                'verbose_name': 'Privé tolregistratie',
                'verbose_name_plural': 'Privé tolregistraties',
                'ordering': ['-datum', '-begin_tijd'],
                'indexes': [
                    models.Index(fields=['user', 'datum'], name='tolling_pri_user_id_datum_idx'),
                    models.Index(fields=['license_plate_normalized', 'datum'], name='tolling_pri_plate_datum_idx'),
                ],
            },
        ),
        migrations.AddField(
            model_name='tollingevent',
            name='is_private',
            field=models.BooleanField(db_index=True, default=False, verbose_name='Privé rit'),
        ),
        migrations.AddField(
            model_name='tollingevent',
            name='private_registration',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='matched_events', to='tolling.privatetollregistration', verbose_name='Privé registratie'),
        ),
    ]

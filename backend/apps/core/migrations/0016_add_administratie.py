"""Migration: Add Administratie model."""
import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('companies', '0001_initial'),
        ('core', '0015_alter_emailprofile_oauth_client_secret_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='Administratie',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('naam', models.CharField(max_length=100, verbose_name='Naam')),
                ('beschrijving', models.TextField(blank=True, verbose_name='Beschrijving')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('bedrijven', models.ManyToManyField(
                    blank=True,
                    related_name='administraties',
                    to='companies.company',
                    verbose_name='Bedrijven',
                )),
                ('allowed_users', models.ManyToManyField(
                    blank=True,
                    help_text='Gebruikers die facturen van de gekoppelde bedrijven mogen inzien.',
                    related_name='administraties',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Gebruikers met toegang',
                )),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='created_administraties',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Aangemaakt door',
                )),
            ],
            options={
                'verbose_name': 'Administratie',
                'verbose_name_plural': 'Administraties',
                'ordering': ['naam'],
            },
        ),
    ]

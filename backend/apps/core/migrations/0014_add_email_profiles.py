"""
Migration: Add EmailProfile model for multiple outgoing email configurations.
"""
import uuid
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0013_appsettings_tachograaf_start_datum'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='EmailProfile',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=100, verbose_name='Profielnaam')),
                ('description', models.TextField(blank=True, verbose_name='Beschrijving')),
                ('is_default', models.BooleanField(
                    default=False,
                    help_text='Wordt gebruikt wanneer geen profiel is gekozen bij het versturen.',
                    verbose_name='Standaard profiel',
                )),
                ('smtp_host', models.CharField(blank=True, max_length=255, verbose_name='SMTP Host')),
                ('smtp_port', models.PositiveIntegerField(default=587, verbose_name='SMTP Poort')),
                ('smtp_username', models.CharField(blank=True, max_length=255, verbose_name='SMTP Gebruikersnaam')),
                ('smtp_password', models.CharField(blank=True, max_length=512, verbose_name='SMTP Wachtwoord')),
                ('smtp_use_tls', models.BooleanField(default=True, verbose_name='Gebruik TLS')),
                ('smtp_from_email', models.EmailField(blank=True, verbose_name='Afzender E-mail')),
                ('oauth_enabled', models.BooleanField(default=False, verbose_name='OAuth Ingeschakeld')),
                ('oauth_client_id', models.CharField(blank=True, max_length=255, verbose_name='OAuth Client ID')),
                ('oauth_client_secret', models.CharField(blank=True, max_length=512, verbose_name='OAuth Client Secret')),
                ('oauth_tenant_id', models.CharField(blank=True, max_length=255, verbose_name='OAuth Tenant ID')),
                ('email_signature', models.TextField(blank=True, verbose_name='E-mail Handtekening')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='created_email_profiles',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Aangemaakt door',
                )),
                ('allowed_users', models.ManyToManyField(
                    blank=True,
                    help_text='Leeg = alle gebruikers mogen dit profiel gebruiken.',
                    related_name='accessible_email_profiles',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Toegestane gebruikers',
                )),
            ],
            options={
                'verbose_name': 'E-mail Profiel',
                'verbose_name_plural': 'E-mail Profielen',
                'ordering': ['-is_default', 'name'],
            },
        ),
    ]

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('invoicing', '0005_add_bijlage_to_invoice'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='BankAccount',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('naam', models.CharField(max_length=100, verbose_name='Naam rekening')),
                ('bank', models.CharField(
                    choices=[
                        ('ing', 'ING'),
                        ('rabobank', 'Rabobank'),
                        ('abn_amro', 'ABN AMRO'),
                        ('sns', 'SNS Bank'),
                        ('triodos', 'Triodos Bank'),
                        ('other', 'Overig'),
                    ],
                    default='ing',
                    max_length=20,
                    verbose_name='Bank',
                )),
                ('iban', models.CharField(max_length=34, verbose_name='IBAN')),
                ('is_active', models.BooleanField(default=True, verbose_name='Actief')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='bank_accounts',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Aangemaakt door',
                )),
            ],
            options={
                'verbose_name': 'Bankrekening',
                'verbose_name_plural': 'Bankrekeningen',
                'ordering': ['naam'],
            },
        ),
        migrations.CreateModel(
            name='BankImport',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('bestandsnaam', models.CharField(max_length=255, verbose_name='Bestandsnaam')),
                ('bestandsformaat', models.CharField(default='csv', max_length=10, verbose_name='Formaat')),
                ('status', models.CharField(
                    choices=[('verwerkt', 'Verwerkt'), ('fout', 'Fout')],
                    default='verwerkt',
                    max_length=20,
                    verbose_name='Status',
                )),
                ('aantal_transacties', models.PositiveIntegerField(default=0, verbose_name='Aantal transacties')),
                ('aantal_gematcht', models.PositiveIntegerField(default=0, verbose_name='Automatisch gematcht')),
                ('foutmelding', models.TextField(blank=True, verbose_name='Foutmelding')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('bankrekening', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='imports',
                    to='banking.bankaccount',
                    verbose_name='Bankrekening',
                )),
                ('geimporteerd_door', models.ForeignKey(
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='bank_imports',
                    to=settings.AUTH_USER_MODEL,
                    verbose_name='Geïmporteerd door',
                )),
            ],
            options={
                'verbose_name': 'Bankimport',
                'verbose_name_plural': 'Bankimports',
                'ordering': ['-created_at'],
            },
        ),
        migrations.CreateModel(
            name='BankTransaction',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('datum', models.DateField(verbose_name='Datum')),
                ('bedrag', models.DecimalField(decimal_places=2, max_digits=12, verbose_name='Bedrag (+ bijschrijving, - afschrijving)')),
                ('naam_tegenpartij', models.CharField(blank=True, max_length=255, verbose_name='Naam tegenpartij')),
                ('rekeningnummer_tegenpartij', models.CharField(blank=True, max_length=50, verbose_name='IBAN tegenpartij')),
                ('omschrijving', models.TextField(blank=True, verbose_name='Omschrijving / Mededelingen')),
                ('mutatiesoort', models.CharField(blank=True, max_length=100, verbose_name='Mutatiesoort')),
                ('referentie', models.CharField(blank=True, max_length=255, verbose_name='Referentie')),
                ('match_status', models.CharField(
                    choices=[
                        ('nieuw', 'Nieuw'),
                        ('gematcht', 'Gematcht'),
                        ('handmatig', 'Handmatig gematcht'),
                        ('geen_match', 'Geen match'),
                    ],
                    default='nieuw',
                    max_length=20,
                    verbose_name='Match status',
                )),
                ('gevonden_factuurnummer', models.CharField(blank=True, max_length=50, verbose_name='Gevonden factuurnummer')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('bankrekening', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='transacties',
                    to='banking.bankaccount',
                    verbose_name='Bankrekening',
                )),
                ('gekoppelde_factuur', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='banktransacties',
                    to='invoicing.invoice',
                    verbose_name='Gekoppelde factuur',
                )),
                ('importbestand', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='transacties',
                    to='banking.bankimport',
                    verbose_name='Importbestand',
                )),
            ],
            options={
                'verbose_name': 'Banktransactie',
                'verbose_name_plural': 'Banktransacties',
                'ordering': ['-datum', '-created_at'],
                'unique_together': {('bankrekening', 'datum', 'bedrag', 'referentie', 'naam_tegenpartij')},
            },
        ),
    ]

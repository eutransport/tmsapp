"""Migration: per-administratie invoice numbering settings."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0018_appsettings_email_signature_image'),
    ]

    operations = [
        migrations.AddField(
            model_name='administratie',
            name='gebruik_eigen_facturatie',
            field=models.BooleanField(
                default=False,
                verbose_name='Eigen factuurnummering gebruiken',
                help_text='Indien aangevinkt worden onderstaande prefix en startnummers gebruikt '
                          'in plaats van de algemene instellingen.',
            ),
        ),
        migrations.AddField(
            model_name='administratie',
            name='invoice_prefix',
            field=models.CharField(
                max_length=10,
                blank=True,
                default='',
                verbose_name='Factuur Prefix',
                help_text='Korte code die voor het factuurnummer komt (bijv. "MV"). '
                          'Verplicht als eigen nummering aan staat. Voorbeeld: MV-F-2026-0001.',
            ),
        ),
        migrations.AddField(
            model_name='administratie',
            name='invoice_start_number_verkoop',
            field=models.PositiveIntegerField(default=1, verbose_name='Startnummer Verkoopfacturen'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='invoice_start_number_inkoop',
            field=models.PositiveIntegerField(default=1, verbose_name='Startnummer Inkoopfacturen'),
        ),
        migrations.AddField(
            model_name='administratie',
            name='invoice_start_number_credit',
            field=models.PositiveIntegerField(default=1, verbose_name='Startnummer Creditfacturen'),
        ),
    ]

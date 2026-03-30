from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('drivers', '0005_driver_bedrijven_m2m'),
    ]

    operations = [
        migrations.AddField(
            model_name='driver',
            name='einddatum_bestuurderspas',
            field=models.DateField(
                blank=True, null=True,
                help_text='Verloopdatum van de bestuurderspas.',
                verbose_name='Einddatum Bestuurderspas',
            ),
        ),
        migrations.AddField(
            model_name='driver',
            name='einddatum_code95',
            field=models.DateField(
                blank=True, null=True,
                help_text='Verloopdatum van Code 95 certificering.',
                verbose_name='Einddatum Code 95',
            ),
        ),
        migrations.AddField(
            model_name='driver',
            name='einddatum_adr',
            field=models.DateField(
                blank=True, null=True,
                help_text='Verloopdatum van het ADR certificaat.',
                verbose_name='Einddatum ADR',
            ),
        ),
        migrations.AddField(
            model_name='driver',
            name='einddatum_rijbewijs',
            field=models.DateField(
                blank=True, null=True,
                help_text='Verloopdatum van het rijbewijs.',
                verbose_name='Einddatum Rijbewijs',
            ),
        ),
    ]

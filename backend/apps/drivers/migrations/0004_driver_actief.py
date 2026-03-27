from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('drivers', '0003_driver_voertuig'),
    ]

    operations = [
        migrations.AddField(
            model_name='driver',
            name='actief',
            field=models.BooleanField(
                default=True,
                help_text='Inactieve chauffeurs worden niet meegeteld in urenoverzichten.',
                verbose_name='Actief',
            ),
        ),
    ]

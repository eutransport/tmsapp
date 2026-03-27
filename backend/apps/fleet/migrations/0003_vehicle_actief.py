from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fleet', '0002_vehicle_minimum_weken_per_jaar'),
    ]

    operations = [
        migrations.AddField(
            model_name='vehicle',
            name='actief',
            field=models.BooleanField(
                default=True,
                help_text='Inactieve voertuigen worden niet getoond in selectielijsten maar hun historische data blijft beschikbaar.',
                verbose_name='Actief',
            ),
        ),
    ]

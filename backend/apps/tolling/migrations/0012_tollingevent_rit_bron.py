from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0011_tollingevent_km_bron'),
    ]

    operations = [
        migrations.AddField(
            model_name='tollingevent',
            name='rit_bron',
            field=models.CharField(blank=True, help_text='planning wanneer de rit uit de weekplanning komt, anders voertuig.', max_length=20, verbose_name='Herkomst ritnummer'),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('loadlist', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='loadstop',
            name='time_window_start',
            field=models.TimeField(blank=True, help_text='Vroegste aankomsttijd (bv. 08:00)', null=True),
        ),
        migrations.AddField(
            model_name='loadstop',
            name='time_window_end',
            field=models.TimeField(blank=True, help_text='Uiterste aankomsttijd (bv. 12:00)', null=True),
        ),
    ]

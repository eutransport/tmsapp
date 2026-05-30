"""Add leave reminder fields to GlobalLeaveSettings."""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('leave', '0002_add_public_holiday'),
    ]

    operations = [
        migrations.AddField(
            model_name='globalleavesettings',
            name='leave_reminder_enabled',
            field=models.BooleanField(
                default=False,
                verbose_name='Verlofherinneringen inschakelen',
            ),
        ),
        migrations.AddField(
            model_name='globalleavesettings',
            name='leave_reminder_email',
            field=models.EmailField(
                max_length=254,
                blank=True,
                default='',
                verbose_name='E-mailadres voor verlofherinneringen',
            ),
        ),
        migrations.AddField(
            model_name='globalleavesettings',
            name='leave_reminder_weeks_before',
            field=models.JSONField(
                default=list,
                blank=True,
                verbose_name='Weken van tevoren herinneren',
                help_text='Lijst van weken vóór verlof om herinneringen te sturen, bijv. [1, 2, 3, 4]',
            ),
        ),
    ]

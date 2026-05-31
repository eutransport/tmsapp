from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pakmiddelen', '0003_add_pakmiddelen_mail_log'),
    ]

    operations = [
        migrations.AddField(
            model_name='pakmiddelenconfig',
            name='schedule_weekdays',
            field=models.JSONField(
                blank=True,
                default=list,
                help_text=(
                    'Lijst met weekdagen waarop de geplande controle mag draaien '
                    '(0=maandag t/m 6=zondag). Leeg = elke dag.'
                ),
                verbose_name='Actieve dagen',
            ),
        ),
    ]

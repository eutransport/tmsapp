from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('pakmiddelen', '0004_pakmiddelenconfig_schedule_weekdays'),
    ]

    operations = [
        migrations.AddField(
            model_name='pakmiddelenconfig',
            name='subject_templates_extra',
            field=models.JSONField(
                default=list,
                blank=True,
                help_text=(
                    'Extra onderwerp-templates die ook gelden. Een mail wordt als '
                    'ingediend gemarkeerd als minimaal één van de templates matcht. '
                    'Elke template moet {ritnummer} bevatten.'
                ),
                verbose_name='Extra onderwerp templates',
            ),
        ),
    ]

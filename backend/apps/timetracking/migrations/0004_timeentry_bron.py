from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('timetracking', '0003_importbatch_importedtimeentry'),
    ]

    operations = [
        migrations.AddField(
            model_name='timeentry',
            name='bron',
            field=models.CharField(
                choices=[('handmatig', 'Handmatig'), ('auto_import', 'Automatische import')],
                default='handmatig',
                max_length=20,
                verbose_name='Bron',
            ),
        ),
    ]

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('timetracking', '0005_tolregistratie'),
    ]

    operations = [
        migrations.AddField(
            model_name='timeentry',
            name='kilometerheffing_bedrag',
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=10, null=True,
                verbose_name='Kilometerheffing bedrag',
            ),
        ),
        migrations.AddField(
            model_name='timeentry',
            name='kilometerheffing_gefactureerd_at',
            field=models.DateTimeField(
                blank=True, null=True,
                verbose_name='Kilometerheffing gefactureerd op',
            ),
        ),
    ]

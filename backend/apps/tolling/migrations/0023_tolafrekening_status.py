from django.db import migrations, models


class Migration(migrations.Migration):
    """Bonnen waarvan de tolheffing nog niet is ingelezen in een wachtrij zetten."""

    dependencies = [
        ('tolling', '0022_tolafsluiting'),
    ]

    operations = [
        migrations.AddField(
            model_name='tolafrekening',
            name='status',
            field=models.CharField(
                choices=[('wachtrij', 'Wacht op tolgegevens'), ('verwerkt', 'Verwerkt')],
                db_index=True, default='verwerkt', max_length=16, verbose_name='Status'),
        ),
    ]

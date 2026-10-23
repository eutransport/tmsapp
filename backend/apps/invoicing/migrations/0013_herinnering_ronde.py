from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('invoicing', '0012_factuurherinnering_laatste_poging_and_more'),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='factuurherinnering',
            name='uniek_herinnering_per_fase',
        ),
        migrations.RenameField(
            model_name='factuurherinnering',
            old_name='fase',
            new_name='dagen_te_laat',
        ),
        migrations.AddField(
            model_name='factuurherinnering',
            name='ronde',
            field=models.PositiveSmallIntegerField(
                default=1, verbose_name='Hoeveelste herinnering'
            ),
        ),
        migrations.AddConstraint(
            model_name='factuurherinnering',
            constraint=models.UniqueConstraint(
                fields=('invoice', 'ronde'), name='uniek_herinnering_per_ronde'
            ),
        ),
    ]

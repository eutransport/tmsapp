from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("invoicing", "0007_alter_invoiceline_options"),
        ("core", "0016_add_administratie"),
    ]

    operations = [
        migrations.AddField(
            model_name="invoice",
            name="administratie",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="invoices",
                to="core.administratie",
                verbose_name="Administratie",
                help_text=(
                    "Administratie waaronder deze factuur valt. Bepaalt welke "
                    "gebruikers (niet-admins) de factuur kunnen inzien."
                ),
            ),
        ),
    ]

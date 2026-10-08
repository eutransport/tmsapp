from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('companies', '0001_initial'),
        ('tolling', '0007_tolafrekening_tolafrekeningregel_and_more'),
    ]

    operations = [
        migrations.AlterField(
            model_name='ritnummercorrectie',
            name='naar_ritnummer',
            field=models.CharField(blank=True, max_length=50, verbose_name='Nieuw ritnummer'),
        ),
        migrations.AddField(
            model_name='ritnummercorrectie',
            name='ritnummer_gewijzigd',
            field=models.BooleanField(default=True, verbose_name='Ritnummer aangepast'),
        ),
        migrations.AddField(
            model_name='ritnummercorrectie',
            name='naar_bedrijf',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='+', to='companies.company', verbose_name='Nieuw bedrijf'),
        ),
        migrations.AddField(
            model_name='ritnummercorrectie',
            name='bedrijf_gewijzigd',
            field=models.BooleanField(
                default=False,
                help_text='Onderscheidt "bedrijf leeggemaakt" van "bedrijf ongemoeid gelaten".',
                verbose_name='Bedrijf aangepast'),
        ),
        migrations.AddField(
            model_name='ritnummercorrectie',
            name='oude_bedrijven',
            field=models.JSONField(default=dict, verbose_name='Oude bedrijven per regel'),
        ),
    ]

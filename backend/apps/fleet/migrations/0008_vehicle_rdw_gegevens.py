"""Gegevens uit het kentekenregister van de RDW bij de wagen bewaren.

Uitsluitend nieuwe, optionele velden. Bestaande wagens houden dus precies
de gegevens die ze nu hebben; de nieuwe velden blijven leeg tot ze voor het
eerst bij de RDW opgehaald worden.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fleet', '0007_vehicle_bedrijf_periodes'),
    ]

    operations = [
        # --- Identiteit ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_merk',
            field=models.CharField(blank=True, max_length=100, verbose_name='Merk'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_handelsbenaming',
            field=models.CharField(blank=True, max_length=200, verbose_name='Handelsbenaming'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_voertuigsoort',
            field=models.CharField(blank=True, max_length=100, verbose_name='Voertuigsoort'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_inrichting',
            field=models.CharField(blank=True, max_length=100, verbose_name='Inrichting'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_voertuigcategorie',
            field=models.CharField(
                blank=True, max_length=20,
                help_text='Europese categorie, bijvoorbeeld N3.',
                verbose_name='Voertuigcategorie'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_voertuigcategorie_omschrijving',
            field=models.CharField(
                blank=True, max_length=200, verbose_name='Voertuigcategorie in woorden'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_carrosserie',
            field=models.CharField(blank=True, max_length=200, verbose_name='Soort opbouw'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_datum_eerste_toelating',
            field=models.DateField(blank=True, null=True, verbose_name='Datum eerste toelating'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_bouwjaar',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Bouwjaar'),
        ),

        # --- Keuringen ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_apk_vervaldatum',
            field=models.DateField(blank=True, null=True, verbose_name='APK geldig tot'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_tachograaf_vervaldatum',
            field=models.DateField(blank=True, null=True, verbose_name='Tachograaf geldig tot'),
        ),

        # --- Gewichten ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_massa_ledig',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Massa leeg (kg)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_massa_rijklaar',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Massa rijklaar (kg)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_max_massa',
            field=models.PositiveIntegerField(
                blank=True, null=True, verbose_name='Toegestane maximummassa (kg)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_technisch_max_massa',
            field=models.PositiveIntegerField(
                blank=True, null=True, verbose_name='Technisch toegestane massa (kg)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_max_massa_samenstelling',
            field=models.PositiveIntegerField(
                blank=True, null=True,
                help_text='Het totaalgewicht van trekker en oplegger samen.',
                verbose_name='Maximum massa samenstelling (kg)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_laadvermogen',
            field=models.PositiveIntegerField(
                blank=True, null=True,
                help_text='Toegestane maximummassa min de massa rijklaar.',
                verbose_name='Laadvermogen (kg)'),
        ),

        # --- Afmetingen ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_lengte_cm',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Lengte (cm)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_breedte_cm',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Breedte (cm)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_wielbasis_cm',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Wielbasis (cm)'),
        ),

        # --- Milieu en tolheffing ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_brandstof',
            field=models.CharField(blank=True, max_length=100, verbose_name='Brandstof'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_emissieklasse',
            field=models.CharField(
                blank=True, max_length=50,
                help_text='Bijvoorbeeld EURO VI E.',
                verbose_name='Uitlaatemissieniveau'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_euronorm',
            field=models.CharField(blank=True, max_length=50, verbose_name='Euronorm'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_co2_klasse',
            field=models.CharField(
                blank=True, max_length=10,
                help_text='Bepaalt mede het Duitse Maut-tarief.',
                verbose_name='CO2-klasse'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_co2_klasse_omschrijving',
            field=models.CharField(
                blank=True, max_length=200, verbose_name='CO2-klasse in woorden'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_vermogen_kw',
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=8, null=True,
                verbose_name='Vermogen (kW)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_geluidsniveau',
            field=models.PositiveIntegerField(
                blank=True, null=True, verbose_name='Geluidsniveau rijdend (dB)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_cilinderinhoud',
            field=models.PositiveIntegerField(
                blank=True, null=True, verbose_name='Cilinderinhoud (cm3)'),
        ),

        # --- Assen en wielen ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_aantal_assen',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Aantal assen'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_aantal_wielen',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='Aantal wielen'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_max_aslast',
            field=models.PositiveIntegerField(
                blank=True, null=True, verbose_name='Zwaarste toegestane aslast (kg)'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_assen',
            field=models.JSONField(
                blank=True, default=list,
                help_text='Per as de plaats, aandrijving en toegestane aslast.',
                verbose_name='Assen'),
        ),

        # --- Overig ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_aantal_zitplaatsen',
            field=models.PositiveIntegerField(
                blank=True, null=True, verbose_name='Aantal zitplaatsen'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_max_snelheid',
            field=models.PositiveIntegerField(
                blank=True, null=True, verbose_name='Maximumconstructiesnelheid (km/u)'),
        ),

        # --- Signalen ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_wam_verzekerd',
            field=models.BooleanField(blank=True, null=True, verbose_name='WAM-verzekerd'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_terugroepactie_open',
            field=models.BooleanField(
                blank=True, null=True, verbose_name='Openstaande terugroepactie'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_export',
            field=models.BooleanField(
                blank=True, null=True, verbose_name='Geregistreerd voor export'),
        ),

        # --- Administratie van de koppeling ---
        migrations.AddField(
            model_name='vehicle',
            name='rdw_opgehaald_op',
            field=models.DateTimeField(
                blank=True, null=True, verbose_name='Laatst opgehaald bij de RDW'),
        ),
        migrations.AddField(
            model_name='vehicle',
            name='rdw_status',
            field=models.CharField(
                blank=True, max_length=250,
                help_text='Leeg betekent: nog nooit opgehaald.',
                verbose_name='Uitkomst laatste ophaling'),
        ),
    ]

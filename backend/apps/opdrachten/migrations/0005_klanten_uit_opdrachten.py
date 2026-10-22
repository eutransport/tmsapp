from django.db import migrations


def vul_klanten(apps, schema_editor):
    """Bestaande opdrachten vormen het beginadresboek van elke opdrachtgever."""
    Opdracht = apps.get_model('opdrachten', 'Opdracht')
    OpdrachtKlant = apps.get_model('opdrachten', 'OpdrachtKlant')

    gezien = set()
    for opdracht in Opdracht.objects.all().order_by('created_at'):
        naam = (opdracht.klant_naam or '').strip()
        sleutel = (opdracht.bedrijf_id, naam.lower())
        if not naam or sleutel in gezien:
            continue
        gezien.add(sleutel)
        OpdrachtKlant.objects.get_or_create(
            bedrijf_id=opdracht.bedrijf_id,
            naam=naam,
            defaults={
                'adres': opdracht.adres,
                'postcode': opdracht.postcode,
                'plaats': opdracht.plaats,
                'contactpersoon': opdracht.contactpersoon,
                'telefoon': opdracht.telefoon,
                'geopend_tot': opdracht.geopend_tot,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ('opdrachten', '0004_opdrachtmailinstelling_mail_bij_niet_geleverd_and_more'),
    ]

    operations = [
        migrations.RunPython(vul_klanten, migrations.RunPython.noop),
    ]

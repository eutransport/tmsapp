from django.db import migrations


def nieuwste_bovenaan(apps, schema_editor):
    """Volgorde opnieuw toekennen zodat de nieuwste opdracht bovenaan staat."""
    Opdracht = apps.get_model('opdrachten', 'Opdracht')
    bedrijven = Opdracht.objects.values_list('bedrijf_id', flat=True).distinct()
    for bedrijf_id in bedrijven:
        rijen = (
            Opdracht.objects.filter(bedrijf_id=bedrijf_id)
            .order_by('-created_at').values_list('id', flat=True)
        )
        for positie, opdracht_id in enumerate(rijen, start=1):
            Opdracht.objects.filter(id=opdracht_id).update(volgorde=positie)


class Migration(migrations.Migration):

    dependencies = [
        ('opdrachten', '0007_opdracht_bestemming_lat_opdracht_bestemming_lng_and_more'),
    ]

    operations = [
        migrations.RunPython(nieuwste_bovenaan, migrations.RunPython.noop),
    ]

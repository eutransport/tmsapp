"""Eerste periode per chauffeur, zodat bestaande uren zichtbaar blijven."""
from django.db import migrations


def vul_periodes(apps, schema_editor):
    Driver = apps.get_model('drivers', 'Driver')
    Periode = apps.get_model('drivers', 'DriverBedrijfPeriode')
    TimeEntry = apps.get_model('timetracking', 'TimeEntry')

    for chauffeur in Driver.objects.filter(bedrijf__isnull=False):
        if Periode.objects.filter(driver_id=chauffeur.id).exists():
            continue
        vanaf = chauffeur.created_at.date()
        if chauffeur.gekoppelde_gebruiker_id:
            eerste = (TimeEntry.objects
                      .filter(user_id=chauffeur.gekoppelde_gebruiker_id)
                      .order_by('datum').values_list('datum', flat=True).first())
            if eerste and eerste < vanaf:
                vanaf = eerste
        Periode.objects.create(
            driver_id=chauffeur.id, bedrijf_id=chauffeur.bedrijf_id, vanaf=vanaf, tot=None
        )


class Migration(migrations.Migration):

    dependencies = [
        ('drivers', '0012_driverbedrijfperiode'),
        ('timetracking', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(vul_periodes, migrations.RunPython.noop),
    ]

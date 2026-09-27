"""De vloot bijwerken met gegevens uit het kentekenregister van de RDW.

Deze module zet wat :mod:`apps.fleet.rdw` ophaalt om naar de velden op een
wagen, en legt de opgehaalde APK-datum desgewenst vast in de APK-module
zodat de bestaande herinneringen er meteen op werken.

Wat er bewust **niet** overschreven wordt: ``type_wagen``, ``ritnummer`` en
``bedrijf``. Dat zijn uw eigen gegevens; de RDW weet niets van uw indeling.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

from django.db import transaction
from django.utils import timezone

from . import rdw
from .models import Vehicle

logger = logging.getLogger(__name__)

# De velden op Vehicle die door de RDW gevuld worden. Alles wat hier niet
# in staat blijft onaangeroerd.
RDW_VELDEN = [
    'rdw_merk', 'rdw_handelsbenaming', 'rdw_voertuigsoort', 'rdw_inrichting',
    'rdw_voertuigcategorie', 'rdw_voertuigcategorie_omschrijving',
    'rdw_carrosserie', 'rdw_datum_eerste_toelating', 'rdw_bouwjaar',
    'rdw_apk_vervaldatum', 'rdw_tachograaf_vervaldatum',
    'rdw_massa_ledig', 'rdw_massa_rijklaar', 'rdw_max_massa',
    'rdw_technisch_max_massa', 'rdw_max_massa_samenstelling', 'rdw_laadvermogen',
    'rdw_lengte_cm', 'rdw_breedte_cm', 'rdw_wielbasis_cm',
    'rdw_brandstof', 'rdw_emissieklasse', 'rdw_euronorm',
    'rdw_co2_klasse', 'rdw_co2_klasse_omschrijving',
    'rdw_vermogen_kw', 'rdw_geluidsniveau', 'rdw_cilinderinhoud',
    'rdw_aantal_assen', 'rdw_aantal_wielen', 'rdw_max_aslast', 'rdw_assen',
    'rdw_aantal_zitplaatsen', 'rdw_max_snelheid',
    'rdw_wam_verzekerd', 'rdw_terugroepactie_open', 'rdw_export',
]


def _een_jaar_eerder(dag: date) -> date:
    """Dezelfde dag een jaar eerder, ook rond 29 februari."""
    try:
        return dag.replace(year=dag.year - 1)
    except ValueError:
        return dag - timedelta(days=365)


def leeg_gemaakt(gegevens: dict) -> dict:
    """Neem alleen de RDW-velden over; sla onbekende sleutels over."""
    return {veld: gegevens[veld] for veld in RDW_VELDEN if veld in gegevens}


def werk_voertuig_bij(vehicle: Vehicle, maak_apk_record: bool = True,
                      gebruiker=None) -> dict:
    """Haal de gegevens van een wagen op bij de RDW en sla ze op.

    Geeft terug: ``{'gelukt': bool, 'gevonden': bool, 'melding': str,
    'apk_vastgelegd': bool}``.

    Een kenteken dat niet in het register staat is geen fout: dat wordt
    vastgelegd als uitkomst, zodat u ziet welke wagens aandacht nodig hebben.
    Alleen als het RDW zelf onbereikbaar is, wordt er niets opgeslagen.
    """
    # Bewust buiten een transactie: een aanvraag over het internet mag geen
    # databaseslot vasthouden zolang het RDW erover doet.
    try:
        gegevens = rdw.haal_voertuig(vehicle.kenteken)
    except rdw.RDWFout as exc:
        # Niets opslaan: de wagen is niet veranderd, alleen de poging mislukte.
        return {'gelukt': False, 'gevonden': False,
                'melding': str(exc), 'apk_vastgelegd': False}

    nu = timezone.now()

    if not gegevens.get('gevonden'):
        vehicle.rdw_opgehaald_op = nu
        vehicle.rdw_status = 'Niet gevonden in het kentekenregister'
        vehicle.save(update_fields=['rdw_opgehaald_op', 'rdw_status', 'updated_at'])
        return {'gelukt': True, 'gevonden': False,
                'melding': 'Dit kenteken staat niet in het register van de RDW.',
                'apk_vastgelegd': False}

    with transaction.atomic():
        for veld, waarde in leeg_gemaakt(gegevens).items():
            setattr(vehicle, veld, waarde)

        vehicle.rdw_opgehaald_op = nu
        vehicle.rdw_status = 'Bijgewerkt'
        vehicle.save(
            update_fields=RDW_VELDEN + ['rdw_opgehaald_op', 'rdw_status', 'updated_at'])

        apk_vastgelegd = False
        if maak_apk_record and vehicle.rdw_apk_vervaldatum:
            apk_vastgelegd = _leg_apk_vast(vehicle, vehicle.rdw_apk_vervaldatum, gebruiker)

    logger.info('RDW bijgewerkt: %s - %s', vehicle.kenteken, rdw.samenvatting(gegevens))
    return {'gelukt': True, 'gevonden': True,
            'melding': rdw.samenvatting(gegevens),
            'apk_vastgelegd': apk_vastgelegd}


def _leg_apk_vast(vehicle: Vehicle, vervaldatum: date, gebruiker=None) -> bool:
    """Zet de APK-datum van de RDW in de APK-module.

    Bestaat er al een record met dezelfde vervaldatum, dan wordt dat als de
    huidige aangemerkt en verder met rust gelaten. Zo ontstaan er geen
    dubbelen en blijven met de hand ingevulde gegevens (keuringsstation,
    kosten, opmerkingen) behouden.

    De RDW geeft alleen de vervaldatum, niet de keuringsdatum. Voor een
    bedrijfsauto geldt de APK een jaar, dus we nemen een jaar eerder aan en
    zetten dat er als opmerking bij.
    """
    from apps.maintenance.models import APKRecord

    bestaand = APKRecord.objects.filter(
        vehicle=vehicle, expiry_date=vervaldatum,
    ).order_by('-created_at').first()

    if bestaand is not None:
        if not bestaand.is_current:
            bestaand.is_current = True
            bestaand.save()
        return False

    APKRecord.objects.create(
        vehicle=vehicle,
        inspection_date=_een_jaar_eerder(vervaldatum),
        expiry_date=vervaldatum,
        passed=True,
        is_current=True,
        remarks=(
            'Automatisch opgehaald bij de RDW. De keuringsdatum is geschat op '
            'een jaar voor de vervaldatum; de RDW publiceert alleen de vervaldatum.'
        ),
        created_by=gebruiker if gebruiker is not None and gebruiker.is_authenticated else None,
    )
    return True


def werk_vloot_bij(vehicles, maak_apk_record: bool = True, gebruiker=None) -> dict:
    """Werk meerdere wagens bij en geef een samenvatting terug.

    Stopt zodra het RDW onbereikbaar blijkt: doorgaan heeft dan geen zin en
    levert alleen een rij mislukte pogingen op.
    """
    uitkomst = {
        'bijgewerkt': 0,
        'niet_gevonden': 0,
        'mislukt': 0,
        'apk_records': 0,
        'regels': [],
        'afgebroken': False,
    }

    for vehicle in vehicles:
        resultaat = werk_voertuig_bij(vehicle, maak_apk_record=maak_apk_record,
                                      gebruiker=gebruiker)
        if not resultaat['gelukt']:
            uitkomst['mislukt'] += 1
            uitkomst['regels'].append({
                'kenteken': vehicle.kenteken, 'uitkomst': 'mislukt',
                'melding': resultaat['melding'],
            })
            uitkomst['afgebroken'] = True
            uitkomst['melding'] = resultaat['melding']
            break

        if resultaat['gevonden']:
            uitkomst['bijgewerkt'] += 1
            if resultaat['apk_vastgelegd']:
                uitkomst['apk_records'] += 1
            uitkomst['regels'].append({
                'kenteken': vehicle.kenteken, 'uitkomst': 'bijgewerkt',
                'melding': resultaat['melding'],
            })
        else:
            uitkomst['niet_gevonden'] += 1
            uitkomst['regels'].append({
                'kenteken': vehicle.kenteken, 'uitkomst': 'niet gevonden',
                'melding': resultaat['melding'],
            })

    return uitkomst

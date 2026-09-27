"""Voertuiggegevens ophalen bij het open-dataregister van de RDW.

De RDW publiceert zijn kentekenregister als open data op opendata.rdw.nl.
Er is geen sleutel nodig. De gegevens staan verspreid over meerdere
bestanden; wij halen er vier op en voegen ze samen tot een plat overzicht.

Alles wat de RDW in codes teruggeeft (``BC``, ``V``, ``N``, ``N3``) wordt
hier vertaald naar gewoon Nederlands, zodat er nergens in het scherm een
onleesbare afkorting terechtkomt.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

import requests

logger = logging.getLogger(__name__)

BASIS_URL = 'https://opendata.rdw.nl/resource'

# De vier bestanden die we raadplegen.
SET_BASIS = 'm9d7-ebf2'        # Gekentekende voertuigen
SET_BRANDSTOF = '8ys7-d773'    # Brandstof en emissies
SET_ASSEN = '3huj-srit'        # Assen en aslasten
SET_CARROSSERIE = 'vezc-m2t6'  # Soort opbouw

TIME_OUT = 15  # seconden per aanvraag

# Een kenteken bestaat uitsluitend uit letters en cijfers. Deze controle
# staat er om te voorkomen dat er ooit iets anders dan een kenteken in de
# URL naar de RDW belandt.
KENTEKEN_PATROON = re.compile(r'^[A-Z0-9]{4,10}$')

# Wat er ingetikt mag worden: letters, cijfers en de scheidingstekens die
# mensen gebruiken. Alles daarbuiten wijzen we af in plaats van het weg te
# poetsen, anders zou onzin als '../../etc/passwd' stilzwijgend als het
# kenteken 'ETCPASSWD' opgezocht worden.
INVOER_PATROON = re.compile(r'^[A-Za-z0-9\- ]{4,20}$')


class RDWFout(Exception):
    """Het ophalen bij de RDW is niet gelukt."""


class KentekenFout(RDWFout):
    """De invoer is geen kenteken. Dat ligt aan de aanvraag, niet aan de RDW."""


# ---------------------------------------------------------------------------
# Vertaaltabellen: van RDW-code naar leesbaar Nederlands
# ---------------------------------------------------------------------------

VOERTUIGCATEGORIE = {
    'M1': 'Personenauto',
    'M2': 'Bus tot 5 ton',
    'M3': 'Bus zwaarder dan 5 ton',
    'N1': 'Bestel- of vrachtauto tot 3,5 ton',
    'N2': 'Vrachtauto van 3,5 tot 12 ton',
    'N3': 'Vrachtauto zwaarder dan 12 ton',
    'O1': 'Aanhanger tot 0,75 ton',
    'O2': 'Aanhanger van 0,75 tot 3,5 ton',
    'O3': 'Aanhanger van 3,5 tot 10 ton',
    'O4': 'Aanhanger zwaarder dan 10 ton',
    'L1E': 'Bromfiets',
    'T': 'Landbouwtrekker',
}

# CO2-klassen volgens de Europese verordening 2022/362. Deze klasse bepaalt
# sinds december 2023 mede het Duitse Maut-tarief, dus het loont om hem per
# wagen vast te leggen.
CO2_KLASSE = {
    '1': 'Klasse 1 - geen CO2-reductie (standaardtarief)',
    '2': 'Klasse 2 - minstens 5% minder CO2',
    '3': 'Klasse 3 - minstens 8% minder CO2',
    '4': 'Klasse 4 - CO2-arm',
    '5': 'Klasse 5 - emissievrij (elektrisch of waterstof)',
}

PLAATS_AS = {
    'V': 'Voor',
    'A': 'Achter',
    'M': 'Midden',
}


def _euronorm(code: str) -> str:
    """Vertaal de emissiecode naar een leesbare euronorm.

    De RDW geeft hier een cijfer (``6``) of de letter ``Z`` voor voertuigen
    zonder uitlaatgassen.
    """
    code = (code or '').strip().upper()
    if not code:
        return ''
    if code == 'Z':
        return 'Nulemissie (elektrisch of waterstof)'
    if code.isdigit():
        return f'Euro {code}'
    return code


# ---------------------------------------------------------------------------
# Kleine hulpjes om ruwe RDW-waarden om te zetten
# ---------------------------------------------------------------------------

def _tekst(rij: dict, sleutel: str) -> str:
    waarde = rij.get(sleutel)
    return '' if waarde is None else str(waarde).strip()


def _geheel(rij: dict, sleutel: str):
    """Geef een geheel getal, of None als het veld leeg of onbruikbaar is."""
    rauw = _tekst(rij, sleutel)
    if not rauw:
        return None
    try:
        return int(float(rauw))
    except (TypeError, ValueError):
        return None


def _kommagetal(rij: dict, sleutel: str):
    rauw = _tekst(rij, sleutel)
    if not rauw:
        return None
    try:
        return Decimal(rauw)
    except (TypeError, ValueError, InvalidOperation):
        return None


def _datum(rij: dict, sleutel: str):
    """Lees een RDW-datum.

    De RDW levert datums als ``20261104`` en daarnaast vaak nog eens als
    ``2026-11-04T00:00:00.000`` in een veld met ``_dt`` erachter. De waarde
    ``0`` betekent 'niet van toepassing'.
    """
    rauw = _tekst(rij, sleutel + '_dt') or _tekst(rij, sleutel)
    if not rauw or rauw == '0':
        return None
    cijfers = re.sub(r'[^0-9]', '', rauw)
    if len(cijfers) < 8:
        return None
    try:
        return datetime.strptime(cijfers[:8], '%Y%m%d').date()
    except ValueError:
        return None


def _jaNee(rij: dict, sleutel: str):
    """Vertaal 'Ja'/'Nee' en 'J'/'N' naar True/False; onbekend wordt None."""
    rauw = _tekst(rij, sleutel).lower()
    if rauw in ('ja', 'j', 'true', '1'):
        return True
    if rauw in ('nee', 'n', 'false', '0'):
        return False
    return None


def normaliseer_kenteken(kenteken: str) -> str:
    """Maak er ``12BVZ2`` van: hoofdletters, zonder streepjes of spaties."""
    return re.sub(r'[^A-Za-z0-9]', '', kenteken or '').upper()


# ---------------------------------------------------------------------------
# Ophalen
# ---------------------------------------------------------------------------

def _haal(dataset: str, kenteken: str) -> list:
    """Vraag een dataset op voor een kenteken en geef de rijen terug."""
    url = f'{BASIS_URL}/{dataset}.json'
    try:
        antwoord = requests.get(
            url,
            params={'kenteken': kenteken},
            timeout=TIME_OUT,
            headers={'Accept': 'application/json'},
        )
        antwoord.raise_for_status()
        gegevens = antwoord.json()
    except requests.Timeout as exc:
        raise RDWFout('De RDW reageerde niet op tijd. Probeer het zo nog eens.') from exc
    except requests.RequestException as exc:
        logger.warning('RDW-aanvraag mislukt voor %s op %s: %s', kenteken, dataset, exc)
        raise RDWFout('Het RDW is nu niet bereikbaar. Probeer het later opnieuw.') from exc
    except ValueError as exc:
        raise RDWFout('Het RDW gaf een onverwacht antwoord.') from exc

    return gegevens if isinstance(gegevens, list) else []


def haal_voertuig(kenteken: str) -> dict:
    """Haal alle gegevens van een kenteken op en geef ze plat en leesbaar terug.

    Geeft een woordenboek met ``gevonden`` erin. Is dat False, dan staat het
    kenteken niet in het register en zijn de overige velden leeg.

    Roept :class:`RDWFout` aan als het RDW zelf niet bereikbaar is; dat is
    iets anders dan een kenteken dat niet bestaat.
    """
    plat = normaliseer_kenteken(kenteken)
    if not INVOER_PATROON.match((kenteken or '').strip()) or not KENTEKEN_PATROON.match(plat):
        raise KentekenFout('Dat is geen geldig kenteken.')

    basis_rijen = _haal(SET_BASIS, plat)
    if not basis_rijen:
        return {'gevonden': False, 'kenteken': plat}

    basis = basis_rijen[0]
    brandstof_rijen = _haal(SET_BRANDSTOF, plat)
    assen_rijen = _haal(SET_ASSEN, plat)
    carrosserie_rijen = _haal(SET_CARROSSERIE, plat)

    gegevens = {'gevonden': True, 'kenteken': plat}
    gegevens.update(_uit_basis(basis))
    gegevens.update(_uit_brandstof(brandstof_rijen))
    gegevens.update(_uit_assen(assen_rijen, basis))
    gegevens.update(_uit_carrosserie(carrosserie_rijen))
    gegevens.update(_afgeleid(gegevens))
    return gegevens


# ---------------------------------------------------------------------------
# Omzetten per dataset
# ---------------------------------------------------------------------------

def _uit_basis(rij: dict) -> dict:
    categorie = _tekst(rij, 'europese_voertuigcategorie').upper()
    eerste_toelating = _datum(rij, 'datum_eerste_toelating')

    return {
        'rdw_merk': _tekst(rij, 'merk')[:100],
        'rdw_handelsbenaming': _tekst(rij, 'handelsbenaming')[:200],
        'rdw_voertuigsoort': _tekst(rij, 'voertuigsoort')[:100],
        'rdw_inrichting': _tekst(rij, 'inrichting')[:100],
        'rdw_voertuigcategorie': categorie[:20],
        'rdw_voertuigcategorie_omschrijving': VOERTUIGCATEGORIE.get(categorie, '')[:200],
        'rdw_datum_eerste_toelating': eerste_toelating,
        'rdw_bouwjaar': eerste_toelating.year if eerste_toelating else None,

        'rdw_apk_vervaldatum': _datum(rij, 'vervaldatum_apk'),
        'rdw_tachograaf_vervaldatum': _datum(rij, 'vervaldatum_tachograaf'),

        'rdw_massa_ledig': _geheel(rij, 'massa_ledig_voertuig'),
        'rdw_massa_rijklaar': _geheel(rij, 'massa_rijklaar'),
        'rdw_max_massa': _geheel(rij, 'toegestane_maximum_massa_voertuig'),
        'rdw_technisch_max_massa': _geheel(rij, 'technische_max_massa_voertuig'),
        'rdw_max_massa_samenstelling': _geheel(rij, 'maximum_massa_samenstelling'),

        'rdw_lengte_cm': _geheel(rij, 'lengte'),
        'rdw_breedte_cm': _geheel(rij, 'breedte'),
        'rdw_wielbasis_cm': _geheel(rij, 'wielbasis'),

        'rdw_aantal_wielen': _geheel(rij, 'aantal_wielen'),
        'rdw_aantal_zitplaatsen': _geheel(rij, 'aantal_zitplaatsen'),
        'rdw_cilinderinhoud': _geheel(rij, 'cilinderinhoud'),
        'rdw_max_snelheid': _geheel(rij, 'maximale_constructiesnelheid'),

        'rdw_wam_verzekerd': _jaNee(rij, 'wam_verzekerd'),
        'rdw_terugroepactie_open': _jaNee(rij, 'openstaande_terugroepactie_indicator'),
        'rdw_export': _jaNee(rij, 'export_indicator'),
    }


def _uit_brandstof(rijen: list) -> dict:
    if not rijen:
        return {}

    # Bij een hybride staan er meerdere regels; het volgnummer bepaalt de
    # hoofdbrandstof. We tonen alle soorten, maar rekenen met de eerste.
    rijen = sorted(rijen, key=lambda r: _geheel(r, 'brandstof_volgnummer') or 0)
    eerste = rijen[0]

    soorten = [_tekst(r, 'brandstof_omschrijving') for r in rijen]
    soorten = [s for s in soorten if s]

    co2_code = _tekst(eerste, 'co2_emissieklasse')
    # Een dieselmotor geeft het vermogen op als nettomaximumvermogen, een
    # elektrische als netto maximaal elektrisch vermogen.
    vermogen = (
        _kommagetal(eerste, 'nettomaximumvermogen')
        or _kommagetal(eerste, 'netto_max_vermogen_elektrisch')
        or _kommagetal(eerste, 'nominaal_continu_maximumvermogen')
    )

    return {
        'rdw_brandstof': ' / '.join(soorten)[:100],
        'rdw_emissieklasse': _tekst(eerste, 'uitlaatemissieniveau')[:50],
        'rdw_euronorm': _euronorm(_tekst(eerste, 'emissiecode_omschrijving'))[:50],
        'rdw_co2_klasse': co2_code[:10],
        'rdw_co2_klasse_omschrijving': CO2_KLASSE.get(co2_code, '')[:200],
        'rdw_vermogen_kw': vermogen,
        'rdw_geluidsniveau': _geheel(eerste, 'geluidsniveau_rijdend'),
    }


def _uit_assen(rijen: list, basis: dict) -> dict:
    """Zet de assen om naar een leesbare lijst.

    Elke as wordt een regel als: as 1, voorzijde, niet aangedreven,
    maximaal 8.000 kg.
    """
    if not rijen:
        return {'rdw_assen': [], 'rdw_aantal_assen': _geheel(basis, 'aantal_assen')}

    rijen = sorted(rijen, key=lambda r: _geheel(r, 'as_nummer') or 0)

    assen = []
    aslasten = []
    for r in rijen:
        aslast = _geheel(r, 'wettelijk_toegestane_maximum_aslast')
        if aslast:
            aslasten.append(aslast)
        plaats_code = _tekst(r, 'plaatscode_as').upper()
        assen.append({
            'nummer': _geheel(r, 'as_nummer'),
            'plaats': PLAATS_AS.get(plaats_code, plaats_code),
            'aangedreven': _jaNee(r, 'aangedreven_as'),
            'hefas': _jaNee(r, 'hefas'),
            'max_aslast_kg': aslast,
            'afstand_tot_volgende_as_cm': _geheel(r, 'afstand_tot_volgende_as_voertuig'),
        })

    aantal = _geheel(rijen[0], 'aantal_assen') or len(rijen)
    return {
        'rdw_assen': assen,
        'rdw_aantal_assen': aantal,
        'rdw_max_aslast': max(aslasten) if aslasten else None,
    }


def _uit_carrosserie(rijen: list) -> dict:
    if not rijen:
        return {}
    rij = rijen[0]
    # De Europese omschrijving is al leesbaar ('Opleggertrekker'); de code
    # ernaast ('BC') laten we bewust weg.
    omschrijving = _tekst(rij, 'type_carrosserie_europese_omschrijving')
    return {'rdw_carrosserie': omschrijving[:200]}


def _afgeleid(gegevens: dict) -> dict:
    """Bereken waarden die de RDW zelf niet levert."""
    afgeleid = {}

    # Laadvermogen volgens de gangbare definitie: wat er bovenop de wagen
    # zelf nog bij mag.
    maximum = gegevens.get('rdw_max_massa')
    rijklaar = gegevens.get('rdw_massa_rijklaar') or gegevens.get('rdw_massa_ledig')
    if maximum and rijklaar and maximum > rijklaar:
        afgeleid['rdw_laadvermogen'] = maximum - rijklaar

    return afgeleid


def samenvatting(gegevens: dict) -> str:
    """Korte regel voor in een logboek of een melding."""
    if not gegevens.get('gevonden'):
        return 'niet gevonden'
    delen = [
        gegevens.get('rdw_merk', ''),
        gegevens.get('rdw_handelsbenaming', ''),
    ]
    apk = gegevens.get('rdw_apk_vervaldatum')
    if apk:
        delen.append(f'APK tot {apk.strftime("%d-%m-%Y")}')
    return ' '.join(d for d in delen if d)


def dagen_tot(vervaldatum) -> int | None:
    """Aantal dagen tot een vervaldatum; negatief als die al voorbij is."""
    if not isinstance(vervaldatum, date):
        return None
    return (vervaldatum - date.today()).days

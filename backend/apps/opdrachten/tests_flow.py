"""Tests voor de laad- en losflow van een opdracht.

De opdrachten-app had nog geen tests; deze dekken de nieuwe tussenstappen en
bewaken dat de bestaande statussen onaangeroerd blijven.
"""
from unittest.mock import patch

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from apps.accounts.models import User, UserRole
from apps.companies.models import Company
from apps.drivers.models import Driver

from .models import Opdracht, OpdrachtFase, OpdrachtRegel, OpdrachtStatus


class BasisMixin:
    def opzetten(self):
        self.bedrijf = Company.objects.create(naam='Testvervoer')
        self.chauffeur_gebruiker = User.objects.create_user(
            username='chauffeur@test.nl', email='chauffeur@test.nl',
            password='Geheim123!', rol=UserRole.CHAUFFEUR,
        )
        self.chauffeur = Driver.objects.create(
            naam='Jan Jansen', bedrijf=self.bedrijf,
            gekoppelde_gebruiker=self.chauffeur_gebruiker,
        )
        self.opdrachtgever = User.objects.create_user(
            username='klant@test.nl', email='klant@test.nl',
            password='Geheim123!', rol=UserRole.OPDRACHTGEVER,
            opdrachtgever_bedrijf=self.bedrijf,
        )

    def maak_opdracht(self, **extra):
        gegevens = {
            'bedrijf': self.bedrijf,
            'aangemaakt_door': self.opdrachtgever,
            'chauffeur': self.chauffeur,
            'klant_naam': 'Klant BV',
            'adres': 'Dorpsstraat 1',
            'status': OpdrachtStatus.GESTART,
        }
        gegevens.update(extra)
        return Opdracht.objects.create(**gegevens)

    def url(self, opdracht, actie):
        return f'/api/opdrachten/mijn/{opdracht.id}/{actie}/'


@patch('apps.opdrachten.push._stuur', return_value=False)
@patch('apps.opdrachten.mail.meld_afgeleverd', return_value=True)
@patch('apps.opdrachten.mail.meld_niet_geleverd', return_value=True)
class ChauffeurFlowTests(BasisMixin, APITestCase):
    def setUp(self):
        self.opzetten()
        self.client.force_authenticate(user=self.chauffeur_gebruiker)

    def test_bestaande_opdracht_is_een_losopdracht(self, *_):
        """Alles wat er al stond was een bezorging; dat mag niet veranderen."""
        opdracht = self.maak_opdracht()
        self.assertFalse(opdracht.werk_laden)
        self.assertTrue(opdracht.werk_lossen)
        self.assertEqual(opdracht.fase, OpdrachtFase.ONDERWEG)
        self.assertEqual(opdracht.werksoort, 'lossen')

    def test_afmelden_kan_niet_voordat_er_begonnen_is(self, *_):
        opdracht = self.maak_opdracht()
        antwoord = self.client.post(self.url(opdracht, 'afmelden'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_400_BAD_REQUEST)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.status, OpdrachtStatus.GESTART)

    def test_wachten_kan_niet_voordat_de_chauffeur_er_is(self, *_):
        opdracht = self.maak_opdracht()
        antwoord = self.client.post(self.url(opdracht, 'wachten-op-klant'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_400_BAD_REQUEST)

    def test_volledige_losflow(self, *_):
        opdracht = self.maak_opdracht()

        antwoord = self.client.post(self.url(opdracht, 'aangekomen'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.AANGEKOMEN)
        self.assertIsNotNone(opdracht.aangekomen_op)
        self.assertFalse(opdracht.aangekomen_automatisch)
        # De opdracht blijft onderweg voor alle bestaande filters.
        self.assertEqual(opdracht.status, OpdrachtStatus.GESTART)

        antwoord = self.client.post(self.url(opdracht, 'wachten-op-klant'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.WACHTEN)
        self.assertIsNotNone(opdracht.wachten_sinds)

        antwoord = self.client.post(self.url(opdracht, 'begonnen'), {'soort': 'lossen'})
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.BEZIG_LOSSEN)
        self.assertIsNotNone(opdracht.lossen_gestart_op)

        antwoord = self.client.post(self.url(opdracht, 'afmelden'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.status, OpdrachtStatus.AFGELEVERD)

    def test_volledige_laadflow(self, *_):
        opdracht = self.maak_opdracht(werk_laden=True, werk_lossen=False)
        self.assertEqual(opdracht.werksoort, 'laden')

        self.client.post(self.url(opdracht, 'aangekomen'), {})
        # Zonder soort kiest de server de enige mogelijkheid.
        antwoord = self.client.post(self.url(opdracht, 'begonnen'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.BEZIG_LADEN)
        self.assertIsNotNone(opdracht.laden_gestart_op)

        antwoord = self.client.post(self.url(opdracht, 'afmelden'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.status, OpdrachtStatus.AFGELEVERD)

    def test_lossen_mag_niet_bij_een_zuivere_laadopdracht(self, *_):
        opdracht = self.maak_opdracht(werk_laden=True, werk_lossen=False)
        self.client.post(self.url(opdracht, 'aangekomen'), {})
        antwoord = self.client.post(self.url(opdracht, 'begonnen'), {'soort': 'lossen'})
        self.assertEqual(antwoord.status_code, status.HTTP_400_BAD_REQUEST)

    def test_laden_en_lossen_op_hetzelfde_adres(self, *_):
        opdracht = self.maak_opdracht(werk_laden=True, werk_lossen=True)
        self.assertEqual(opdracht.werksoort, 'beide')

        self.client.post(self.url(opdracht, 'aangekomen'), {})
        self.client.post(self.url(opdracht, 'begonnen'), {'soort': 'lossen'})
        self.client.post(self.url(opdracht, 'begonnen'), {'soort': 'laden'})
        opdracht.refresh_from_db()
        # Beide momenten blijven bewaard, ook al toont de fase alleen het laatste.
        self.assertIsNotNone(opdracht.lossen_gestart_op)
        self.assertIsNotNone(opdracht.laden_gestart_op)
        self.assertEqual(opdracht.fase, OpdrachtFase.BEZIG_LADEN)

    def test_notitie_bij_een_tussenstap_blijft_bewaard(self, *_):
        opdracht = self.maak_opdracht(chauffeur_reactie='Eerste melding')
        self.client.post(
            self.url(opdracht, 'aangekomen'), {'chauffeur_reactie': 'Staat voor de poort'}
        )
        opdracht.refresh_from_db()
        self.assertIn('Eerste melding', opdracht.chauffeur_reactie)
        self.assertIn('Staat voor de poort', opdracht.chauffeur_reactie)

    def test_starten_zet_de_fase_terug_op_onderweg(self, *_):
        opdracht = self.maak_opdracht(
            status=OpdrachtStatus.NIEUW, fase=OpdrachtFase.AANGEKOMEN,
        )
        with patch('apps.opdrachten.eta.ververs', return_value=0), \
                patch('apps.opdrachten.mail.meld_gestart', return_value=True):
            antwoord = self.client.post(self.url(opdracht, 'starten'), {})
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.ONDERWEG)
        self.assertIsNone(opdracht.aangekomen_op)

    def test_niet_geleverd_mag_al_bij_aankomst(self, *_):
        """Een gesloten pand merk je voordat je begint; dat mag niet klemlopen."""
        opdracht = self.maak_opdracht(fase=OpdrachtFase.AANGEKOMEN)
        antwoord = self.client.post(
            self.url(opdracht, 'niet-geleverd'), {'niet_geleverd_reden': 'Pand gesloten'}
        )
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.status, OpdrachtStatus.NIET_GELEVERD)

    def test_chauffeur_ziet_de_regels(self, *_):
        opdracht = self.maak_opdracht()
        OpdrachtRegel.objects.create(
            opdracht=opdracht, ordernummer='HMMU6426781',
            omschrijving='PEAR 999 BOX', aantal_pallets=9,
        )
        antwoord = self.client.get('/api/opdrachten/mijn/')
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK)
        regel = antwoord.data[0]['regels'][0]
        self.assertEqual(regel['ordernummer'], 'HMMU6426781')
        self.assertEqual(regel['aantal_pallets'], 9)
        self.assertEqual(antwoord.data[0]['werk_omschrijving'], 'Lossen')


@patch('apps.opdrachten.push._stuur', return_value=False)
class OpdrachtgeverTests(BasisMixin, APITestCase):
    def setUp(self):
        self.opzetten()
        self.client.force_authenticate(user=self.opdrachtgever)

    def _basisgegevens(self, **extra):
        gegevens = {
            'chauffeur': str(self.chauffeur.id),
            'klant_naam': 'Klant BV',
            'adres': 'Dorpsstraat 1',
        }
        gegevens.update(extra)
        return gegevens

    def test_opdracht_met_regels_aanmaken(self, *_):
        antwoord = self.client.post('/api/portaal/opdrachten/', self._basisgegevens(
            werk_laden=True,
            werk_lossen=False,
            regels=[
                {'ordernummer': 'HMMU6426781', 'omschrijving': 'PEAR 999 BOX',
                 'aantal_pallets': 9, 'soort': 'laden'},
                {'ordernummer': 'CLKU5011377', 'omschrijving': 'PEAR 999 BOX',
                 'aantal_pallets': 9, 'soort': 'laden'},
            ],
        ), format='json')

        self.assertEqual(antwoord.status_code, status.HTTP_201_CREATED, antwoord.data)
        opdracht = Opdracht.objects.get(id=antwoord.data['id'])
        self.assertTrue(opdracht.werk_laden)
        self.assertFalse(opdracht.werk_lossen)
        self.assertEqual(opdracht.regels.count(), 2)
        self.assertEqual(opdracht.regels.first().ordernummer, 'HMMU6426781')

    def test_opdracht_zonder_werk_wordt_geweigerd(self, *_):
        antwoord = self.client.post('/api/portaal/opdrachten/', self._basisgegevens(
            werk_laden=False, werk_lossen=False,
        ), format='json')
        self.assertEqual(antwoord.status_code, status.HTTP_400_BAD_REQUEST)

    def test_regels_bijwerken_vervangt_de_oude(self, *_):
        opdracht = self.maak_opdracht(status=OpdrachtStatus.NIEUW)
        OpdrachtRegel.objects.create(opdracht=opdracht, ordernummer='OUD', aantal_pallets=1)

        antwoord = self.client.patch(
            f'/api/portaal/opdrachten/{opdracht.id}/',
            {'regels': [{'ordernummer': 'NIEUW', 'omschrijving': '', 'aantal_pallets': 4}]},
            format='json',
        )
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK, antwoord.data)
        self.assertEqual(opdracht.regels.count(), 1)
        self.assertEqual(opdracht.regels.first().ordernummer, 'NIEUW')

    def test_regels_niet_meesturen_laat_ze_staan(self, *_):
        opdracht = self.maak_opdracht(status=OpdrachtStatus.NIEUW)
        OpdrachtRegel.objects.create(opdracht=opdracht, ordernummer='BLIJFT', aantal_pallets=1)

        antwoord = self.client.patch(
            f'/api/portaal/opdrachten/{opdracht.id}/', {'klant_naam': 'Anders'}, format='json'
        )
        self.assertEqual(antwoord.status_code, status.HTTP_200_OK, antwoord.data)
        self.assertEqual(opdracht.regels.count(), 1)
        self.assertEqual(opdracht.regels.first().ordernummer, 'BLIJFT')


class AutomatischeAankomstTests(BasisMixin, APITestCase):
    def setUp(self):
        self.opzetten()

    def _ververs(self, opdracht, lat, lng):
        from . import eta as eta_module

        posities = {'AB12CD': {'plate_number': 'AB-12-CD', 'latitude': lat, 'longitude': lng}}
        with patch.object(eta_module, '_posities_per_kenteken', return_value=posities), \
                patch.object(eta_module, 'road_matrix', return_value=([[0, 1000]], [[0, 120]], 'x')), \
                patch('apps.opdrachten.push._stuur', return_value=False):
            eta_module.ververs([opdracht], geforceerd=True)

    def test_dichtbij_het_adres_meldt_automatisch_aankomst(self):
        opdracht = self.maak_opdracht(
            kenteken='AB-12-CD', bestemming_lat=52.0, bestemming_lng=5.0
        )
        # Ongeveer honderd meter naar het noorden.
        self._ververs(opdracht, 52.0009, 5.0)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.AANGEKOMEN)
        self.assertTrue(opdracht.aangekomen_automatisch)
        self.assertIsNotNone(opdracht.aangekomen_op)

    def test_ver_weg_meldt_geen_aankomst(self):
        opdracht = self.maak_opdracht(
            kenteken='AB-12-CD', bestemming_lat=52.0, bestemming_lng=5.0
        )
        # Ruim vijf kilometer naar het noorden.
        self._ververs(opdracht, 52.05, 5.0)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.ONDERWEG)
        self.assertFalse(opdracht.aangekomen_automatisch)

    def test_gps_zet_een_werkende_chauffeur_nooit_terug(self):
        opdracht = self.maak_opdracht(
            kenteken='AB-12-CD', bestemming_lat=52.0, bestemming_lng=5.0,
            fase=OpdrachtFase.BEZIG_LOSSEN,
        )
        self._ververs(opdracht, 52.0009, 5.0)
        opdracht.refresh_from_db()
        self.assertEqual(opdracht.fase, OpdrachtFase.BEZIG_LOSSEN)

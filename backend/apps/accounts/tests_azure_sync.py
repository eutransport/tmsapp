"""
Tests voor het aanmaken van accounts in Entra ID via Microsoft Graph.

Er wordt nooit echt met Azure gepraat: alle netwerkverkeer is vervangen.
Wat hier wordt vastgelegd is het gedrag waar we op rekenen, inclusief de
gevallen waarin het mis kan gaan.
"""
from datetime import date, timedelta
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts import graph
from apps.accounts.azure_sync import (
    synchroniseer_gebruiker_met_azure,
    werk_azure_status_bij,
)
from apps.core.models import AppSettings

User = get_user_model()


class NepAntwoord:
    """Een antwoord van Microsoft, zonder netwerk."""

    def __init__(self, status_code=200, data=None):
        self.status_code = status_code
        self._data = data if data is not None else {}

    def json(self):
        return self._data


def _zet_koppeling_aan(**extra):
    instellingen = AppSettings.get_settings()
    instellingen.entra_sync_enabled = True
    instellingen.entra_sync_client_id = 'client-123'
    instellingen.entra_sync_client_secret = 'geheim-123'
    instellingen.entra_sync_domain = 'moveo-bv.nl'
    for sleutel, waarde in extra.items():
        setattr(instellingen, sleutel, waarde)
    instellingen.save()
    return instellingen


class GraphBasisTests(TestCase):
    def setUp(self):
        cache.clear()
        self.gebruiker = User.objects.create_user(
            email='jan@moveo-bv.nl',
            username='jan',
            voornaam='Jan',
            achternaam='Jansen',
            password='Wachtwoord123!',
        )

    def test_staat_uit_zonder_instellingen(self):
        self.assertFalse(graph.is_ingeschakeld())

    def test_staat_uit_als_geheim_ontbreekt(self):
        _zet_koppeling_aan(entra_sync_client_secret='')
        self.assertFalse(graph.is_ingeschakeld())

    def test_geheim_staat_versleuteld_in_de_database(self):
        """Het geheim mag nooit leesbaar in de database belanden."""
        _zet_koppeling_aan()
        from django.db import connection

        with connection.cursor() as cur:
            cur.execute(
                'SELECT entra_sync_client_secret FROM core_appsettings LIMIT 1'
            )
            rauw = cur.fetchone()[0]

        self.assertNotIn('geheim-123', rauw)
        self.assertTrue(rauw.startswith('enc:'))
        # En er moet wel gewoon uit te lezen zijn via het model.
        self.assertEqual(
            AppSettings.get_settings().entra_sync_client_secret, 'geheim-123'
        )

    def test_wachtwoord_voldoet_aan_alle_vier_de_groepen(self):
        for _ in range(25):
            ww = graph.genereer_wachtwoord()
            self.assertGreaterEqual(len(ww), 20)
            self.assertTrue(any(t.islower() for t in ww))
            self.assertTrue(any(t.isupper() for t in ww))
            self.assertTrue(any(t.isdigit() for t in ww))
            self.assertTrue(any(t in '!@#$%^&*-_=+?' for t in ww))

    def test_inlognaam_behoudt_adres_op_eigen_domein(self):
        self.assertEqual(
            graph.stel_inlognaam_voor(self.gebruiker, 'moveo-bv.nl'),
            'jan@moveo-bv.nl',
        )

    def test_inlognaam_neemt_ander_domein_over(self):
        self.gebruiker.email = 'mehmet@dho.nl'
        self.assertEqual(
            graph.stel_inlognaam_voor(self.gebruiker, 'moveo-bv.nl'),
            'mehmet@moveo-bv.nl',
        )

    def test_inlognaam_zonder_emailadres_is_een_fout(self):
        self.gebruiker.email = ''
        with self.assertRaises(graph.GraphFout):
            graph.stel_inlognaam_voor(self.gebruiker, 'moveo-bv.nl')

    def test_inlognaam_zonder_domein_is_een_fout(self):
        with self.assertRaises(graph.GraphNietIngesteld):
            graph.stel_inlognaam_voor(self.gebruiker, '')


@override_settings(ENTRA_TENANT_ID='tenant-abc')
class GraphVerkeerTests(TestCase):
    def setUp(self):
        cache.clear()
        _zet_koppeling_aan()
        self.gebruiker = User.objects.create_user(
            email='jan@moveo-bv.nl',
            username='jan',
            voornaam='Jan',
            achternaam='Jansen',
            password='Wachtwoord123!',
        )

    def test_token_wordt_hergebruikt(self):
        """Veertig gebruikers synchroniseren mag niet veertig aanmeldingen kosten."""
        with patch('apps.accounts.graph.requests.post') as post:
            post.return_value = NepAntwoord(
                200, {'access_token': 'abc', 'expires_in': 3600}
            )
            self.assertEqual(graph._haal_token(), 'abc')
            self.assertEqual(graph._haal_token(), 'abc')
            self.assertEqual(post.call_count, 1)

    def test_geheim_wijzigen_maakt_bewaard_token_ongeldig(self):
        cache.set(graph.TOKEN_CACHE_KEY, 'oud-token', 3600)
        graph.vergeet_token()
        self.assertIsNone(cache.get(graph.TOKEN_CACHE_KEY))

    def test_ontbrekende_rechten_geven_een_begrijpelijke_melding(self):
        with patch('apps.accounts.graph._haal_token', return_value='abc'), \
             patch('apps.accounts.graph.requests.request') as req:
            req.return_value = NepAntwoord(403, {})
            with self.assertRaises(graph.GraphFout) as ctx:
                graph.zoek_account('jan@moveo-bv.nl')

        self.assertIn('User.Create', str(ctx.exception))

    def test_verlopen_geheim_wist_het_bewaarde_token(self):
        cache.set(graph.TOKEN_CACHE_KEY, 'oud-token', 3600)
        with patch('apps.accounts.graph._haal_token', return_value='oud-token'), \
             patch('apps.accounts.graph.requests.request') as req:
            req.return_value = NepAntwoord(401, {})
            with self.assertRaises(graph.GraphFout):
                graph.zoek_account('jan@moveo-bv.nl')

        self.assertIsNone(cache.get(graph.TOKEN_CACHE_KEY))

    def test_apostrof_in_adres_breekt_het_zoekfilter_niet(self):
        with patch('apps.accounts.graph._haal_token', return_value='abc'), \
             patch('apps.accounts.graph.requests.request') as req:
            req.return_value = NepAntwoord(200, {'value': []})
            graph.zoek_account("o'brien@moveo-bv.nl")
            filter_tekst = req.call_args.kwargs['params']['$filter']

        self.assertIn("o''brien@moveo-bv.nl", filter_tekst)

    def test_nieuw_account_moet_wachtwoord_wijzigen(self):
        with patch('apps.accounts.graph._haal_token', return_value='abc'), \
             patch('apps.accounts.graph.requests.request') as req:
            req.return_value = NepAntwoord(
                201, {'id': 'oid-1', 'userPrincipalName': 'jan@moveo-bv.nl'}
            )
            gegevens, wachtwoord = graph.maak_account(
                self.gebruiker, 'jan@moveo-bv.nl'
            )
            verstuurd = req.call_args.kwargs['json']

        self.assertTrue(verstuurd['passwordProfile']['forceChangePasswordNextSignIn'])
        self.assertEqual(verstuurd['passwordProfile']['password'], wachtwoord)
        self.assertEqual(gegevens['id'], 'oid-1')


@override_settings(ENTRA_TENANT_ID='tenant-abc')
class SynchronisatieTests(TestCase):
    def setUp(self):
        cache.clear()
        _zet_koppeling_aan()
        self.gebruiker = User.objects.create_user(
            email='jan@moveo-bv.nl',
            username='jan',
            voornaam='Jan',
            achternaam='Jansen',
            password='Wachtwoord123!',
        )

    def test_bestaand_account_wordt_gekoppeld_en_niet_aangemaakt(self):
        with patch('apps.accounts.graph.zoek_account') as zoek, \
             patch('apps.accounts.graph.maak_account') as maak:
            zoek.return_value = {
                'id': 'oid-bestaat',
                'userPrincipalName': 'jan@moveo-bv.nl',
            }
            resultaat = synchroniseer_gebruiker_met_azure(self.gebruiker)

        maak.assert_not_called()
        self.assertEqual(resultaat['status'], 'gekoppeld')
        self.gebruiker.refresh_from_db()
        self.assertEqual(self.gebruiker.entra_object_id, 'oid-bestaat')

    def test_ontbrekend_account_wordt_aangemaakt(self):
        with patch('apps.accounts.graph.zoek_account', return_value=None), \
             patch('apps.accounts.graph.maak_account') as maak:
            maak.return_value = (
                {'id': 'oid-nieuw', 'userPrincipalName': 'jan@moveo-bv.nl'},
                'StartWachtwoord1!',
            )
            resultaat = synchroniseer_gebruiker_met_azure(self.gebruiker)

        self.assertEqual(resultaat['status'], 'aangemaakt')
        self.assertEqual(resultaat['wachtwoord'], 'StartWachtwoord1!')
        self.gebruiker.refresh_from_db()
        self.assertEqual(self.gebruiker.entra_object_id, 'oid-nieuw')

    def test_al_gekoppelde_gebruiker_raakt_azure_niet_aan(self):
        self.gebruiker.entra_object_id = 'oid-al'
        self.gebruiker.save()

        with patch('apps.accounts.graph.zoek_account') as zoek, \
             patch('apps.accounts.graph.maak_account') as maak:
            resultaat = synchroniseer_gebruiker_met_azure(self.gebruiker)

        zoek.assert_not_called()
        maak.assert_not_called()
        self.assertEqual(resultaat['status'], 'al_gekoppeld')

    def test_zoekt_ook_op_het_oorspronkelijke_emailadres(self):
        """
        Iemand met een extern adres kan in Azure al bestaan onder datzelfde
        adres. Dan mag er geen tweede account ontstaan.
        """
        self.gebruiker.email = 'mehmet@dho.nl'
        self.gebruiker.save()

        gezocht = []

        def nep_zoek(adres):
            gezocht.append(adres)
            if adres == 'mehmet@dho.nl':
                return {'id': 'oid-extern', 'userPrincipalName': 'mehmet@dho.nl'}
            return None

        with patch('apps.accounts.graph.zoek_account', side_effect=nep_zoek), \
             patch('apps.accounts.graph.maak_account') as maak:
            resultaat = synchroniseer_gebruiker_met_azure(self.gebruiker)

        maak.assert_not_called()
        self.assertEqual(gezocht, ['mehmet@moveo-bv.nl', 'mehmet@dho.nl'])
        self.assertEqual(resultaat['status'], 'gekoppeld')

    def test_uitgeschakelde_koppeling_doet_niets(self):
        _zet_koppeling_aan(entra_sync_enabled=False)
        with self.assertRaises(graph.GraphNietIngesteld):
            synchroniseer_gebruiker_met_azure(self.gebruiker)


@override_settings(ENTRA_TENANT_ID='tenant-abc')
class SynchronisatieApiTests(TestCase):
    def setUp(self):
        cache.clear()
        _zet_koppeling_aan()
        self.admin = User.objects.create_user(
            email='admin@moveo-bv.nl',
            username='admin',
            voornaam='Ad',
            achternaam='Min',
            password='Wachtwoord123!',
            rol='admin',
        )
        self.chauffeur = User.objects.create_user(
            email='piet@moveo-bv.nl',
            username='piet',
            voornaam='Piet',
            achternaam='Pietersen',
            password='Wachtwoord123!',
            rol='chauffeur',
        )
        self.client = APIClient()

    def _als_admin(self):
        self.client.force_authenticate(user=self.admin)

    def test_gewone_gebruiker_mag_niet_synchroniseren(self):
        self.client.force_authenticate(user=self.chauffeur)
        antwoord = self.client.post(
            f'/api/auth/users/{self.chauffeur.id}/azure-sync/'
        )
        self.assertIn(antwoord.status_code, (403, 404))

    def test_admin_maakt_account_aan_en_krijgt_wachtwoord_eenmalig(self):
        self._als_admin()
        with patch('apps.accounts.graph.zoek_account', return_value=None), \
             patch('apps.accounts.graph.maak_account') as maak:
            maak.return_value = (
                {'id': 'oid-x', 'userPrincipalName': 'piet@moveo-bv.nl'},
                'Start1!Wachtwoord',
            )
            antwoord = self.client.post(
                f'/api/auth/users/{self.chauffeur.id}/azure-sync/'
            )

        self.assertEqual(antwoord.status_code, 200)
        self.assertEqual(antwoord.data['status'], 'aangemaakt')
        self.assertEqual(antwoord.data['wachtwoord'], 'Start1!Wachtwoord')

        # Het wachtwoord mag nergens bewaard zijn.
        self.chauffeur.refresh_from_db()
        self.assertNotIn('Start1!Wachtwoord', str(self.chauffeur.__dict__))

    def test_fout_bij_azure_geeft_geen_serverfout_maar_uitleg(self):
        self._als_admin()
        with patch(
            'apps.accounts.graph.zoek_account',
            side_effect=graph.GraphFout('Azure is niet bereikbaar'),
        ):
            antwoord = self.client.post(
                f'/api/auth/users/{self.chauffeur.id}/azure-sync/'
            )

        self.assertEqual(antwoord.status_code, 502)
        self.assertIn('niet bereikbaar', antwoord.data['error'])

    def test_sync_alles_slaat_gekoppelde_gebruikers_over(self):
        self.admin.entra_object_id = 'oid-admin'
        self.admin.save()

        self._als_admin()
        with patch('apps.accounts.graph.zoek_account', return_value=None), \
             patch('apps.accounts.graph.maak_account') as maak:
            maak.return_value = (
                {'id': 'oid-piet', 'userPrincipalName': 'piet@moveo-bv.nl'},
                'Start1!Wachtwoord',
            )
            antwoord = self.client.post('/api/auth/users/azure-sync-alles/')

        self.assertEqual(antwoord.status_code, 200)
        self.assertEqual(antwoord.data['aangemaakt'], ['piet@moveo-bv.nl'])
        self.assertEqual(antwoord.data['overgeslagen'], ['admin@moveo-bv.nl'])
        self.assertEqual(maak.call_count, 1)

    def test_een_mislukking_stopt_de_hele_ronde_niet(self):
        self._als_admin()

        def nep_zoek(adres):
            if adres.startswith('piet'):
                raise graph.GraphFout('Deze gaat mis')
            return None

        with patch('apps.accounts.graph.zoek_account', side_effect=nep_zoek), \
             patch('apps.accounts.graph.maak_account') as maak:
            maak.return_value = (
                {'id': 'oid-admin', 'userPrincipalName': 'admin@moveo-bv.nl'},
                'Start1!Wachtwoord',
            )
            antwoord = self.client.post('/api/auth/users/azure-sync-alles/')

        self.assertEqual(antwoord.data['aangemaakt'], ['admin@moveo-bv.nl'])
        self.assertEqual(len(antwoord.data['mislukt']), 1)
        self.assertEqual(antwoord.data['mislukt'][0]['email'], 'piet@moveo-bv.nl')

    def test_overzicht_toont_voorstel_zonder_iets_aan_te_maken(self):
        self._als_admin()
        with patch('apps.accounts.graph.maak_account') as maak:
            antwoord = self.client.get('/api/auth/users/azure-overzicht/')

        maak.assert_not_called()
        self.assertEqual(antwoord.status_code, 200)
        voorstellen = {r['email']: r['voorstel'] for r in antwoord.data['gebruikers']}
        self.assertEqual(voorstellen['piet@moveo-bv.nl'], 'piet@moveo-bv.nl')


class WachtwoordLoginUitTests(TestCase):
    def setUp(self):
        cache.clear()
        self.gebruiker = User.objects.create_user(
            email='jan@moveo-bv.nl',
            username='jan',
            voornaam='Jan',
            achternaam='Jansen',
            password='Wachtwoord123!',
        )
        self.client = APIClient()

    def test_inloggen_met_wachtwoord_lukt_normaal(self):
        antwoord = self.client.post(
            '/api/auth/login/',
            {'email': 'jan@moveo-bv.nl', 'password': 'Wachtwoord123!'},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 200)

    def test_inloggen_met_wachtwoord_wordt_geweigerd_als_het_uitstaat(self):
        self.gebruiker.wachtwoord_login_uitgeschakeld = True
        self.gebruiker.save()

        antwoord = self.client.post(
            '/api/auth/login/',
            {'email': 'jan@moveo-bv.nl', 'password': 'Wachtwoord123!'},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 400)
        self.assertIn('Microsoft', str(antwoord.data))

    def test_uitzetten_kan_niet_zonder_azure_account(self):
        """Anders sluit een beheerder iemand met één klik volledig buiten."""
        admin = User.objects.create_user(
            email='admin@moveo-bv.nl',
            username='admin',
            voornaam='Ad',
            achternaam='Min',
            password='Wachtwoord123!',
            rol='admin',
        )
        self.client.force_authenticate(user=admin)

        antwoord = self.client.patch(
            f'/api/auth/users/{self.gebruiker.id}/',
            {'wachtwoord_login_uitgeschakeld': True},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 400)

        self.gebruiker.entra_object_id = 'oid-1'
        self.gebruiker.save()
        antwoord = self.client.patch(
            f'/api/auth/users/{self.gebruiker.id}/',
            {'wachtwoord_login_uitgeschakeld': True},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 200)


class GeheimVervalTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_geen_datum_betekent_geen_waarschuwing(self):
        _zet_koppeling_aan(entra_sync_secret_expires_on=None)
        self.assertIsNone(graph.dagen_tot_verval())
        self.assertFalse(graph.verlooptermijn_bereikt())

    def test_waarschuwing_vanaf_een_week_vooraf(self):
        from django.utils import timezone

        vandaag = timezone.localdate()
        _zet_koppeling_aan(entra_sync_secret_expires_on=vandaag + timedelta(days=8))
        self.assertFalse(graph.verlooptermijn_bereikt())

        _zet_koppeling_aan(entra_sync_secret_expires_on=vandaag + timedelta(days=7))
        self.assertTrue(graph.verlooptermijn_bereikt())

    def test_verlopen_geheim_geeft_negatief_aantal_dagen(self):
        from django.utils import timezone

        _zet_koppeling_aan(
            entra_sync_secret_expires_on=timezone.localdate() - timedelta(days=3)
        )
        self.assertEqual(graph.dagen_tot_verval(), -3)
        self.assertTrue(graph.verlooptermijn_bereikt())


class InstellingenApiTests(TestCase):
    """De instellingenpagina mag het geheim nooit teruggeven of per ongeluk wissen."""

    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            email='admin@moveo-bv.nl',
            username='admin',
            voornaam='Ad',
            achternaam='Min',
            password='Wachtwoord123!',
            rol='admin',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)
        _zet_koppeling_aan()

    def _settings_url(self):
        return '/api/core/admin/settings/'

    def test_geheim_komt_niet_mee_in_het_antwoord(self):
        antwoord = self.client.get(self._settings_url())
        self.assertEqual(antwoord.status_code, 200)
        gegevens = antwoord.data[0] if isinstance(antwoord.data, list) else antwoord.data
        self.assertNotIn('entra_sync_client_secret', gegevens)
        self.assertTrue(gegevens['has_entra_sync_secret'])

    def test_leeg_geheim_wist_het_bestaande_niet(self):
        antwoord = self.client.patch(
            self._settings_url(),
            {'entra_sync_client_secret': '', 'entra_sync_domain': 'moveo-bv.nl'},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 200)
        self.assertEqual(
            AppSettings.get_settings().entra_sync_client_secret, 'geheim-123'
        )

    def test_nieuw_geheim_maakt_het_bewaarde_token_ongeldig(self):
        cache.set(graph.TOKEN_CACHE_KEY, 'oud-token', 3600)
        antwoord = self.client.patch(
            self._settings_url(),
            {'entra_sync_client_secret': 'geheim-nieuw'},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 200)
        self.assertIsNone(cache.get(graph.TOKEN_CACHE_KEY))
        self.assertEqual(
            AppSettings.get_settings().entra_sync_client_secret, 'geheim-nieuw'
        )

    def test_nieuwe_vervaldatum_zet_de_waarschuwing_weer_open(self):
        from django.utils import timezone

        instellingen = AppSettings.get_settings()
        instellingen.entra_sync_secret_reminder_sent_on = timezone.localdate()
        instellingen.save()

        nieuwe_datum = timezone.localdate() + timedelta(days=200)
        antwoord = self.client.patch(
            self._settings_url(),
            {'entra_sync_secret_expires_on': nieuwe_datum.isoformat()},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 200)
        self.assertIsNone(
            AppSettings.get_settings().entra_sync_secret_reminder_sent_on
        )


class HerinneringTests(TestCase):
    def setUp(self):
        cache.clear()
        from django.utils import timezone

        self.vandaag = timezone.localdate()
        _zet_koppeling_aan(
            entra_sync_secret_expires_on=self.vandaag + timedelta(days=3),
            smtp_host='smtp.test',
            smtp_port=587,
            smtp_from_email='tms@moveo-bv.nl',
            reminder_email='beheer@moveo-bv.nl',
        )

    def _taak(self):
        from apps.accounts.tasks import controleer_azure_geheim

        return controleer_azure_geheim

    def test_waarschuwing_wordt_verstuurd_en_gemarkeerd(self):
        with patch('apps.accounts.tasks.get_connection'), \
             patch('apps.accounts.tasks.EmailMessage') as mail:
            resultaat = self._taak()()

        mail.return_value.send.assert_called_once()
        self.assertEqual(resultaat['verstuurd_aan'], ['beheer@moveo-bv.nl'])
        self.assertEqual(
            AppSettings.get_settings().entra_sync_secret_reminder_sent_on,
            self.vandaag + timedelta(days=3),
        )

    def test_tweede_keer_stuurt_niets_meer(self):
        with patch('apps.accounts.tasks.get_connection'), \
             patch('apps.accounts.tasks.EmailMessage') as mail:
            self._taak()()
            self._taak()()
            self.assertEqual(mail.return_value.send.call_count, 1)

    def test_ruim_op_tijd_gebeurt_er_niets(self):
        _zet_koppeling_aan(
            entra_sync_secret_expires_on=self.vandaag + timedelta(days=60)
        )
        with patch('apps.accounts.tasks.EmailMessage') as mail:
            resultaat = self._taak()()

        mail.assert_not_called()
        self.assertEqual(resultaat, 'nog niet aan de beurt')

    def test_mislukt_verzenden_wordt_niet_gemarkeerd(self):
        """Anders komt de waarschuwing nooit meer, juist als het ertoe doet."""
        with patch('apps.accounts.tasks.get_connection'), \
             patch('apps.accounts.tasks.EmailMessage') as mail:
            mail.return_value.send.side_effect = OSError('smtp weg')
            resultaat = self._taak()()

        self.assertEqual(resultaat, 'verzenden mislukt')
        self.assertIsNone(
            AppSettings.get_settings().entra_sync_secret_reminder_sent_on
        )

    def test_verlopen_geheim_wordt_ook_gemeld(self):
        _zet_koppeling_aan(
            entra_sync_secret_expires_on=self.vandaag - timedelta(days=2)
        )
        with patch('apps.accounts.tasks.get_connection'), \
             patch('apps.accounts.tasks.EmailMessage') as mail:
            self._taak()()
            onderwerp = mail.call_args.kwargs['subject']

        self.assertIn('verlopen', onderwerp)


@override_settings(ENTRA_TENANT_ID='tenant-abc')
class AutomatischAanmakenTests(TestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            email='admin@moveo-bv.nl',
            username='admin',
            voornaam='Ad',
            achternaam='Min',
            password='Wachtwoord123!',
            rol='admin',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _maak_gebruiker(self):
        # Zonder licentie weigert het aanmaken van gebruikers; dat staat los
        # van wat hier getoetst wordt.
        with patch(
            'apps.licensing.services.check_user_limit',
            return_value={'allowed': True, 'current': 1, 'max': 0, 'message': ''},
        ):
            return self.client.post(
                '/api/auth/users/',
                {
                    'email': 'nieuw@moveo-bv.nl',
                    'username': 'nieuw',
                    'voornaam': 'Nieuw',
                    'achternaam': 'Persoon',
                    'password': 'EenHeelGoedWachtwoord123!',
                    'password_confirm': 'EenHeelGoedWachtwoord123!',
                    'rol': 'chauffeur',
                },
                format='json',
            )

    def test_uit_betekent_geen_azure_verkeer(self):
        _zet_koppeling_aan(entra_sync_auto_create=False)
        with patch('apps.accounts.graph.zoek_account') as zoek:
            antwoord = self._maak_gebruiker()

        self.assertEqual(antwoord.status_code, 201)
        zoek.assert_not_called()

    def test_aan_maakt_meteen_een_account(self):
        _zet_koppeling_aan(entra_sync_auto_create=True)
        with patch('apps.accounts.graph.zoek_account', return_value=None), \
             patch('apps.accounts.graph.maak_account') as maak:
            maak.return_value = (
                {'id': 'oid-nieuw', 'userPrincipalName': 'nieuw@moveo-bv.nl'},
                'Start1!Wachtwoord',
            )
            antwoord = self._maak_gebruiker()

        self.assertEqual(antwoord.status_code, 201)
        self.assertEqual(antwoord.data['azure']['status'], 'aangemaakt')
        self.assertEqual(antwoord.data['azure']['wachtwoord'], 'Start1!Wachtwoord')

    def test_fout_in_azure_laat_de_gebruiker_gewoon_bestaan(self):
        _zet_koppeling_aan(entra_sync_auto_create=True)
        with patch(
            'apps.accounts.graph.zoek_account',
            side_effect=graph.GraphFout('Azure ligt eruit'),
        ):
            antwoord = self._maak_gebruiker()

        self.assertEqual(antwoord.status_code, 201)
        self.assertEqual(antwoord.data['azure']['status'], 'mislukt')
        self.assertTrue(User.objects.filter(email='nieuw@moveo-bv.nl').exists())


class EntraKoppelingTests(TestCase):
    """De inlogkant moet op het Microsoft-object-ID koppelen, niet op e-mail."""

    def setUp(self):
        cache.clear()
        self.gebruiker = User.objects.create_user(
            email='jan@moveo-bv.nl',
            username='jan',
            voornaam='Jan',
            achternaam='Jansen',
            password='Wachtwoord123!',
        )

    def _claims(self, **extra):
        basis = {
            'oid': 'oid-jan',
            'preferred_username': 'jan@moveo-bv.nl',
            'email': 'jan@moveo-bv.nl',
            'given_name': 'Jan',
            'family_name': 'Jansen',
        }
        basis.update(extra)
        return basis

    def test_eerste_aanmelding_legt_het_object_id_vast(self):
        from apps.accounts.entra import zoek_of_maak_gebruiker

        gevonden = zoek_of_maak_gebruiker(self._claims())
        self.assertEqual(gevonden.id, self.gebruiker.id)

        self.gebruiker.refresh_from_db()
        self.assertEqual(self.gebruiker.entra_object_id, 'oid-jan')
        self.assertEqual(self.gebruiker.entra_upn, 'jan@moveo-bv.nl')
        self.assertIsNotNone(self.gebruiker.entra_synced_at)

    def test_gewijzigd_emailadres_breekt_de_koppeling_niet(self):
        from apps.accounts.entra import zoek_of_maak_gebruiker

        self.gebruiker.entra_object_id = 'oid-jan'
        self.gebruiker.entra_upn = 'jan@moveo-bv.nl'
        self.gebruiker.save()

        gevonden = zoek_of_maak_gebruiker(
            self._claims(email='j.jansen@moveo-bv.nl',
                         preferred_username='j.jansen@moveo-bv.nl')
        )
        self.assertEqual(gevonden.id, self.gebruiker.id)

    def test_object_id_weegt_zwaarder_dan_een_gelijk_emailadres(self):
        """Twee accounts, één e-mailadres: het object-ID bepaalt wie binnenkomt."""
        from apps.accounts.entra import zoek_of_maak_gebruiker

        ander = User.objects.create_user(
            email='gedeeld@moveo-bv.nl',
            username='ander',
            voornaam='An',
            achternaam='Der',
            password='Wachtwoord123!',
        )
        ander.entra_object_id = 'oid-ander'
        ander.save()

        gevonden = zoek_of_maak_gebruiker(
            self._claims(oid='oid-ander', email='jan@moveo-bv.nl')
        )
        self.assertEqual(gevonden.id, ander.id)

    def test_uitgeschakeld_account_komt_er_niet_in(self):
        from apps.accounts.entra import EntraTokenFout, zoek_of_maak_gebruiker

        self.gebruiker.is_active = False
        self.gebruiker.save()

        with self.assertRaises(EntraTokenFout):
            zoek_of_maak_gebruiker(self._claims())

class AzureStatusTests(TestCase):
    """Inactieve gebruikers: niet aanmaken, wel uitzetten in Azure."""

    def setUp(self):
        self.instellingen = AppSettings.get_settings()
        self.instellingen.entra_sync_enabled = True
        self.instellingen.entra_sync_client_id = 'client-1'
        self.instellingen.entra_sync_client_secret = 'geheim'
        self.instellingen.entra_sync_domain = 'moveo-bv.nl'
        self.instellingen.save()
        graph.vergeet_token()

    def test_inactieve_gebruiker_wordt_niet_gesynchroniseerd(self):
        gebruiker = User.objects.create_user(
            email='weg@moveo-bv.nl', password='x', voornaam='Weg',
            achternaam='Gebruiker', is_active=False,
        )
        with self.assertRaises(graph.GraphFout) as ctx:
            synchroniseer_gebruiker_met_azure(gebruiker)
        self.assertIn('inactief', str(ctx.exception).lower())

    def test_status_bijwerken_zet_account_uit(self):
        gebruiker = User.objects.create_user(
            email='a@moveo-bv.nl', password='x', voornaam='A', achternaam='B',
            is_active=False,
        )
        gebruiker.entra_object_id = 'oid-1'
        gebruiker.save()
        with patch('apps.accounts.graph.zet_account_status') as zet:
            resultaat = werk_azure_status_bij(gebruiker)
        self.assertEqual(resultaat, 'aangepast')
        zet.assert_called_once_with('oid-1', False)

    def test_status_bijwerken_slaat_ongekoppelde_over(self):
        gebruiker = User.objects.create_user(
            email='b@moveo-bv.nl', password='x', voornaam='A', achternaam='B',
        )
        with patch('apps.accounts.graph.zet_account_status') as zet:
            resultaat = werk_azure_status_bij(gebruiker)
        self.assertEqual(resultaat, 'niet_gekoppeld')
        zet.assert_not_called()

    def test_zet_account_status_stuurt_patch(self):
        antwoord = MagicMock(status_code=204)
        with patch('apps.accounts.graph._verzoek', return_value=antwoord) as verzoek:
            graph.zet_account_status('oid-9', True)
        methode, pad = verzoek.call_args[0]
        self.assertEqual(methode, 'PATCH')
        self.assertEqual(pad, '/users/oid-9')
        self.assertEqual(verzoek.call_args[1]['json'], {'accountEnabled': True})

    def test_zet_account_status_meldt_fout(self):
        antwoord = MagicMock(status_code=400)
        antwoord.json.return_value = {'error': {'message': 'nee'}}
        with patch('apps.accounts.graph._verzoek', return_value=antwoord):
            with self.assertRaises(graph.GraphFout):
                graph.zet_account_status('oid-9', False)

class HerkansingBijVerbodenTests(TestCase):
    """Na nieuwe toestemming moet een oud token niet blijven hangen."""

    def setUp(self):
        i = AppSettings.get_settings()
        i.entra_sync_enabled = True
        i.entra_sync_client_id = 'client-1'
        i.entra_sync_client_secret = 'geheim'
        i.entra_sync_domain = 'moveo-bv.nl'
        i.save()
        graph.vergeet_token()

    def test_403_probeert_eenmaal_met_vers_token(self):
        verboden = MagicMock(status_code=403)
        verboden.json.return_value = {}
        goed = MagicMock(status_code=200)
        with patch('apps.accounts.graph._haal_token', return_value='t'):
            with patch('apps.accounts.graph.vergeet_token') as vergeet:
                with patch(
                    'apps.accounts.graph.requests.request',
                    side_effect=[verboden, goed],
                ) as verzoek:
                    antwoord = graph._verzoek('GET', '/users/x')
        self.assertEqual(antwoord.status_code, 200)
        self.assertEqual(verzoek.call_count, 2)
        vergeet.assert_called_once()

    def test_403_blijft_fout_na_de_herkansing(self):
        verboden = MagicMock(status_code=403)
        verboden.json.return_value = {}
        with patch('apps.accounts.graph._haal_token', return_value='t'):
            with patch('apps.accounts.graph.vergeet_token'):
                with patch(
                    'apps.accounts.graph.requests.request',
                    side_effect=[verboden, verboden],
                ) as verzoek:
                    with self.assertRaises(graph.GraphFout):
                        graph._verzoek('GET', '/users/x')
        self.assertEqual(verzoek.call_count, 2)

class ChauffeurBijGebruikerTests(TestCase):
    """Een nieuwe gebruiker met rol chauffeur krijgt meteen een profiel."""

    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            email='baas@moveo-bv.nl', password='Geheim!123', voornaam='De',
            achternaam='Baas', rol='admin', is_staff=True, is_superuser=True,
        )
        self.client.force_authenticate(user=self.admin)
        self.limiet = patch(
            'apps.licensing.services.check_user_limit',
            return_value={'allowed': True, 'message': ''},
        )
        self.limiet.start()
        self.addCleanup(self.limiet.stop)

    def _maak(self, rol):
        return self.client.post('/api/auth/users/', {
            'email': f'{rol}@moveo-bv.nl',
            'username': f'{rol}gebruiker',
            'voornaam': 'Nieuwe',
            'achternaam': 'Persoon',
            'telefoon': '0612345678',
            'rol': rol,
            'password': 'Geheim!12345',
            'password_confirm': 'Geheim!12345',
        }, format='json')

    def test_chauffeur_krijgt_profiel_en_id_komt_terug(self):
        from apps.drivers.models import Driver

        antwoord = self._maak('chauffeur')
        self.assertEqual(antwoord.status_code, 201, antwoord.data)
        self.assertIn('chauffeur', antwoord.data)
        chauffeur_id = antwoord.data['chauffeur']['id']
        self.assertTrue(antwoord.data['chauffeur']['nieuw'])

        chauffeur = Driver.objects.get(id=chauffeur_id)
        gebruiker = User.objects.get(email='chauffeur@moveo-bv.nl')
        # De koppeling moet naar precies deze nieuwe gebruiker wijzen.
        self.assertEqual(chauffeur.gekoppelde_gebruiker_id, gebruiker.id)
        self.assertEqual(chauffeur.naam, gebruiker.full_name)
        self.assertEqual(chauffeur.telefoon, '0612345678')

    def test_andere_rol_krijgt_geen_profiel(self):
        from apps.drivers.models import Driver

        antwoord = self._maak('gebruiker')
        if antwoord.status_code != 201:
            self.skipTest(f'rol gebruiker niet toegestaan: {antwoord.data}')
        self.assertNotIn('chauffeur', antwoord.data)
        self.assertEqual(Driver.objects.count(), 0)

    def test_tweede_chauffeur_krijgt_eigen_profiel(self):
        from apps.drivers.models import Driver

        eerste = self._maak('chauffeur')
        tweede = self.client.post('/api/auth/users/', {
            'email': 'chauffeur2@moveo-bv.nl',
            'username': 'chauffeur2',
            'voornaam': 'Tweede',
            'achternaam': 'Persoon',
            'rol': 'chauffeur',
            'password': 'Geheim!12345',
            'password_confirm': 'Geheim!12345',
        }, format='json')
        self.assertEqual(tweede.status_code, 201, tweede.data)
        self.assertNotEqual(
            eerste.data['chauffeur']['id'], tweede.data['chauffeur']['id']
        )
        self.assertEqual(Driver.objects.count(), 2)
        gebruiker2 = User.objects.get(email='chauffeur2@moveo-bv.nl')
        chauffeur2 = Driver.objects.get(id=tweede.data['chauffeur']['id'])
        self.assertEqual(chauffeur2.gekoppelde_gebruiker_id, gebruiker2.id)

    def test_gebruiker_blijft_bestaan_als_profiel_mislukt(self):
        with patch(
            'apps.drivers.models.Driver.objects.create',
            side_effect=Exception('database weg'),
        ):
            antwoord = self._maak('chauffeur')
        self.assertEqual(antwoord.status_code, 201, antwoord.data)
        self.assertIsNone(antwoord.data['chauffeur']['id'])
        self.assertTrue(User.objects.filter(email='chauffeur@moveo-bv.nl').exists())
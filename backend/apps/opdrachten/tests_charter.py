"""Het charterportaal: een charter ziet alleen uren, tol en kaart van zijn eigen chauffeurs.

De tests loggen in met een echt JWT in de Authorization-header, zodat ook de
middleware meedoet die alle overige paden afsluit. ``force_authenticate`` zou
die laag overslaan.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from apps.accounts.models import User, UserRole
from apps.companies.models import Company
from apps.drivers.models import Charter, Driver, DriverCharterPeriode
from apps.fleet.models import Vehicle
from apps.timetracking.models import TimeEntry
from apps.tolling.models import TollingEvent

NL = ZoneInfo('Europe/Amsterdam')

UREN_URL = '/api/charter/uren/'
TOL_URL = '/api/charter/tol/'
VOERTUIGEN_URL = '/api/charter/voertuigen/'


def maak_gebruiker(email, rol, **extra):
    return User.objects.create_user(
        email=email, username=email, password='Geheim123!',
        voornaam='Test', achternaam=email.split('@')[0], rol=rol, **extra,
    )


def client_voor(gebruiker):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(gebruiker)}')
    return client


def uren(gebruiker, datum, kenteken):
    return TimeEntry.objects.create(
        user=gebruiker, datum=datum, kenteken=kenteken, ritnummer='R1',
        km_start=100, km_eind=200, aanvang=time(6, 0), eind=time(14, 0),
    )


def tol(kenteken, moment, bedrag='10.00'):
    return TollingEvent.objects.create(
        start_at=moment, end_at=moment, distance_km=Decimal('5.000'),
        amount=Decimal(bedrag), license_plate_raw=kenteken,
        license_plate_normalized=kenteken.replace('-', ''),
    )


class CharterBasis(TestCase):
    def setUp(self):
        cache.clear()
        self.opdrachtgever_bedrijf = Company.objects.create(naam='Opdrachtgever BV')
        self.charter = Charter.objects.create(naam='Charter A')
        self.andere_charter = Charter.objects.create(naam='Charter B')

        self.wagen = Vehicle.objects.create(
            kenteken='11-AAA-1', bedrijf=self.opdrachtgever_bedrijf, ritnummer='500')
        self.andere_wagen = Vehicle.objects.create(
            kenteken='22-BBB-2', bedrijf=self.opdrachtgever_bedrijf, ritnummer='501')
        self.charter.voertuigen.add(self.wagen)

        self.eigen_gebruiker = maak_gebruiker('jan@test.nl', UserRole.CHAUFFEUR)
        self.eigen_chauffeur = Driver.objects.create(
            naam='Jan', bedrijf=self.opdrachtgever_bedrijf,
            gekoppelde_gebruiker=self.eigen_gebruiker, charter=self.charter,
        )
        self.vreemde_gebruiker = maak_gebruiker('piet@test.nl', UserRole.CHAUFFEUR)
        self.vreemde_chauffeur = Driver.objects.create(
            naam='Piet', bedrijf=self.opdrachtgever_bedrijf,
            gekoppelde_gebruiker=self.vreemde_gebruiker, charter=self.andere_charter,
        )

        self.charter_gebruiker = maak_gebruiker(
            'charter@test.nl', UserRole.CHARTER, charter=self.charter)
        self.client = client_voor(self.charter_gebruiker)


class AfschermingTests(CharterBasis):
    def test_alle_interne_paden_zijn_dicht(self):
        for pad in (
            '/api/time-entries/', '/api/drivers/', '/api/fleet/', '/api/companies/',
            '/api/tracking/live/', '/api/tolling/', '/api/planning/', '/api/invoicing/',
            '/api/portaal/uren/', '/api/portaal/tol/', '/api/notifications/subscriptions/',
            '/api/drivers/charters/', '/api/auth/users/',
        ):
            with self.subTest(pad=pad):
                self.assertEqual(self.client.get(pad).status_code, 403)

    def test_eigen_profiel_en_portaal_zijn_open(self):
        self.assertEqual(self.client.get('/api/auth/profile/').status_code, 200)
        self.assertEqual(self.client.get(UREN_URL).status_code, 200)
        self.assertEqual(self.client.get(TOL_URL).status_code, 200)
        self.assertEqual(self.client.get(VOERTUIGEN_URL).status_code, 200)

    def test_charter_zonder_koppeling_ziet_niets(self):
        losse = maak_gebruiker('los@test.nl', UserRole.CHARTER)
        self.assertEqual(client_voor(losse).get(UREN_URL).status_code, 403)

    def test_andere_rollen_komen_niet_in_het_charterportaal(self):
        opdrachtgever = maak_gebruiker(
            'klant@test.nl', UserRole.OPDRACHTGEVER,
            opdrachtgever_bedrijf=self.opdrachtgever_bedrijf)
        medewerker = maak_gebruiker('kantoor@test.nl', UserRole.GEBRUIKER)
        for gebruiker in (opdrachtgever, medewerker, self.eigen_gebruiker):
            with self.subTest(rol=gebruiker.rol):
                self.assertEqual(client_voor(gebruiker).get(UREN_URL).status_code, 403)

    def test_nooit_interne_rechten(self):
        self.charter_gebruiker.module_permissions = ['view_track_trace', 'view_drivers']
        self.charter_gebruiker.save()
        self.assertFalse(self.charter_gebruiker.has_module_permission('view_track_trace'))


class UrenTests(CharterBasis):
    def test_alleen_uren_van_eigen_chauffeur(self):
        uren(self.eigen_gebruiker, date(2026, 10, 5), '11-AAA-1')
        uren(self.vreemde_gebruiker, date(2026, 10, 5), '22-BBB-2')

        data = self.client.get(UREN_URL).json()
        self.assertEqual([w['chauffeur'] for w in data['results']], ['Test jan'])

    def test_eerste_koppeling_geldt_met_terugwerkende_kracht(self):
        uren(self.eigen_gebruiker, date(2023, 1, 9), '11-AAA-1')
        data = self.client.get(UREN_URL).json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(data['results'][0]['jaar'], 2023)

    def test_na_indiensttreding_alleen_de_oude_weken(self):
        vandaag = timezone.localdate()
        oud = uren(self.eigen_gebruiker, vandaag - timedelta(days=14), '11-AAA-1')
        self.eigen_chauffeur.charter = None
        self.eigen_chauffeur.save()
        uren(self.eigen_gebruiker, vandaag, '11-AAA-1')

        data = self.client.get(UREN_URL).json()
        dagen = [d['id'] for w in data['results'] for d in w['dagen']]
        self.assertEqual(dagen, [str(oud.id)])

    def test_bij_wissel_naar_andere_charter(self):
        vandaag = timezone.localdate()
        self.eigen_chauffeur.charter = self.andere_charter
        self.eigen_chauffeur.save()

        oud = DriverCharterPeriode.objects.get(driver=self.eigen_chauffeur, charter=self.charter)
        nieuw = DriverCharterPeriode.objects.get(
            driver=self.eigen_chauffeur, charter=self.andere_charter)
        self.assertEqual(oud.tot, vandaag - timedelta(days=1))
        self.assertEqual(nieuw.vanaf, vandaag)
        self.assertIsNone(nieuw.tot)

        uren(self.eigen_gebruiker, vandaag, '11-AAA-1')
        self.assertEqual(self.client.get(UREN_URL).json()['count'], 0)


class TolTests(CharterBasis):
    def test_alleen_tol_op_dagen_dat_eigen_chauffeur_reed(self):
        gereden = date(2026, 10, 5)
        uren(self.eigen_gebruiker, gereden, '11-AAA-1')
        uren(self.vreemde_gebruiker, gereden + timedelta(days=1), '11-AAA-1')

        goed = tol('11-AAA-1', datetime(2026, 10, 5, 9, 0, tzinfo=NL))
        tol('11-AAA-1', datetime(2026, 10, 6, 9, 0, tzinfo=NL))  # andere chauffeur
        tol('22-BBB-2', datetime(2026, 10, 5, 9, 0, tzinfo=NL))  # andere wagen

        data = self.client.get(TOL_URL).json()
        passages = [p['id'] for w in data['results'] for p in w['passages']]
        self.assertEqual(passages, [str(goed.id)])
        self.assertEqual(data['results'][0]['kenteken'], '11-AAA-1')
        self.assertEqual(data['totaal_bedrag'], 10.0)

    def test_lokale_datum_telt_niet_utc(self):
        uren(self.eigen_gebruiker, date(2026, 10, 5), '11-AAA-1')
        # 00:30 lokale tijd op de 5e is nog de 4e in UTC.
        tol('11-AAA-1', datetime(2026, 10, 5, 0, 30, tzinfo=NL))
        self.assertEqual(self.client.get(TOL_URL).json()['count'], 1)

    def test_geen_uren_betekent_geen_tol(self):
        tol('11-AAA-1', datetime(2026, 10, 5, 9, 0, tzinfo=NL))
        self.assertEqual(self.client.get(TOL_URL).json()['count'], 0)

    def test_kentekenkeuze_volgt_de_uren_niet_de_kaart(self):
        uren(self.eigen_gebruiker, date(2026, 10, 5), '22-BBB-2')
        uren(self.vreemde_gebruiker, date(2026, 10, 5), '33-CCC-3')
        self.assertEqual(self.client.get(TOL_URL).json()['kentekens'], ['22-BBB-2'])


class KaartTests(CharterBasis):
    def test_alleen_gekoppelde_wagens(self):
        data = self.client.get(VOERTUIGEN_URL).json()
        self.assertEqual([v['kenteken'] for v in data], ['11-AAA-1'])

    def test_vreemde_wagen_dagoverzicht_geweigerd(self):
        antwoord = self.client.get(f'{VOERTUIGEN_URL}22-BBB-2/dag/')
        self.assertEqual(antwoord.status_code, 404)


class BeheerTests(CharterBasis):
    def setUp(self):
        super().setUp()
        self.admin = maak_gebruiker('admin@test.nl', UserRole.ADMIN)
        self.admin_client = client_voor(self.admin)
        licentie = patch(
            'apps.licensing.services.check_user_limit',
            return_value={'allowed': True, 'current': 0, 'max': 0, 'message': ''},
        )
        licentie.start()
        self.addCleanup(licentie.stop)

    def test_charterrol_vereist_een_charter(self):
        antwoord = self.admin_client.post('/api/auth/users/', {
            'email': 'nieuw@test.nl', 'username': 'nieuw', 'password': 'Zeer-Geheim-123!',
            'password_confirm': 'Zeer-Geheim-123!', 'voornaam': 'N', 'achternaam': 'W',
            'rol': 'charter',
        }, format='json')
        self.assertEqual(antwoord.status_code, 400)
        self.assertIn('charter', antwoord.json())

    def test_charter_krijgt_geen_interne_rechten(self):
        antwoord = self.admin_client.post('/api/auth/users/', {
            'email': 'nieuw@test.nl', 'username': 'nieuw', 'password': 'Zeer-Geheim-123!',
            'password_confirm': 'Zeer-Geheim-123!', 'voornaam': 'N', 'achternaam': 'W',
            'rol': 'charter', 'charter': str(self.charter.id),
            'module_permissions': ['view_track_trace'],
        }, format='json')
        self.assertEqual(antwoord.status_code, 201, antwoord.content)
        self.assertEqual(User.objects.get(email='nieuw@test.nl').module_permissions, [])

    def test_admin_kan_periode_bijstellen(self):
        periode = DriverCharterPeriode.objects.get(driver=self.eigen_chauffeur)
        antwoord = self.admin_client.patch(
            f'/api/drivers/charter-periodes/{periode.id}/', {'tot': '2026-01-31'}, format='json')
        self.assertEqual(antwoord.status_code, 200, antwoord.content)
        periode.refresh_from_db()
        self.assertEqual(periode.tot, date(2026, 1, 31))

    def test_charter_met_chauffeurs_niet_te_verwijderen(self):
        antwoord = self.admin_client.delete(f'/api/drivers/charters/{self.charter.id}/')
        self.assertEqual(antwoord.status_code, 400)
        self.assertTrue(Charter.objects.filter(pk=self.charter.pk).exists())

    def test_alleen_admin_koppelt_chauffeur_aan_charter(self):
        gebruiker = maak_gebruiker('kantoor@test.nl', UserRole.GEBRUIKER, module_permissions=['view_drivers'])
        url = f'/api/drivers/{self.vreemde_chauffeur.id}/'
        antwoord = client_voor(gebruiker).patch(url, {'charter': str(self.charter.id)}, format='json')
        self.assertEqual(antwoord.status_code, 400)
        self.vreemde_chauffeur.refresh_from_db()
        self.assertEqual(self.vreemde_chauffeur.charter, self.andere_charter)
        # Andere velden wijzigen mag nog gewoon, ook als de charter ongewijzigd meekomt.
        antwoord = client_voor(gebruiker).patch(
            url, {'telefoon': '0612345678', 'charter': str(self.andere_charter.id)}, format='json')
        self.assertEqual(antwoord.status_code, 200, antwoord.content)

        antwoord = self.admin_client.patch(url, {'charter': str(self.charter.id)}, format='json')
        self.assertEqual(antwoord.status_code, 200, antwoord.content)

    def test_chauffeurslijst_werkt_nog(self):
        """De eigen router voor charters mag de chauffeursroutes niet breken."""
        antwoord = self.admin_client.get(f'/api/drivers/{self.eigen_chauffeur.id}/')
        self.assertEqual(antwoord.status_code, 200)
        self.assertEqual(antwoord.json()['charter_naam'], 'Charter A')

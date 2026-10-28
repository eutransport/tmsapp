"""
Toegangsrechten voor track & trace en tachograaf.

Achtergrond: de tracking-views stonden op `IsAuthenticated`. De afscherming
zat puur in het menu en de frontend-route, waardoor iedere ingelogde
gebruiker — ook een externe opdrachtgever — via de API de live posities,
kentekens en chauffeursnamen van de hele vloot kon opvragen.

Deze tests leggen vast wie er wel en niet langs mag.
"""
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import AVAILABLE_MODULE_PERMISSIONS
from apps.companies.models import Company

LIVE_URL = '/api/tracking/live/'
HISTORY_URL = '/api/tracking/history/'
TACHO_URL = '/api/tracking/tachograph/vehicles/'


def maak_gebruiker(email, rol, rechten=None, bedrijf=None):
    User = get_user_model()
    return User.objects.create_user(
        email=email,
        password='geheim123',
        username=email.split('@')[0],
        voornaam='Test',
        achternaam='Gebruiker',
        rol=rol,
        module_permissions=rechten or [],
        opdrachtgever_bedrijf=bedrijf,
    )


class RechtenBestaanTests(TestCase):
    """De rechten moeten toekenbaar zijn in het gebruikersbeheer."""

    def test_beide_rechten_staan_in_de_lijst(self):
        codes = {code for code, _ in AVAILABLE_MODULE_PERMISSIONS}
        self.assertIn('view_track_trace', codes)
        self.assertIn('view_tachograph', codes)


class TrackTraceToegangTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_opdrachtgever_mag_de_vloot_niet_volgen(self):
        """Het lek dat dit werk aanleiding gaf: een externe klant zag alles."""
        bedrijf = Company.objects.create(naam='Klant BV')
        gebruiker = maak_gebruiker('klant@example.com', 'opdrachtgever', bedrijf=bedrijf)
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(LIVE_URL).status_code, 403)
        self.assertEqual(self.client.get(HISTORY_URL).status_code, 403)

    def test_opdrachtgever_blijft_geweerd_ook_met_het_recht(self):
        """Een opdrachtgever mag er nooit bij, ook niet per ongeluk toegekend."""
        bedrijf = Company.objects.create(naam='Klant BV')
        gebruiker = maak_gebruiker(
            'klant2@example.com', 'opdrachtgever',
            rechten=['view_track_trace'], bedrijf=bedrijf,
        )
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(LIVE_URL).status_code, 403)

    def test_gebruiker_zonder_recht_wordt_geweigerd(self):
        gebruiker = maak_gebruiker('kantoor@example.com', 'gebruiker')
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(LIVE_URL).status_code, 403)

    def test_gebruiker_met_recht_mag_erbij(self):
        gebruiker = maak_gebruiker(
            'planner@example.com', 'gebruiker', rechten=['view_track_trace'],
        )
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(LIVE_URL).status_code, 200)
        self.assertEqual(self.client.get(HISTORY_URL).status_code, 200)

    def test_admin_mag_erbij_zonder_expliciet_recht(self):
        gebruiker = maak_gebruiker('baas@example.com', 'admin')
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(LIVE_URL).status_code, 200)

    def test_chauffeur_mag_bij_views_die_op_hemzelf_filteren(self):
        chauffeur = maak_gebruiker('chauffeur@example.com', 'chauffeur')
        self.client.force_authenticate(user=chauffeur)

        self.assertEqual(self.client.get(LIVE_URL).status_code, 200)
        self.assertEqual(self.client.get(HISTORY_URL).status_code, 200)

    def test_chauffeur_ziet_geen_sessies_van_collegas(self):
        """De view filtert; zonder die filtering zou toelaten gevaarlijk zijn."""
        collega = maak_gebruiker('collega@example.com', 'chauffeur')
        from apps.tracking.models import TrackingSession
        TrackingSession.objects.create(user=collega, is_active=True)

        chauffeur = maak_gebruiker('chauffeur2@example.com', 'chauffeur')
        self.client.force_authenticate(user=chauffeur)

        response = self.client.get(HISTORY_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])


class TachograafToegangTests(TestCase):
    """De tachograaf staat los: rijtijden zijn herleidbaar tot een chauffeur."""

    def setUp(self):
        self.client = APIClient()

    def test_track_trace_recht_geeft_geen_toegang_tot_de_tachograaf(self):
        gebruiker = maak_gebruiker(
            'volger@example.com', 'gebruiker', rechten=['view_track_trace'],
        )
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(TACHO_URL).status_code, 403)

    def test_chauffeur_mag_niet_bij_de_tachograaf(self):
        chauffeur = maak_gebruiker('chauffeur3@example.com', 'chauffeur')
        self.client.force_authenticate(user=chauffeur)

        self.assertEqual(self.client.get(TACHO_URL).status_code, 403)

    def test_opdrachtgever_mag_niet_bij_de_tachograaf(self):
        bedrijf = Company.objects.create(naam='Klant BV')
        gebruiker = maak_gebruiker('klant3@example.com', 'opdrachtgever', bedrijf=bedrijf)
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(TACHO_URL).status_code, 403)

    @patch('apps.tracking.tachograph_service.get_objects')
    def test_gebruiker_met_tachograafrecht_mag_erbij(self, mock_objects):
        mock_objects.return_value = []
        gebruiker = maak_gebruiker(
            'rijtijden@example.com', 'gebruiker', rechten=['view_tachograph'],
        )
        self.client.force_authenticate(user=gebruiker)

        self.assertEqual(self.client.get(TACHO_URL).status_code, 200)

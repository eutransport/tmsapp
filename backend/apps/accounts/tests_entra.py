"""
Tests voor het inloggen via Microsoft Entra External ID.

De tokens hieronder worden echt ondertekend met een eigen RSA-sleutel, zodat de
handtekeningcontrole daadwerkelijk meedoet. Alleen het ophalen van de metadata
en de publieke sleutel bij Microsoft wordt vervangen; dat is netwerkverkeer.
"""
import datetime
from unittest.mock import patch

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from apps.accounts import entra
from apps.accounts.models import User

TENANT = 'moveotest'
CLIENT_ID = '11111111-2222-3333-4444-555555555555'
ISSUER = f'https://{TENANT}.ciamlogin.com/{TENANT}.onmicrosoft.com/v2.0'

_sleutel = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PRIVATE_PEM = _sleutel.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption(),
)
PUBLIEKE_SLEUTEL = _sleutel.public_key()


def maak_token(**overschrijf):
    nu = datetime.datetime.now(datetime.timezone.utc)
    claims = {
        'iss': ISSUER,
        'aud': CLIENT_ID,
        'iat': nu,
        'exp': nu + datetime.timedelta(hours=1),
        'email': 'extern@gmail.com',
        'given_name': 'Extern',
        'family_name': 'Persoon',
    }
    claims.update(overschrijf)
    for leeg in [k for k, v in claims.items() if v is None]:
        del claims[leeg]
    return jwt.encode(claims, PRIVATE_PEM, algorithm='RS256')


@override_settings(
    ENTRA_ENABLED=True,
    ENTRA_TENANT_TYPE='external',
    ENTRA_TENANT_NAME=TENANT,
    ENTRA_CLIENT_ID=CLIENT_ID,
    ENTRA_ALLOWED_EMAIL_DOMAINS=[],
    ENTRA_AUTO_CREATE_USERS=False,
    ENTRA_DEFAULT_ROLE='opdrachtgever',
)
class EntraTokenValidatieTests(TestCase):
    def setUp(self):
        cache.clear()
        self.metadata = patch.object(
            entra, '_haal_metadata',
            return_value={'issuer': ISSUER, 'jwks_uri': f'{ISSUER}/keys'},
        )
        self.sleutel = patch.object(entra, '_signing_key', return_value=PUBLIEKE_SLEUTEL)
        self.metadata.start()
        self.sleutel.start()
        self.addCleanup(self.metadata.stop)
        self.addCleanup(self.sleutel.stop)

    def test_geldig_token_wordt_geaccepteerd(self):
        claims = entra.valideer_token(maak_token())
        self.assertEqual(claims['email'], 'extern@gmail.com')

    def test_verlopen_token_wordt_geweigerd(self):
        verleden = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)
        token = maak_token(exp=verleden, iat=verleden - datetime.timedelta(minutes=5))
        with self.assertRaises(entra.EntraTokenFout):
            entra.valideer_token(token)

    def test_token_voor_andere_applicatie_wordt_geweigerd(self):
        with self.assertRaises(entra.EntraTokenFout):
            entra.valideer_token(maak_token(aud='een-andere-app'))

    def test_token_van_andere_tenant_wordt_geweigerd(self):
        with self.assertRaises(entra.EntraTokenFout):
            entra.valideer_token(maak_token(iss='https://kwaadwillend.example/v2.0'))

    def test_token_met_verkeerde_handtekening_wordt_geweigerd(self):
        andere = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = andere.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        nu = datetime.datetime.now(datetime.timezone.utc)
        vervalst = jwt.encode(
            {'iss': ISSUER, 'aud': CLIENT_ID, 'iat': nu,
             'exp': nu + datetime.timedelta(hours=1), 'email': 'extern@gmail.com'},
            pem, algorithm='RS256',
        )
        with self.assertRaises(entra.EntraTokenFout):
            entra.valideer_token(vervalst)

    def test_token_zonder_handtekening_wordt_geweigerd(self):
        """Het klassieke alg=none-trucje mag nooit werken."""
        nu = datetime.datetime.now(datetime.timezone.utc)
        kaal = jwt.encode(
            {'iss': ISSUER, 'aud': CLIENT_ID, 'iat': nu,
             'exp': nu + datetime.timedelta(hours=1), 'email': 'extern@gmail.com'},
            key='', algorithm='none',
        )
        with self.assertRaises(entra.EntraTokenFout):
            entra.valideer_token(kaal)

    def test_leeg_token_wordt_geweigerd(self):
        with self.assertRaises(entra.EntraTokenFout):
            entra.valideer_token('')


@override_settings(
    ENTRA_ENABLED=True,
    ENTRA_TENANT_TYPE='external',
    ENTRA_TENANT_NAME=TENANT,
    ENTRA_CLIENT_ID=CLIENT_ID,
    ENTRA_ALLOWED_EMAIL_DOMAINS=[],
    ENTRA_AUTO_CREATE_USERS=False,
    ENTRA_DEFAULT_ROLE='opdrachtgever',
)
class EntraGebruikerKoppelingTests(TestCase):
    def setUp(self):
        cache.clear()
        self.bestaand = User.objects.create_user(
            email='extern@gmail.com', password='testpass123', username='extern',
            voornaam='Extern', achternaam='Persoon', rol='opdrachtgever',
        )

    def test_bestaande_gebruiker_wordt_gevonden(self):
        gebruiker = entra.zoek_of_maak_gebruiker({'email': 'extern@gmail.com'})
        self.assertEqual(gebruiker.id, self.bestaand.id)

    def test_hoofdletters_in_email_maken_niet_uit(self):
        gebruiker = entra.zoek_of_maak_gebruiker({'email': 'Extern@Gmail.COM'})
        self.assertEqual(gebruiker.id, self.bestaand.id)

    def test_onbekende_gebruiker_wordt_standaard_geweigerd(self):
        with self.assertRaises(entra.EntraTokenFout):
            entra.zoek_of_maak_gebruiker({'email': 'vreemde@gmail.com'})
        self.assertFalse(User.objects.filter(email='vreemde@gmail.com').exists())

    @override_settings(ENTRA_AUTO_CREATE_USERS=True)
    def test_automatisch_aanmaken_kan_aangezet_worden(self):
        gebruiker = entra.zoek_of_maak_gebruiker({
            'email': 'nieuw@gmail.com', 'given_name': 'Nieuw', 'family_name': 'Persoon',
        })
        self.assertEqual(gebruiker.rol, 'opdrachtgever')
        self.assertFalse(gebruiker.has_usable_password())

    def test_inactieve_gebruiker_mag_niet_naar_binnen(self):
        self.bestaand.is_active = False
        self.bestaand.save(update_fields=['is_active'])
        with self.assertRaises(entra.EntraTokenFout):
            entra.zoek_of_maak_gebruiker({'email': 'extern@gmail.com'})

    @override_settings(ENTRA_ALLOWED_EMAIL_DOMAINS=['moveo-bv.nl'])
    def test_domeinbeperking_wordt_afgedwongen(self):
        with self.assertRaises(entra.EntraTokenFout):
            entra.zoek_of_maak_gebruiker({'email': 'extern@gmail.com'})

    def test_token_zonder_emailadres_wordt_geweigerd(self):
        with self.assertRaises(entra.EntraTokenFout):
            entra.zoek_of_maak_gebruiker({'given_name': 'Niemand'})

    def test_preferred_username_wordt_als_terugval_gebruikt(self):
        gebruiker = entra.zoek_of_maak_gebruiker({'preferred_username': 'extern@gmail.com'})
        self.assertEqual(gebruiker.id, self.bestaand.id)


@override_settings(
    ENTRA_ENABLED=True,
    ENTRA_TENANT_TYPE='external',
    ENTRA_TENANT_NAME=TENANT,
    ENTRA_CLIENT_ID=CLIENT_ID,
    ENTRA_ALLOWED_EMAIL_DOMAINS=[],
    ENTRA_AUTO_CREATE_USERS=False,
)
class EntraEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        User.objects.create_user(
            email='extern@gmail.com', password='testpass123', username='extern',
            voornaam='Extern', achternaam='Persoon', rol='opdrachtgever',
        )
        self.metadata = patch.object(
            entra, '_haal_metadata',
            return_value={'issuer': ISSUER, 'jwks_uri': f'{ISSUER}/keys'},
        )
        self.sleutel = patch.object(entra, '_signing_key', return_value=PUBLIEKE_SLEUTEL)
        self.metadata.start()
        self.sleutel.start()
        self.addCleanup(self.metadata.stop)
        self.addCleanup(self.sleutel.stop)

    def test_login_levert_een_eigen_jwt_op(self):
        antwoord = self.client.post(
            '/api/auth/entra/login/', {'id_token': maak_token()}, format='json',
        )
        self.assertEqual(antwoord.status_code, 200, getattr(antwoord, 'data', antwoord.content))
        self.assertIn('access', antwoord.data)
        self.assertIn('refresh', antwoord.data)
        self.assertEqual(antwoord.data['user']['email'], 'extern@gmail.com')

    def test_het_eigen_token_werkt_op_een_beveiligd_endpoint(self):
        antwoord = self.client.post(
            '/api/auth/entra/login/', {'id_token': maak_token()}, format='json',
        )
        toegang = antwoord.data['access']
        profiel = self.client.get('/api/auth/profile/', HTTP_AUTHORIZATION=f'Bearer {toegang}')
        self.assertEqual(profiel.status_code, 200)
        self.assertEqual(profiel.data['email'], 'extern@gmail.com')

    def test_ongeldig_token_geeft_401(self):
        antwoord = self.client.post(
            '/api/auth/entra/login/', {'id_token': 'onzin'}, format='json',
        )
        self.assertEqual(antwoord.status_code, 401)

    def test_config_endpoint_is_openbaar_en_bevat_geen_geheimen(self):
        antwoord = self.client.get('/api/auth/entra/config/')
        self.assertEqual(antwoord.status_code, 200)
        self.assertTrue(antwoord.data['enabled'])
        self.assertEqual(antwoord.data['client_id'], CLIENT_ID)
        self.assertNotIn('secret', str(antwoord.data).lower())

    @override_settings(ENTRA_ENABLED=False)
    def test_uitgeschakeld_meldt_dat_netjes(self):
        antwoord = self.client.get('/api/auth/entra/config/')
        self.assertEqual(antwoord.status_code, 200)
        self.assertFalse(antwoord.data['enabled'])


class EntraAuthorityTests(TestCase):
    """
    Het inlogadres verschilt per soort tenant. Een fout hierin leidt tot
    sleutels ophalen bij de verkeerde partij, dus het ligt vast in een test.
    """

    @override_settings(
        ENTRA_TENANT_TYPE='workforce',
        ENTRA_TENANT_ID='9bd03e13-fa5f-4ea3-b449-99a7654eae05',
        ENTRA_TENANT_NAME='',
    )
    def test_werknemers_tenant_gebruikt_login_microsoftonline(self):
        self.assertEqual(
            entra.authority(),
            'https://login.microsoftonline.com/'
            '9bd03e13-fa5f-4ea3-b449-99a7654eae05/v2.0',
        )

    @override_settings(
        ENTRA_TENANT_TYPE='external',
        ENTRA_TENANT_NAME='moveotest',
        ENTRA_TENANT_ID='',
    )
    def test_external_tenant_gebruikt_ciamlogin(self):
        self.assertEqual(
            entra.authority(),
            'https://moveotest.ciamlogin.com/moveotest.onmicrosoft.com/v2.0',
        )

    @override_settings(
        ENTRA_TENANT_TYPE='workforce', ENTRA_TENANT_ID='', ENTRA_TENANT_NAME='naam',
    )
    def test_werknemers_tenant_zonder_id_is_een_configuratiefout(self):
        with self.assertRaises(entra.EntraConfiguratieFout):
            entra.authority()

    @override_settings(
        ENTRA_TENANT_TYPE='external', ENTRA_TENANT_NAME='', ENTRA_TENANT_ID='abc',
    )
    def test_external_tenant_zonder_naam_is_een_configuratiefout(self):
        with self.assertRaises(entra.EntraConfiguratieFout):
            entra.authority()

    def test_metadata_url_hangt_aan_de_authority(self):
        with self.settings(
            ENTRA_TENANT_TYPE='workforce', ENTRA_TENANT_ID='abc-123',
        ):
            self.assertEqual(
                entra.metadata_url(),
                'https://login.microsoftonline.com/abc-123/v2.0'
                '/.well-known/openid-configuration',
            )


class EntraUitgeschakeldTests(TestCase):

    @override_settings(ENTRA_ENABLED=False)
    def test_login_endpoint_meldt_dat_het_uitstaat(self):
        antwoord = APIClient().post(
            '/api/auth/entra/login/', {'id_token': 'wat-dan-ook'}, format='json',
        )
        self.assertEqual(antwoord.status_code, 503)

    @override_settings(ENTRA_ENABLED=False)
    def test_gewone_login_blijft_gewoon_werken(self):
        User.objects.create_user(
            email='intern@moveo-bv.nl', password='testpass123', username='intern',
            voornaam='Intern', achternaam='Persoon', rol='admin',
        )
        antwoord = APIClient().post(
            '/api/auth/login/',
            {'email': 'intern@moveo-bv.nl', 'password': 'testpass123'},
            format='json',
        )
        self.assertEqual(antwoord.status_code, 200, getattr(antwoord, 'data', antwoord.content))
        self.assertIn('access', antwoord.data)

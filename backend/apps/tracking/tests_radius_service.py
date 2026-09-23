from unittest.mock import patch

from django.test import TestCase

from apps.tracking import radius_service
from apps.tracking.radius_service import RadiusError


class RadiusPadValidatieTests(TestCase):
    """Padmanipulatie in endpoints mag niet mogelijk zijn."""

    def test_pad_moet_met_slash_beginnen(self):
        with self.assertRaises(RadiusError):
            radius_service._veilig_pad('telematics/')

    def test_pad_mag_geen_parent_traversal_bevatten(self):
        with self.assertRaises(RadiusError):
            radius_service._veilig_pad('/telematics/../accounts/')

    def test_pad_mag_geen_andere_host_worden(self):
        with self.assertRaises(RadiusError):
            radius_service._veilig_pad('//kwaadaardig.example.com/')

    def test_geldig_pad_wordt_geaccepteerd(self):
        self.assertEqual(radius_service._veilig_pad('/accounts/users/customers/'),
                         '/accounts/users/customers/')


class RadiusKlantIdValidatieTests(TestCase):
    """Klant-id's komen in de URL terecht en moeten strikt numeriek zijn."""

    def test_numeriek_id_is_geldig(self):
        self.assertEqual(radius_service._valideer_klant_id(' 21218375990001 '), '21218375990001')

    def test_niet_numeriek_id_wordt_geweigerd(self):
        for ongeldig in ['', None, 'abc', '123/../456', '1 OR 1=1', '12345678901234567890123456789012345']:
            with self.subTest(waarde=ongeldig):
                with self.assertRaises(RadiusError):
                    radius_service._valideer_klant_id(ongeldig)


class RadiusVoertuigenTests(TestCase):
    """Apparaten worden per kenteken samengevoegd tot één voertuig."""

    LIVE_RESPONS = {
        'device_count': 4,
        'KINESIS_LIVE_MAP_REFRESH_RATE': 30,
        'devices': [
            {
                'id': 1, 'service_id': 'a', 'vehicle_registration': '06-BZF-5',
                'driver_name': 'Driver of 06-BZF-5', 'lat': 51.97, 'lon': 5.96,
                'speed': 0, 'direction': 0, 'ignition': 'N', 'timestamp': '1790170003',
                'street': 'Ringoven', 'post_code': '6826 TP', 'town': 'Arnhem', 'country': 'Nederland',
            },
            {
                'id': 2, 'service_id': 'b', 'vehicle_registration': '06-BZF-5',
                'driver_name': 'Jan Jansen', 'lat': 51.98, 'lon': 5.97,
                'speed': 80, 'direction': 90, 'ignition': 'Y', 'timestamp': '1790186458',
                'street': 'IJsseloordweg', 'post_code': '6825 KP', 'town': 'Arnhem', 'country': 'Nederland',
            },
            {
                'id': 3, 'service_id': 'c', 'vehicle_registration': '09-BGL-1',
                'driver_name': '', 'lat': 51.92, 'lon': 6.11,
                'speed': 0, 'direction': 0, 'ignition': 'N', 'timestamp': '1790171769',
                'street': 'Hecto', 'post_code': '6902 KK', 'town': None, 'country': 'Nederland',
            },
        ],
        'device_groups': [
            {'id': 9, 'name': 'Groep', 'devices': [
                # Zelfde apparaat als hierboven: mag niet dubbel geteld worden.
                {
                    'id': 3, 'service_id': 'c', 'vehicle_registration': '09-BGL-1',
                    'driver_name': '', 'lat': 51.92, 'lon': 6.11,
                    'speed': 0, 'direction': 0, 'ignition': 'N', 'timestamp': '1790171769',
                },
            ]},
        ],
    }

    def _vehicles(self):
        with patch.object(radius_service, 'get_live_positions', return_value=self.LIVE_RESPONS):
            return radius_service.get_vehicles('21218375990001')

    def test_apparaten_worden_per_kenteken_gegroepeerd(self):
        data = self._vehicles()
        self.assertEqual(data['count'], 2)
        self.assertEqual([v['plate_number'] for v in data['vehicles']], ['06-BZF-5', '09-BGL-1'])

    def test_meest_recente_positie_wordt_getoond(self):
        data = self._vehicles()
        eerste = data['vehicles'][0]
        self.assertEqual(eerste['device_id'], 2)
        self.assertEqual(eerste['timestamp'], 1790186458)
        self.assertEqual(eerste['speed'], 80)
        self.assertTrue(eerste['ignition'])
        self.assertEqual(eerste['device_count'], 2)

    def test_verzonnen_chauffeursnaam_wordt_leeggelaten(self):
        data = self._vehicles()
        tweede_apparaat = data['vehicles'][0]['devices'][1]
        self.assertEqual(tweede_apparaat['driver_name'], '')
        self.assertEqual(data['vehicles'][0]['driver_name'], 'Jan Jansen')

    def test_apparaat_uit_groep_wordt_niet_dubbel_geteld(self):
        data = self._vehicles()
        self.assertEqual(data['vehicles'][1]['device_count'], 1)

    def test_adres_slaat_lege_delen_over(self):
        data = self._vehicles()
        self.assertEqual(data['vehicles'][1]['address'], 'Hecto, 6902 KK, Nederland')


class RadiusKlantenTests(TestCase):
    def test_alleen_telematics_klanten(self):
        respons = {
            '111': {'id': '111', 'name': 'Met telematics', 'number': '1',
                    'product': {'2': 'Telematics'}},
            '222': {'id': '222', 'name': 'Alleen brandstof', 'number': '2',
                    'product': {'1': 'Fuel'}},
        }
        with patch.object(radius_service, 'api_get', return_value=respons):
            klanten = radius_service.get_telematics_customers()
        self.assertEqual([k['id'] for k in klanten], ['111'])

    def test_onverwacht_antwoord_geeft_radiuserror(self):
        with patch.object(radius_service, 'api_get', return_value=['lijst']):
            with self.assertRaises(RadiusError):
                radius_service.get_customers()

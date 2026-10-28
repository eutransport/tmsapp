from unittest.mock import patch

from django.core.cache import cache
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

    def setUp(self):
        # De lijst met rijdende trackers wordt gecacht; zonder legen lekt die
        # tussen tests door.
        cache.clear()

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


class RadiusSpooktrackerTests(TestCase):
    """
    Radius levert elk kenteken twee keer aan: de tracker die in het voertuig
    zit en een tweede registratie die nooit rijdt maar wel een positie meldt.
    Die tweede meldt zich vaak later op de dag, waardoor "de nieuwste melding
    wint" de wagen op een plek zette waar hij niet stond.

    De getallen hieronder komen uit de echte vloot: 41-BRR-3 reed 959 km op
    tracker ``echt`` terwijl tracker ``spook`` nul meter maakte en toch een
    recentere positie in Ede meldde.
    """

    RIJDEND = 'a4f98d56-2e05-4496-b1c9-fcc9686c382d'
    SPOOK = '80f726fb-dd07-4711-9dee-544fd6a32af5'

    LIVE_RESPONS = {
        'device_count': 2,
        'KINESIS_LIVE_MAP_REFRESH_RATE': 30,
        'devices': [
            {
                'id': 1138552, 'service_id': RIJDEND, 'vehicle_registration': '41-BRR-3',
                'driver_name': '', 'lat': 51.923245, 'lon': 6.117555,
                'speed': 0, 'direction': 0, 'ignition': 'N', 'timestamp': '1793203740',
                'street': 'Hecto', 'post_code': '6902 KK', 'town': None, 'country': 'Nederland',
            },
            {
                # Meldt zich bijna drie uur later, maar rijdt nooit.
                'id': 1138568, 'service_id': SPOOK, 'vehicle_registration': '41-BRR-3',
                'driver_name': '', 'lat': 52.04961, 'lon': 5.6234735,
                'speed': 0, 'direction': 0, 'ignition': 'N', 'timestamp': '1793210280',
                'street': 'Rijnvallei', 'post_code': '6718 NV', 'town': 'Ede', 'country': 'Nederland',
            },
        ],
    }

    def setUp(self):
        cache.clear()

    def _rit(self, service_id, km, dagen_geleden=1):
        from apps.tracking.models import RadiusJourney
        from django.utils import timezone as dj_tz
        from datetime import timedelta
        moment = dj_tz.now() - timedelta(days=dagen_geleden)
        return RadiusJourney.objects.create(
            service_id=service_id, plate_number='41-BRR-3',
            date=moment.date(), start_time=moment, end_time=moment,
            distance_km=km, duration_seconds=600,
        )

    def _vehicles(self):
        with patch.object(radius_service, 'get_live_positions', return_value=self.LIVE_RESPONS):
            return radius_service.get_vehicles('21218375990001')

    def test_rijdende_tracker_wint_van_recentere_spooktracker(self):
        self._rit(self.RIJDEND, 959.1)

        voertuig = self._vehicles()['vehicles'][0]

        self.assertEqual(voertuig['service_id'], self.RIJDEND)
        self.assertEqual(voertuig['address'], 'Hecto, 6902 KK, Nederland')
        self.assertTrue(voertuig['is_rijdende_tracker'])

    def test_spooktracker_blijft_wel_zichtbaar_onder_devices(self):
        self._rit(self.RIJDEND, 959.1)

        voertuig = self._vehicles()['vehicles'][0]

        self.assertEqual(voertuig['device_count'], 2)
        self.assertIn(self.SPOOK, [d['service_id'] for d in voertuig['devices']])

    def test_zonder_archief_blijft_de_nieuwste_melding_leidend(self):
        """Een lege ritgeschiedenis mag de kaart niet stilleggen."""
        voertuig = self._vehicles()['vehicles'][0]

        self.assertEqual(voertuig['service_id'], self.SPOOK)
        self.assertFalse(voertuig['is_rijdende_tracker'])

    def test_als_beide_trackers_rijden_wint_de_nieuwste(self):
        self._rit(self.RIJDEND, 959.1)
        self._rit(self.SPOOK, 120.0)

        voertuig = self._vehicles()['vehicles'][0]

        self.assertEqual(voertuig['service_id'], self.SPOOK)

    def test_ritten_zonder_afstand_maken_nog_geen_rijdende_tracker(self):
        """Stilstaand draaien levert ritten van nul meter op; die tellen niet."""
        self._rit(self.SPOOK, 0.0)

        self.assertEqual(radius_service.rijdende_trackers(), set())

    def test_oude_ritten_tellen_niet_meer_mee(self):
        self._rit(self.RIJDEND, 959.1, dagen_geleden=400)

        self.assertNotIn(self.RIJDEND, radius_service.rijdende_trackers())

    def test_uitkomst_wordt_gecacht(self):
        self._rit(self.RIJDEND, 959.1)
        self.assertEqual(radius_service.rijdende_trackers(), {self.RIJDEND})

        self._rit(self.SPOOK, 500.0)

        # Nog steeds de gecachte uitkomst, want de set verandert zelden.
        self.assertEqual(radius_service.rijdende_trackers(), {self.RIJDEND})

    def test_databasefout_laat_de_kaart_werken(self):
        from apps.tracking.models import RadiusJourney
        with patch.object(RadiusJourney, 'objects') as mock_objects:
            mock_objects.filter.side_effect = RuntimeError('database plat')
            self.assertEqual(radius_service.rijdende_trackers(), set())


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

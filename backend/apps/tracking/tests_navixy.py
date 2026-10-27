"""Tests voor de Navixy-koppeling en het samenvoegen van positiebronnen."""
from unittest.mock import patch

from django.test import TestCase

from apps.tracking import navixy_service, positions
from apps.tracking.models import NavixyConnection, NavixyTracker
from apps.tracking.tachograph_service import FMTrackError


def _state(lat=52.0, lng=5.0, snelheid=0, beweging='parked', ontsteking=False):
    return {
        'gps': {
            'location': {'lat': lat, 'lng': lng},
            'speed': snelheid,
            'heading': 90,
            'updated': '2026-10-27 13:47:09',
        },
        'movement_status': beweging,
        'ignition': ontsteking,
        'last_update': '2026-10-27 13:47:09',
    }


class NavixyBasis(TestCase):
    def setUp(self):
        self.koppeling = NavixyConnection.objects.create(
            naam='Navy Track', api_key='sleutel-van-voldoende-lengte',
        )
        self.tracker = NavixyTracker.objects.create(
            koppeling=self.koppeling, tracker_id=3687634, kenteken='71-BTL-6',
        )


class NavixyPositieTests(NavixyBasis):
    def test_positie_komt_in_het_gedeelde_formaat_terug(self):
        antwoord = {'success': True, 'states': {'3687634': _state(snelheid=62, beweging='moving')}}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            resultaat = navixy_service.get_vehicle_locations()

        self.assertEqual(len(resultaat), 1)
        positie = resultaat[0]
        self.assertEqual(positie['plate_number'], '71-BTL-6')
        self.assertEqual(positie['latitude'], 52.0)
        self.assertEqual(positie['longitude'], 5.0)
        self.assertEqual(positie['speed'], 62)
        self.assertEqual(positie['vehicle_status'], 'driving')
        self.assertEqual(positie['bron'], 'navixy')
        # Eigen naamruimte, zodat het nummer niet botst met een FM-Track object.
        self.assertEqual(positie['object_id'], 'navixy:3687634')

    def test_stilstaande_wagen_met_contact_aan_heet_idle(self):
        antwoord = {'success': True, 'states': {
            '3687634': _state(snelheid=0, beweging='stopped', ontsteking=True),
        }}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            resultaat = navixy_service.get_vehicle_locations()
        self.assertEqual(resultaat[0]['vehicle_status'], 'idle')

    def test_tracker_zonder_coordinaten_wordt_overgeslagen(self):
        antwoord = {'success': True, 'states': {'3687634': {'gps': {}}}}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            self.assertEqual(navixy_service.get_vehicle_locations(), [])

    def test_inactieve_tracker_wordt_niet_opgevraagd(self):
        self.tracker.actief = False
        self.tracker.save(update_fields=['actief'])
        with patch.object(navixy_service, '_aanroep') as aanroep:
            self.assertEqual(navixy_service.get_vehicle_locations(), [])
        aanroep.assert_not_called()

    def test_inactieve_koppeling_wordt_niet_opgevraagd(self):
        self.koppeling.actief = False
        self.koppeling.save(update_fields=['actief'])
        with patch.object(navixy_service, '_aanroep') as aanroep:
            self.assertEqual(navixy_service.get_vehicle_locations(), [])
        aanroep.assert_not_called()


class NavixyFoutTests(NavixyBasis):
    def _antwoord(self, code):
        class Nep:
            status_code = 200

            def json(self):
                return {'success': False, 'status': {'code': code, 'description': 'x'}}

        return Nep()

    def test_ongeldige_sleutel_geeft_begrijpelijke_melding(self):
        with patch.object(navixy_service.requests, 'post', return_value=self._antwoord(4)):
            with self.assertRaises(navixy_service.NavixyError) as fout:
                navixy_service.get_trackers(self.koppeling)
        self.assertIn('ongeldig', str(fout.exception).lower())

    def test_onbekende_tracker_geeft_begrijpelijke_melding(self):
        with patch.object(navixy_service.requests, 'post', return_value=self._antwoord(201)):
            with self.assertRaises(navixy_service.NavixyError) as fout:
                navixy_service.get_trackers(self.koppeling)
        self.assertIn('kent dit tracker-nummer niet', str(fout.exception))

    def test_upstream_tekst_lekt_niet_naar_de_gebruiker(self):
        class Nep:
            status_code = 200

            def json(self):
                return {'success': False, 'status': {
                    'code': 999, 'description': 'interne database host db-07 faalde',
                }}

        with patch.object(navixy_service.requests, 'post', return_value=Nep()):
            with self.assertRaises(navixy_service.NavixyError) as fout:
                navixy_service.get_trackers(self.koppeling)
        self.assertNotIn('db-07', str(fout.exception))

    def test_sleutel_gaat_mee_als_header_en_niet_in_de_url(self):
        class Nep:
            status_code = 200

            def json(self):
                return {'success': True, 'list': []}

        with patch.object(navixy_service.requests, 'post', return_value=Nep()) as post:
            navixy_service.get_trackers(self.koppeling)

        url = post.call_args[0][0]
        headers = post.call_args.kwargs['headers']
        self.assertNotIn('sleutel-van-voldoende-lengte', url)
        self.assertEqual(headers['Authorization'], 'NVX sleutel-van-voldoende-lengte')

    def test_koppeling_zonder_sleutel_roept_navixy_niet_aan(self):
        self.koppeling.api_key = ''
        self.koppeling.save(update_fields=['api_key'])
        with patch.object(navixy_service.requests, 'post') as post:
            with self.assertRaises(navixy_service.NavixyError):
                navixy_service.get_trackers(self.koppeling)
        post.assert_not_called()


class SamenvoegenTests(NavixyBasis):
    """De twee volgsystemen moeten samen één lijst opleveren."""

    def _navixy(self):
        return [{'plate_number': '71-BTL-6', 'latitude': 52.0, 'longitude': 5.0,
                 'object_id': 'navixy:3687634', 'bron': 'navixy'}]

    def _fmtrack(self):
        return [{'plate_number': '06-BZF-5', 'latitude': 51.0, 'longitude': 4.0,
                 'object_id': 123}]

    def test_beide_bronnen_komen_samen(self):
        with patch('apps.tracking.tachograph_service.get_vehicle_locations',
                   return_value=self._fmtrack()), \
             patch('apps.tracking.navixy_service.get_vehicle_locations',
                   return_value=self._navixy()):
            resultaat = positions.get_vehicle_locations()

        kentekens = sorted(p['plate_number'] for p in resultaat)
        self.assertEqual(kentekens, ['06-BZF-5', '71-BTL-6'])

    def test_storing_bij_fmtrack_laat_navixy_doorgaan(self):
        with patch('apps.tracking.tachograph_service.get_vehicle_locations',
                   side_effect=FMTrackError('geen sleutel')), \
             patch('apps.tracking.navixy_service.get_vehicle_locations',
                   return_value=self._navixy()):
            resultaat = positions.get_vehicle_locations()

        self.assertEqual(len(resultaat), 1)
        self.assertEqual(resultaat[0]['plate_number'], '71-BTL-6')

    def test_storing_bij_navixy_laat_fmtrack_doorgaan(self):
        with patch('apps.tracking.tachograph_service.get_vehicle_locations',
                   return_value=self._fmtrack()), \
             patch('apps.tracking.navixy_service.get_vehicle_locations',
                   side_effect=navixy_service.NavixyError('stuk')):
            resultaat = positions.get_vehicle_locations()

        self.assertEqual(len(resultaat), 1)
        self.assertEqual(resultaat[0]['plate_number'], '06-BZF-5')

    def test_zonder_enige_bron_komt_de_oude_fout_nog_steeds_naar_boven(self):
        # Dit was het gedrag voordat er een tweede bron bijkwam; schermen die
        # op FMTrackError reageren moeten dat blijven doen.
        with patch('apps.tracking.tachograph_service.get_vehicle_locations',
                   side_effect=FMTrackError('geen sleutel')), \
             patch('apps.tracking.navixy_service.get_vehicle_locations',
                   return_value=[]):
            with self.assertRaises(FMTrackError):
                positions.get_vehicle_locations()

    def test_dezelfde_wagen_in_twee_systemen_komt_maar_een_keer_voor(self):
        dubbel = [{'plate_number': '71BTL6', 'latitude': 51.5, 'longitude': 4.5,
                   'object_id': 999}]
        with patch('apps.tracking.tachograph_service.get_vehicle_locations',
                   return_value=dubbel), \
             patch('apps.tracking.navixy_service.get_vehicle_locations',
                   return_value=self._navixy()):
            resultaat = positions.get_vehicle_locations()

        self.assertEqual(len(resultaat), 1)
        self.assertEqual(resultaat[0]['object_id'], 999)


class NavixyAdresTests(NavixyBasis):
    """Navixy levert geen straatnaam; die zoeken we er zuinig bij."""

    def _antwoord(self, snelheid=0, beweging='parked'):
        return {'success': True, 'states': {
            '3687634': _state(snelheid=snelheid, beweging=beweging),
        }}

    def test_stilstaande_wagen_krijgt_een_adres(self):
        with patch.object(navixy_service, '_aanroep', return_value=self._antwoord()), \
             patch('apps.loadlist.services.geocoding.reverse_geocode',
                   return_value='Rietvelden, Breda') as opzoeken:
            resultaat = navixy_service.get_vehicle_locations()

        self.assertEqual(resultaat[0]['address'], 'Rietvelden, Breda')
        opzoeken.assert_called_once()

    def test_rijdende_wagen_belast_de_adresdienst_niet(self):
        antwoord = self._antwoord(snelheid=80, beweging='moving')
        with patch.object(navixy_service, '_aanroep', return_value=antwoord), \
             patch('apps.loadlist.services.geocoding.reverse_geocode') as opzoeken:
            resultaat = navixy_service.get_vehicle_locations()

        opzoeken.assert_not_called()
        self.assertEqual(resultaat[0]['address'], '')

    def test_storing_bij_de_adresdienst_houdt_de_positie_niet_tegen(self):
        with patch.object(navixy_service, '_aanroep', return_value=self._antwoord()), \
             patch('apps.loadlist.services.geocoding.reverse_geocode',
                   side_effect=RuntimeError('nominatim plat')):
            resultaat = navixy_service.get_vehicle_locations()

        self.assertEqual(len(resultaat), 1)
        self.assertEqual(resultaat[0]['address'], '')
        self.assertEqual(resultaat[0]['latitude'], 52.0)


class EtaGebruiktNavixyTests(NavixyBasis):
    """De aankomstmelding moet ook werken voor een wagen die via Navixy binnenkomt."""

    def test_kenteken_uit_navixy_komt_in_de_eta_posities(self):
        from apps.opdrachten import eta

        with patch('apps.tracking.tachograph_service.get_vehicle_locations',
                   side_effect=FMTrackError('geen sleutel')), \
             patch('apps.tracking.navixy_service.get_vehicle_locations',
                   return_value=[{'plate_number': '71-BTL-6', 'latitude': 52.0,
                                  'longitude': 5.0, 'object_id': 'navixy:3687634'}]):
            gevonden = eta._posities_per_kenteken()

        # De ETA werkt op kenteken zonder streepjes.
        self.assertIn('71BTL6', gevonden)
        self.assertEqual(gevonden['71BTL6']['latitude'], 52.0)

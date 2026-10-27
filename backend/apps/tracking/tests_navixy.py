"""Tests voor de Navixy-koppeling en het samenvoegen van positiebronnen."""
from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.tracking import navixy_detail, navixy_service, positions
from apps.tracking.models import (
    NavixyConnection, NavixyJourney, NavixyTracker,
)
from apps.tracking.navixy_archive_service import sync_navixy_journeys
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


def _track(track_id=11, start='2026-10-27 08:00:00', eind='2026-10-27 09:30:00',
           lengte=82.5, soort='regular'):
    return {
        'id': track_id,
        'type': soort,
        'start_date': start,
        'end_date': eind,
        'start_address': 'Rietvelden, Breda',
        'end_address': 'Hudsonweg, Venlo',
        'length': lengte,
        'max_speed': 89,
        'avg_speed': 55,
        'points': 120,
    }


class NavixyRitTests(NavixyBasis):
    """Het ophalen en omzetten van ritten uit /track/list."""

    def test_rit_wordt_omgezet_met_duur_en_afstand(self):
        antwoord = {'success': True, 'list': [_track()]}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord) as aanroep:
            ritten = navixy_service.get_journeys(
                self.tracker,
                timezone.now() - timedelta(days=1),
                timezone.now(),
            )

        self.assertEqual(len(ritten), 1)
        rit = ritten[0]
        self.assertEqual(rit['track_id'], 11)
        self.assertEqual(rit['distance_km'], 82.5)
        # Navixy geeft geen duur per rit; die rekenen we zelf uit.
        self.assertEqual(rit['duration_seconds'], 90 * 60)
        self.assertEqual(rit['plate_number'], '71-BTL-6')
        self.assertEqual(rit['start_address'], 'Rietvelden, Breda')

        # Losse ritten, anders levert Navixy een blok zonder eigen id.
        payload = aanroep.call_args[0][2]
        self.assertTrue(payload['split'])
        self.assertEqual(payload['tracker_id'], 3687634)

    def test_tijden_worden_als_nederlandse_tijd_gelezen(self):
        antwoord = {'success': True, 'list': [_track(start='2026-10-27 08:00:00',
                                                     eind='2026-10-27 08:30:00')]}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            ritten = navixy_service.get_journeys(
                self.tracker, timezone.now() - timedelta(days=1), timezone.now())

        # 08:00 Nederlandse wintertijd is 07:00 UTC.
        self.assertEqual(ritten[0]['start_time'].astimezone(dt_timezone.utc).hour, 7)

    def test_blokken_zonder_eigen_id_worden_overgeslagen(self):
        antwoord = {'success': True, 'list': [
            _track(track_id=None, soort='merged'),
            _track(track_id=5, soort='single_report'),
            _track(track_id=7),
        ]}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            ritten = navixy_service.get_journeys(
                self.tracker, timezone.now() - timedelta(days=1), timezone.now())

        self.assertEqual([r['track_id'] for r in ritten], [7])

    def test_rit_die_voor_de_start_eindigt_wordt_geweigerd(self):
        antwoord = {'success': True, 'list': [
            _track(start='2026-10-27 09:00:00', eind='2026-10-27 08:00:00'),
        ]}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            ritten = navixy_service.get_journeys(
                self.tracker, timezone.now() - timedelta(days=1), timezone.now())
        self.assertEqual(ritten, [])

    def test_lange_periode_wordt_opgeknipt(self):
        antwoord = {'success': True, 'list': []}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord) as aanroep:
            navixy_service.get_journeys(
                self.tracker,
                timezone.now() - timedelta(days=40),
                timezone.now(),
            )
        # Veertien dagen per blok, dus veertig dagen past niet in een aanvraag.
        self.assertGreater(aanroep.call_count, 1)

    def test_te_lange_periode_geeft_begrijpelijke_melding(self):
        antwoord = {'success': False, 'status': {'code': 211, 'description': 'time span too big'}}
        with patch.object(navixy_service, '_aanroep', wraps=navixy_service._aanroep):
            with patch('apps.tracking.navixy_service.requests.post') as post:
                post.return_value.json.return_value = antwoord
                post.return_value.status_code = 200
                with self.assertRaises(navixy_service.NavixyError) as fout:
                    navixy_service.get_journeys(
                        self.tracker, timezone.now() - timedelta(days=1), timezone.now())
        self.assertIn('periode', str(fout.exception).lower())
        self.assertNotIn('time span', str(fout.exception))


class NavixyArchiefTests(NavixyBasis):
    """Het wegschrijven van ritten naar het eigen archief."""

    def test_ritten_worden_opgeslagen(self):
        antwoord = {'success': True, 'list': [_track(track_id=1), _track(track_id=2, lengte=10.0)]}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            overzicht = sync_navixy_journeys(dagen=2)

        self.assertEqual(overzicht['nieuw'], 2)
        self.assertEqual(NavixyJourney.objects.count(), 2)

    def test_opnieuw_ophalen_maakt_geen_dubbele_ritten(self):
        antwoord = {'success': True, 'list': [_track(track_id=1)]}
        with patch.object(navixy_service, '_aanroep', return_value=antwoord):
            sync_navixy_journeys(dagen=2)
            tweede = sync_navixy_journeys(dagen=2)

        self.assertEqual(tweede['nieuw'], 0)
        self.assertEqual(NavixyJourney.objects.count(), 1)

    def test_herberekende_rit_wordt_bijgewerkt(self):
        with patch.object(navixy_service, '_aanroep',
                          return_value={'success': True, 'list': [_track(track_id=1, lengte=50.0)]}):
            sync_navixy_journeys(dagen=2)
        with patch.object(navixy_service, '_aanroep',
                          return_value={'success': True, 'list': [_track(track_id=1, lengte=57.5)]}):
            tweede = sync_navixy_journeys(dagen=2)

        self.assertEqual(tweede['bijgewerkt'], 1)
        self.assertEqual(NavixyJourney.objects.count(), 1)
        self.assertEqual(NavixyJourney.objects.get().distance_km, 57.5)

    def test_storing_bij_een_tracker_stopt_de_rest_niet(self):
        tweede_tracker = NavixyTracker.objects.create(
            koppeling=self.koppeling, tracker_id=99, kenteken='41-BRR-3',
        )
        def wisselend(koppeling, endpoint, payload=None):
            if payload and payload.get('tracker_id') == 3687634:
                raise navixy_service.NavixyError('tracker geblokkeerd')
            return {'success': True, 'list': [_track(track_id=3)]}

        with patch.object(navixy_service, '_aanroep', side_effect=wisselend):
            overzicht = sync_navixy_journeys(dagen=2)

        self.assertEqual(overzicht['nieuw'], 1)
        self.assertEqual(len(overzicht['fouten']), 1)
        self.assertEqual(NavixyJourney.objects.get().tracker, tweede_tracker)

    def test_inactieve_tracker_wordt_niet_opgehaald(self):
        self.tracker.actief = False
        self.tracker.save()
        with patch.object(navixy_service, '_aanroep') as aanroep:
            overzicht = sync_navixy_journeys(dagen=2)
        aanroep.assert_not_called()
        self.assertEqual(overzicht['trackers'], 0)


class NavixyDagdetailTests(NavixyBasis):
    """Het dagoverzicht dat het voertuigpaneel toont."""

    def setUp(self):
        super().setUp()
        start = datetime(2026, 10, 27, 8, 0, tzinfo=navixy_detail.NL_TZ)
        NavixyJourney.objects.create(
            tracker=self.tracker, track_id=1, plate_number='71-BTL-6',
            date=start.date(), start_time=start, end_time=start + timedelta(hours=2),
            distance_km=120.0, duration_seconds=7200, max_speed=89,
            start_address='Breda', end_address='Venlo',
        )

    def test_dagdetail_telt_ritten_afstand_en_duur_op(self):
        with patch.object(navixy_service, 'get_track_points', return_value=[]):
            detail = navixy_detail.dagdetail(self.tracker, date(2026, 10, 27))

        self.assertEqual(detail['trip_count'], 1)
        self.assertEqual(detail['total_distance_km'], 120.0)
        self.assertEqual(detail['total_duration_seconds'], 7200)
        self.assertEqual(detail['bron'], 'navixy')
        self.assertEqual(detail['vehicle']['plate_number'], '71-BTL-6')
        # Negen uur rijtijd per dag, waarvan twee gebruikt.
        self.assertEqual(detail['remaining_drive_seconds'], 7 * 3600)

    def test_rit_van_een_andere_dag_telt_niet_mee(self):
        with patch.object(navixy_service, 'get_track_points', return_value=[]):
            detail = navixy_detail.dagdetail(self.tracker, date(2026, 10, 26))
        self.assertEqual(detail['trip_count'], 0)
        self.assertEqual(detail['total_distance_km'], 0)

    def test_zonder_route_blijft_het_overzicht_bruikbaar(self):
        with patch.object(navixy_service, 'get_track_points',
                          side_effect=navixy_service.NavixyError('geen route')):
            detail = navixy_detail.dagdetail(self.tracker, date(2026, 10, 27))
        self.assertEqual(detail['route_coordinates'], [])
        self.assertEqual(detail['trip_count'], 1)

    def test_object_id_wordt_herkend(self):
        self.assertTrue(navixy_detail.is_navixy_object('navixy:3687634'))
        self.assertFalse(navixy_detail.is_navixy_object('12345'))
        self.assertEqual(navixy_detail.tracker_van_object('navixy:3687634'), self.tracker)
        self.assertIsNone(navixy_detail.tracker_van_object('navixy:999'))
        self.assertIsNone(navixy_detail.tracker_van_object('12345'))


class NavixyTijdzoneTests(NavixyBasis):
    """De accountklok van Navixy moet op onze tijd staan."""

    def test_afwijkende_accountklok_wordt_gemeld(self):
        verschoven = (datetime.now(navixy_service.NL_TZ) + timedelta(hours=5))
        with self.assertLogs('tracking', level='ERROR') as logboek:
            navixy_service.controleer_accountstijd({
                'user_time': verschoven.strftime(navixy_service.NAVIXY_TIJD_FORMAAT),
            })
        self.assertIn('tijdzone', '\n'.join(logboek.output).lower())

    def test_gelijke_klok_geeft_geen_melding(self):
        nu = datetime.now(navixy_service.NL_TZ)
        with patch.object(navixy_service.logger, 'error') as melding:
            navixy_service.controleer_accountstijd({
                'user_time': nu.strftime(navixy_service.NAVIXY_TIJD_FORMAAT),
            })
        melding.assert_not_called()

class NavixyPortaalTests(NavixyBasis):
    """Wat de opdrachtgever in het portaal ziet."""

    def setUp(self):
        super().setUp()
        from apps.opdrachten import portaal_ritten
        self.portaal = portaal_ritten
        start = datetime(2026, 10, 27, 9, 0, tzinfo=navixy_detail.NL_TZ)
        NavixyJourney.objects.create(
            tracker=self.tracker, track_id=1, plate_number='71-BTL-6',
            date=start.date(), start_time=start, end_time=start + timedelta(hours=1),
            distance_km=64.0, duration_seconds=3600,
            start_address='Breda', end_address='Venlo',
        )

    def test_ritten_komen_uit_navixy_als_linqo_de_wagen_niet_kent(self):
        with patch.object(self.portaal, 'linqo_objecten', return_value={}):
            ritten = self.portaal.haal_ritten(
                ['71-BTL-6'], date(2026, 10, 27), date(2026, 10, 27))

        self.assertEqual(len(ritten), 1)
        self.assertEqual(ritten[0]['bron'], 'navixy')
        self.assertEqual(ritten[0]['afstand_km'], 64.0)

    def test_dagoverzicht_toont_de_actuele_positie_op_kenteken(self):
        positie = {
            'object_id': 'navixy:3687634', 'plate_number': '71-BTL-6',
            'latitude': 51.48, 'longitude': 4.73, 'address': 'Rietvelden, Breda',
            'vehicle_status': 'parked', 'timestamp': '2026-10-27 21:19:35',
        }
        with patch.object(self.portaal, 'linqo_objecten', return_value={}), \
             patch('apps.tracking.positions.get_vehicle_locations', return_value=[positie]):
            overzicht = self.portaal.dagoverzicht('71-BTL-6', date(2026, 10, 27))

        self.assertEqual(overzicht['bron'], 'navixy')
        self.assertEqual(overzicht['aantal_ritten'], 1)
        self.assertEqual(overzicht['km_gereden'], 64.0)
        # Zonder objectnummer moet de positie op kenteken gevonden worden.
        self.assertEqual(overzicht['positie_adres'], 'Rietvelden, Breda')
        self.assertEqual(overzicht['toestand'], 'parked')

    def test_wagen_zonder_navixy_valt_terug_op_radius(self):
        with patch.object(self.portaal, 'linqo_objecten', return_value={}), \
             patch.object(self.portaal, '_radius_ritten', return_value=[]) as radius:
            self.portaal.haal_ritten(['99-XXX-9'], date(2026, 10, 27), date(2026, 10, 27))
        radius.assert_called_once()
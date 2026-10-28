"""
Dagdetail van een Radius-voertuig.

Radius levert minder dan Linqo: geen brandstof, geen kilometerstand en geen
maximumsnelheid. Wat er wel is — ritten, adressen, afstand, duur — moet in
dezelfde vorm bij de frontend aankomen als bij de andere bronnen, zodat het
bestaande detailpaneel het zonder aanpassing kan tonen.
"""
from datetime import date, datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.test import TestCase

from apps.tracking import radius_detail
from apps.tracking.models import RadiusJourney

NL = ZoneInfo('Europe/Amsterdam')
SERVICE = 'a4f98d56-2e05-4496-b1c9-fcc9686c382d'


def maak_rit(start, eind, km, service_id=SERVICE, kenteken='41-BRR-3',
             van='Zinkskesweg 1', van_plaats='Helenaveen',
             naar='Gazellepad', naar_plaats='Eerde'):
    return RadiusJourney.objects.create(
        service_id=service_id,
        plate_number=kenteken,
        date=start.astimezone(NL).date(),
        start_time=start,
        end_time=eind,
        start_address=van, start_city=van_plaats,
        end_address=naar, end_city=naar_plaats,
        start_latitude=51.4, start_longitude=5.9,
        end_latitude=51.5, end_longitude=5.6,
        distance_km=km,
        duration_seconds=int((eind - start).total_seconds()),
    )


class ObjectIdTests(TestCase):
    def test_radius_object_wordt_herkend(self):
        self.assertTrue(radius_detail.is_radius_object(f'radius:{SERVICE}'))
        self.assertFalse(radius_detail.is_radius_object('navixy:123'))
        self.assertFalse(radius_detail.is_radius_object('883805c8-9c6a-11f0'))
        self.assertFalse(radius_detail.is_radius_object(None))

    def test_service_id_wordt_eruit_gehaald(self):
        self.assertEqual(radius_detail.service_id_van_object(f'radius:{SERVICE}'), SERVICE)

    def test_leeg_service_id_geeft_none(self):
        self.assertIsNone(radius_detail.service_id_van_object('radius:'))
        self.assertIsNone(radius_detail.service_id_van_object('radius:   '))


class DagdetailUitArchiefTests(TestCase):
    """De ritten komen uit ons eigen archief zolang dat die dag kent."""

    def setUp(self):
        self.dag = date(2026, 10, 27)
        maak_rit(
            datetime(2026, 10, 27, 6, 56, tzinfo=NL),
            datetime(2026, 10, 27, 7, 54, tzinfo=NL),
            41.6,
        )
        # Stilstand: motor aan, geen meter gereden.
        maak_rit(
            datetime(2026, 10, 27, 10, 4, tzinfo=NL),
            datetime(2026, 10, 27, 10, 34, tzinfo=NL),
            0.0,
        )

    def _detail(self):
        return radius_detail.dagdetail(SERVICE, self.dag)

    def test_ritten_van_die_dag_worden_getoond(self):
        d = self._detail()
        self.assertEqual(d['trip_count'], 2)
        self.assertEqual(d['bron'], 'radius')
        self.assertEqual(d['bron_ritten'], 'archief')

    def test_stilstand_telt_niet_als_rijtijd(self):
        d = self._detail()
        self.assertEqual(d['total_duration_seconds'], 58 * 60)
        self.assertEqual(d['idle_duration_seconds'], 30 * 60)
        self.assertEqual(d['engine_duration_seconds'], 88 * 60)
        self.assertEqual([t['is_idle'] for t in d['trips']], [False, True])

    def test_eu_rijtijd_rekent_alleen_met_echte_ritten(self):
        d = self._detail()
        self.assertEqual(d['remaining_drive_seconds'], 9 * 3600 - 58 * 60)

    def test_afstand_en_kenteken(self):
        d = self._detail()
        self.assertEqual(d['total_distance_km'], 41.6)
        self.assertEqual(d['vehicle']['plate_number'], '41-BRR-3')

    def test_adres_combineert_straat_en_plaats(self):
        rit = self._detail()['trips'][0]
        self.assertEqual(rit['start_address'], 'Zinkskesweg 1, Helenaveen')
        self.assertEqual(rit['end_address'], 'Gazellepad, Eerde')

    def test_tijden_staan_in_nederlandse_tijd(self):
        rit = self._detail()['trips'][0]
        self.assertTrue(rit['start_time'].endswith('06:56:00'))
        self.assertTrue(rit['end_time'].endswith('07:54:00'))

    def test_velden_die_radius_niet_levert_blijven_leeg(self):
        """Liever leeg dan een verzonnen getal."""
        d = self._detail()
        self.assertEqual(d['fuel_chart_data'], [])
        self.assertEqual(d['route_coordinates'], [])
        self.assertEqual(d['odometer_km'], 0)
        self.assertEqual(d['max_speed'], 0)
        self.assertIsNone(d['avg_fuel_consumption'])
        for rit in d['trips']:
            self.assertEqual(rit['start_km'], 0)
            self.assertEqual(rit['end_km'], 0)
            self.assertEqual(rit['max_speed'], 0)
            self.assertFalse(rit['is_speeding'])

    def test_rit_van_een_andere_dag_telt_niet_mee(self):
        maak_rit(
            datetime(2026, 10, 26, 9, 0, tzinfo=NL),
            datetime(2026, 10, 26, 10, 0, tzinfo=NL),
            80.0,
        )
        self.assertEqual(self._detail()['trip_count'], 2)

    def test_rit_van_een_ander_voertuig_telt_niet_mee(self):
        maak_rit(
            datetime(2026, 10, 27, 9, 0, tzinfo=NL),
            datetime(2026, 10, 27, 10, 0, tzinfo=NL),
            80.0,
            service_id='80f726fb-dd07-4711-9dee-544fd6a32af5',
        )
        self.assertEqual(self._detail()['trip_count'], 2)

    def test_rit_kort_na_middernacht_hoort_bij_de_nederlandse_dag(self):
        maak_rit(
            datetime(2026, 10, 27, 0, 17, tzinfo=NL),
            datetime(2026, 10, 27, 0, 19, tzinfo=NL),
            1.2,
        )
        self.assertEqual(self._detail()['trip_count'], 3)


class DagdetailZonderArchiefTests(TestCase):
    """Voor vandaag staat er nog niets in het archief; dan vragen we Radius."""

    DAG = date(2026, 10, 28)

    API_RIT = {
        'service_id': SERVICE,
        'plate_number': '41-BRR-3',
        'start_time': datetime(2026, 10, 28, 8, 0, tzinfo=NL),
        'end_time': datetime(2026, 10, 28, 9, 0, tzinfo=NL),
        'start_address': 'Distributieweg, 2742 RD Waddinxveen, Nederland',
        'start_city': 'Zuid-Holland',
        'end_address': 'Bredeweg, 2761 KB Zevenhuizen, Nederland',
        'end_city': 'Zuid-Holland',
        'start_latitude': 52.0, 'start_longitude': 4.6,
        'end_latitude': 52.1, 'end_longitude': 4.7,
        'distance_km': 55.0,
        'duration_seconds': 3600,
    }

    def _detail_met_api(self, journeys, vandaag=DAG):
        from django.utils import timezone as dj_tz
        nu = datetime.combine(vandaag, datetime.min.time(), tzinfo=NL)
        with patch('apps.tracking.radius_service.get_journeys',
                   return_value={'journeys': journeys}) as mock_journeys, \
             patch('apps.tracking.radius_service.actieve_koppeling', return_value=None), \
             patch('apps.tracking.radius_archive_service.bepaal_klant_id',
                   return_value='21218375990001'), \
             patch.object(dj_tz, 'localtime', return_value=nu):
            detail = radius_detail.dagdetail(SERVICE, self.DAG)
        return detail, mock_journeys

    def test_ritten_worden_bij_radius_opgehaald(self):
        detail, mock_journeys = self._detail_met_api([self.API_RIT])

        self.assertEqual(detail['bron_ritten'], 'api')
        self.assertEqual(detail['trip_count'], 1)
        self.assertEqual(detail['total_distance_km'], 55.0)
        self.assertEqual(mock_journeys.call_count, 1)

    def test_ritten_van_andere_voertuigen_worden_eruit_gefilterd(self):
        ander = dict(self.API_RIT, service_id='iets-anders', distance_km=999.0)

        detail, _ = self._detail_met_api([self.API_RIT, ander])

        self.assertEqual(detail['trip_count'], 1)
        self.assertEqual(detail['total_distance_km'], 55.0)

    def test_archief_heeft_voorrang_boven_de_api(self):
        maak_rit(
            datetime(2026, 10, 28, 7, 0, tzinfo=NL),
            datetime(2026, 10, 28, 8, 0, tzinfo=NL),
            12.3,
        )

        detail, mock_journeys = self._detail_met_api([self.API_RIT])

        self.assertEqual(detail['bron_ritten'], 'archief')
        self.assertEqual(detail['total_distance_km'], 12.3)
        mock_journeys.assert_not_called()

    def test_oude_dag_buiten_het_bereik_van_radius_vraagt_niets_op(self):
        """Radius bewaart ongeveer dertig dagen; daarbuiten heeft het geen zin."""
        from django.utils import timezone as dj_tz
        laat = datetime.combine(self.DAG + timedelta(days=90),
                                datetime.min.time(), tzinfo=NL)
        with patch('apps.tracking.radius_service.get_journeys') as mock_journeys, \
             patch.object(dj_tz, 'localtime', return_value=laat):
            detail = radius_detail.dagdetail(SERVICE, self.DAG)

        mock_journeys.assert_not_called()
        self.assertEqual(detail['trip_count'], 0)

    def test_storing_bij_radius_geeft_een_lege_dag_en_geen_foutmelding(self):
        from apps.tracking.radius_service import RadiusError
        with patch('apps.tracking.radius_service.get_journeys',
                   side_effect=RadiusError('geen verbinding')), \
             patch('apps.tracking.radius_service.actieve_koppeling', return_value=None), \
             patch('apps.tracking.radius_archive_service.bepaal_klant_id',
                   return_value='21218375990001'):
            detail = radius_detail.dagdetail(SERVICE, self.DAG)

        self.assertEqual(detail['trip_count'], 0)
        self.assertEqual(detail['bron_ritten'], 'onbekend')
        self.assertEqual(detail['remaining_drive_seconds'], 9 * 3600)


class LivePositieTests(TestCase):
    def setUp(self):
        # Deze tests gaan over de live positie, niet over het ophalen van
        # ritten. Zonder deze patch zou de terugval naar de Radius-API een
        # netwerkpoging doen.
        patcher = patch.object(radius_detail, '_ritten_uit_api', return_value=[])
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_live_positie_wordt_overgenomen(self):
        detail = radius_detail.dagdetail(SERVICE, date(2026, 10, 28), live_positie={
            'latitude': 51.92, 'longitude': 6.11, 'speed': 80,
            'address': 'Hecto, 6902 KK, Nederland', 'heading': 90, 'timestamp': 1793210193,
        }, kenteken='41-BRR-3')

        pos = detail['current_position']
        self.assertEqual(pos['latitude'], 51.92)
        self.assertEqual(pos['vehicle_status'], 'driving')
        self.assertEqual(pos['address'], 'Hecto, 6902 KK, Nederland')

    def test_stilstaand_voertuig_krijgt_status_parked(self):
        detail = radius_detail.dagdetail(SERVICE, date(2026, 10, 28), live_positie={
            'latitude': 51.92, 'longitude': 6.11, 'speed': 0, 'address': 'Hecto',
        })

        self.assertEqual(detail['current_position']['vehicle_status'], 'parked')

    def test_zonder_live_positie_blijft_het_veld_leeg(self):
        detail = radius_detail.dagdetail(SERVICE, date(2026, 10, 28))

        self.assertIsNone(detail['current_position'])

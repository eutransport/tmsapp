"""
Twee dingen die in het dagoverzicht van een Linqo-voertuig misgingen:

1. De ritten werden op hun UTC-datum gefilterd terwijl de dag in Nederlandse
   tijd wordt opgevraagd. Ritten tussen middernacht en 02:00 vielen daardoor
   buiten beeld.
2. De tracker begint een rit bij het contact, niet bij beweging. Stilstaand
   draaien leverde daardoor "rijtijd" op zonder ook maar een meter afstand,
   wat de EU-rijtijd van 9 uur opvrat.
"""
import os
from datetime import date
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import django

os.environ.setdefault('SECRET_KEY', 'test-secret')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.local')
django.setup()

from apps.tracking.tachograph_service import (
    filter_ritten_op_dag,
    is_stilstand,
    rit_lokale_datum,
)
from apps.tracking.views import VehicleDetailView


def maak_rit(start_utc, duur_seconden, afstand_meter, eind_utc=None):
    """Bouwt een rit zoals FM-Track die teruggeeft."""
    return {
        'trip_start': {
            'datetime': start_utc,
            'mileage': 764190425,
            'latitude': 51.3967333,
            'longitude': 6.07789,
            'address': None,
            'fuel_level': 0,
        },
        'trip_end': {
            'datetime': eind_utc or start_utc,
            'mileage': 764190425,
            'latitude': 51.3967566,
            'longitude': 6.0778733,
            'address': None,
            'fuel_level': 0,
        },
        'trip_duration': duur_seconden,
        'mileage': afstand_meter,
    }


class LokaleDatumTests(TestCase):
    def test_zomertijd_schuift_twee_uur_op(self):
        rit = maak_rit('2026-07-01T22:30:00.000Z', 600, 5000)
        # 22:30 UTC is in de zomer 00:30 de volgende dag in Nederland.
        self.assertEqual(rit_lokale_datum(rit), date(2026, 7, 2))

    def test_wintertijd_schuift_een_uur_op(self):
        rit = maak_rit('2026-12-01T23:30:00.000Z', 600, 5000)
        self.assertEqual(rit_lokale_datum(rit), date(2026, 12, 2))

    def test_rit_zonder_starttijd_levert_geen_datum(self):
        rit = maak_rit('', 600, 5000)
        self.assertIsNone(rit_lokale_datum(rit))

    def test_onleesbare_starttijd_laat_de_boel_niet_klappen(self):
        rit = maak_rit('geen-datum', 600, 5000)
        self.assertIsNone(rit_lokale_datum(rit))


class FilterOpDagTests(TestCase):
    def test_rit_kort_na_middernacht_blijft_behouden(self):
        """
        Dit is de regressie: 00:17 Nederlandse tijd staat in UTC op de vorige
        dag. Op de kale UTC-datum filteren gooide zo'n rit weg.
        """
        nachtrit = maak_rit('2026-10-12T22:17:20.000Z', 99, 1200)
        dagrit = maak_rit('2026-10-13T08:00:00.000Z', 3600, 60000)

        overgebleven = filter_ritten_op_dag([nachtrit, dagrit], date(2026, 10, 13))

        self.assertEqual(len(overgebleven), 2)
        self.assertIn(nachtrit, overgebleven)

    def test_rit_van_de_vorige_dag_valt_af(self):
        vorige_dag = maak_rit('2026-10-12T10:00:00.000Z', 3600, 60000)

        overgebleven = filter_ritten_op_dag([vorige_dag], date(2026, 10, 13))

        self.assertEqual(overgebleven, [])


class StilstandHerkenningTests(TestCase):
    def test_nul_meter_is_stilstand(self):
        self.assertTrue(is_stilstand(maak_rit('2026-10-25T05:42:39.001Z', 2063, 0.0)))

    def test_ontbrekende_afstand_is_stilstand(self):
        rit = maak_rit('2026-10-25T05:42:39.001Z', 2063, 0.0)
        rit['mileage'] = None
        self.assertTrue(is_stilstand(rit))

    def test_rit_met_afstand_is_geen_stilstand(self):
        self.assertFalse(is_stilstand(maak_rit('2026-10-25T05:42:39.001Z', 2063, 95.0)))


class DagoverzichtTests(TestCase):
    """
    De echte zondag van 41-BRR-3: vier keer de motor aan op dezelfde plek,
    samen 1u14, zonder een meter te rijden.
    """

    def _detail(self, trips, datum='2026-10-25'):
        with patch('apps.tracking.tachograph_service.get_trips', return_value=trips), \
             patch('apps.tracking.tachograph_service.get_vehicle_locations', return_value=[]), \
             patch('apps.tracking.tachograph_service.get_objects', return_value=[]), \
             patch('apps.tracking.tachograph_service.get_raw_data', return_value=[]):
            request = SimpleNamespace(query_params={'date': datum})
            response = VehicleDetailView().get(request, 'obj-1')
        self.assertEqual(response.status_code, 200)
        return response.data

    def test_stilstand_telt_niet_als_rijtijd(self):
        data = self._detail([
            maak_rit('2026-10-25T05:42:39.001Z', 2063, 0.0, '2026-10-25T06:17:03.000Z'),
            maak_rit('2026-10-25T09:39:43.000Z', 8, 0.0, '2026-10-25T09:39:51.000Z'),
            maak_rit('2026-10-25T11:25:41.000Z', 934, 0.0, '2026-10-25T11:41:15.000Z'),
            maak_rit('2026-10-25T15:40:44.000Z', 1481, 0.0, '2026-10-25T16:05:25.000Z'),
        ])

        self.assertEqual(data['total_duration_seconds'], 0)
        self.assertEqual(data['idle_duration_seconds'], 2063 + 8 + 934 + 1481)
        self.assertEqual(data['engine_duration_seconds'], 4486)
        self.assertEqual(data['total_distance_km'], 0)

    def test_volledige_rijtijd_blijft_over_na_een_dag_stilstaan(self):
        data = self._detail([
            maak_rit('2026-10-25T05:42:39.001Z', 2063, 0.0, '2026-10-25T06:17:03.000Z'),
        ])

        self.assertEqual(data['remaining_drive_seconds'], 9 * 3600)

    def test_rijden_telt_wel_als_rijtijd(self):
        data = self._detail([
            maak_rit('2026-10-25T05:00:00.000Z', 3600, 55090.0, '2026-10-25T06:00:00.000Z'),
            maak_rit('2026-10-25T09:00:00.000Z', 1800, 0.0, '2026-10-25T09:30:00.000Z'),
        ])

        self.assertEqual(data['total_duration_seconds'], 3600)
        self.assertEqual(data['idle_duration_seconds'], 1800)
        self.assertEqual(data['remaining_drive_seconds'], 9 * 3600 - 3600)
        self.assertEqual(data['total_distance_km'], 55.1)

    def test_ritten_zijn_los_te_herkennen_als_stilstand(self):
        data = self._detail([
            maak_rit('2026-10-25T05:00:00.000Z', 3600, 55090.0, '2026-10-25T06:00:00.000Z'),
            maak_rit('2026-10-25T09:00:00.000Z', 1800, 0.0, '2026-10-25T09:30:00.000Z'),
        ])

        self.assertEqual([t['is_idle'] for t in data['trips']], [False, True])

    def test_korte_ritjes_vallen_niet_weg_uit_de_dagafstand(self):
        """
        Elke rit los afronden op 0,1 km liet ritjes van tientallen meters
        verdampen. Twintig ritjes van 95 meter is bijna twee kilometer.
        """
        data = self._detail([
            maak_rit(f'2026-10-25T0{i}:00:00.000Z', 300, 95.0) for i in range(1, 9)
        ])

        self.assertEqual(data['total_distance_km'], 0.8)

    def test_nachtrit_hoort_bij_de_nederlandse_dag(self):
        data = self._detail(
            [maak_rit('2026-10-12T22:17:20.000Z', 99, 1200.0, '2026-10-12T22:19:00.000Z')],
            datum='2026-10-13',
        )

        self.assertEqual(data['trip_count'], 1)
        self.assertEqual(data['total_duration_seconds'], 99)

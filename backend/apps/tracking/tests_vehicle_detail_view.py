import os
from datetime import datetime as dt
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from zoneinfo import ZoneInfo

import django

os.environ.setdefault('SECRET_KEY', 'test-secret')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'tms.settings.local')
django.setup()

from apps.tracking.views import VehicleDetailView


class VehicleDetailViewTests(TestCase):
    @patch('apps.tracking.tachograph_service.get_objects', return_value=[])
    @patch('apps.tracking.tachograph_service.get_vehicle_locations', return_value=[])
    @patch('apps.tracking.tachograph_service.get_trips', return_value=[])
    def test_vehicle_detail_uses_utc_boundaries_from_nl_day(
        self,
        mock_get_trips,
        _mock_get_vehicle_locations,
        _mock_get_objects,
    ):
        date_str = '2026-03-29'
        request = SimpleNamespace(query_params={'date': date_str})

        response = VehicleDetailView().get(request, 'obj-1')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_get_trips.call_count, 1)

        _, date_from, date_till = mock_get_trips.call_args[0]

        nl_tz = ZoneInfo('Europe/Amsterdam')
        utc = ZoneInfo('UTC')
        expected_from = dt(2026, 3, 29, 0, 0, 0, tzinfo=nl_tz).astimezone(utc)
        expected_till = dt(2026, 3, 29, 23, 59, 59, tzinfo=nl_tz).astimezone(utc)

        self.assertEqual(date_from, expected_from)
        self.assertEqual(date_till, expected_till)
        self.assertIsNotNone(date_from.tzinfo)
        self.assertIsNotNone(date_till.tzinfo)
        self.assertEqual(date_from.tzinfo, utc)
        self.assertEqual(date_till.tzinfo, utc)

    @patch('apps.tracking.tachograph_service.get_trips', side_effect=RuntimeError('boom'))
    def test_vehicle_detail_returns_json_on_unexpected_error(self, _mock_get_trips):
        request = SimpleNamespace(query_params={'date': '2026-04-01'})

        response = VehicleDetailView().get(request, 'obj-1')

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.data,
            {
                'error': 'Voertuiggegevens konden niet worden geladen.',
                'code': 'fm_track_internal_error',
            },
        )

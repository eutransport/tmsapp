from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.tracking.models import TachographArchiveEntry
from apps.tracking.tachograph_archive_service import upsert_tachograph_archive_for_date
from apps.tracking.tachograph_service import FMTrackError


class TachographArchiveTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        User = get_user_model()
        self.user = User.objects.create_user(
            email='admin@example.com',
            password='secret123',
            username='admin',
            voornaam='Admin',
            achternaam='User',
            rol='admin',
        )
        self.client.force_authenticate(user=self.user)

    @patch('apps.tracking.tachograph_archive_service.get_tachograph_overview')
    def test_upsert_delete_insert_is_idempotent_per_day(self, mock_get_tachograph_overview):
        mock_get_tachograph_overview.side_effect = [
            [{
                'object_id': 'veh-1',
                'vehicle_name': 'Truck 1',
                'vehicle_make': 'DAF',
                'vehicle_model': 'XF',
                'plate_number': '11-AA-11',
                'first_start': '2026-04-20T06:00:00Z',
                'last_end': '2026-04-20T15:00:00Z',
                'first_km': 1000,
                'last_km': 1200,
                'total_km': 200,
                'total_duration_seconds': 32400,
                'total_hours': 9,
                'total_hours_display': '09:00',
                'overtime_hours': 1,
                'overtime_display': '01:00',
                'has_overtime': True,
                'overtime_calculation': None,
                'drivers': [{'id': 'd1', 'name': 'Jan'}],
                'trips': [],
                'trip_count': 0,
            }],
            [{
                'object_id': 'veh-2',
                'vehicle_name': 'Truck 2',
                'vehicle_make': 'Volvo',
                'vehicle_model': 'FH',
                'plate_number': '22-BB-22',
                'first_start': '2026-04-20T07:00:00Z',
                'last_end': '2026-04-20T13:00:00Z',
                'first_km': 500,
                'last_km': 620,
                'total_km': 120,
                'total_duration_seconds': 21600,
                'total_hours': 6,
                'total_hours_display': '06:00',
                'overtime_hours': 0,
                'overtime_display': None,
                'has_overtime': False,
                'overtime_calculation': None,
                'drivers': [{'id': 'd2', 'name': 'Piet'}],
                'trips': [],
                'trip_count': 0,
            }],
        ]

        first = upsert_tachograph_archive_for_date('2026-04-20')
        second = upsert_tachograph_archive_for_date('2026-04-20')

        self.assertEqual(first['deleted_count'], 0)
        self.assertEqual(first['created_count'], 1)
        self.assertEqual(second['deleted_count'], 1)
        self.assertEqual(second['created_count'], 1)
        self.assertEqual(
            TachographArchiveEntry.objects.filter(date='2026-04-20').count(),
            1,
        )
        self.assertFalse(
            TachographArchiveEntry.objects.filter(date='2026-04-20', object_id='veh-1').exists()
        )
        self.assertTrue(
            TachographArchiveEntry.objects.filter(date='2026-04-20', object_id='veh-2').exists()
        )

    @patch('apps.tracking.tachograph_archive_service.upsert_tachograph_archive_for_date')
    def test_sync_endpoint_happy_path(self, mock_upsert):
        mock_upsert.return_value = {
            'date': '2026-04-20',
            'deleted_count': 2,
            'created_count': 5,
        }
        response = self.client.post(
            '/api/tracking/tachograph/archive/sync/',
            {'date': '2026-04-20'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['deleted_count'], 2)
        self.assertEqual(response.data['created_count'], 5)

    @patch('apps.tracking.tachograph_archive_service.upsert_tachograph_archive_for_date')
    def test_sync_endpoint_returns_502_on_upstream_failure(self, mock_upsert):
        mock_upsert.side_effect = FMTrackError('upstream unavailable')
        response = self.client.post(
            '/api/tracking/tachograph/archive/sync/',
            {'date': '2026-04-20'},
            format='json',
        )
        self.assertEqual(response.status_code, 502)
        self.assertIn('error', response.data)

    def test_list_endpoint_filters_by_date(self):
        TachographArchiveEntry.objects.create(
            date=date(2026, 4, 20),
            object_id='veh-1',
            vehicle_name='Truck 1',
            plate_number='11-AA-11',
        )
        TachographArchiveEntry.objects.create(
            date=date(2026, 4, 21),
            object_id='veh-2',
            vehicle_name='Truck 2',
            plate_number='22-BB-22',
        )

        response = self.client.get('/api/tracking/tachograph/archive/?date=2026-04-20')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['vehicles'][0]['object_id'], 'veh-1')

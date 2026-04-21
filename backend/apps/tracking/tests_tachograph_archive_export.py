from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.tracking.views import TachographArchiveListView


class TachographArchiveExportNegotiationTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        user_model = get_user_model()
        self.user = user_model(
            email='admin@example.com',
            username='admin',
            rol='admin',
            is_active=True,
        )
        self.rows = [
            {
                'date': '2026-04-21',
                'object_id': 'veh-1',
                'vehicle_name': 'Truck 1',
                'vehicle_make': 'DAF',
                'vehicle_model': 'XF',
                'plate_number': '11-AA-11',
                'drivers': [{'id': 'd1', 'name': 'Jan'}],
                'first_start': '2026-04-21T06:00:00Z',
                'last_end': '2026-04-21T15:00:00Z',
                'first_km': 1000,
                'last_km': 1200,
                'total_km': 200,
                'total_hours_display': '09:00',
                'overtime_display': '01:00',
                'trip_count': 2,
            }
        ]

    def _perform_request(self, fmt=None):
        params = {'date': '2026-04-21'}
        if fmt is not None:
            params['format'] = fmt
        request = self.factory.get('/api/tracking/tachograph/archive/', params)
        force_authenticate(request, user=self.user)
        view = TachographArchiveListView.as_view()
        with patch.object(TachographArchiveListView, '_build_rows', return_value=(self.rows, '2026-04-21')):
            response = view(request)
        if hasattr(response, 'render'):
            response.render()
        return response

    def test_archive_export_csv_returns_200_and_attachment(self):
        response = self._perform_request(fmt='csv')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Type'].startswith('text/csv'))
        self.assertIn('attachment; filename=', response['Content-Disposition'])

    def test_archive_export_xlsx_returns_200_and_attachment(self):
        response = self._perform_request(fmt='xlsx')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        self.assertIn('attachment; filename=', response['Content-Disposition'])

    def test_archive_export_pdf_returns_200(self):
        response = self._perform_request(fmt='pdf')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')

    def test_archive_without_format_returns_json_payload(self):
        response = self._perform_request()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Type'].startswith('application/json'))
        self.assertEqual(response.data['date'], '2026-04-21')
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['vehicles'][0]['object_id'], 'veh-1')

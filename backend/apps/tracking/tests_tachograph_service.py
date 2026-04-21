from unittest import TestCase
from unittest.mock import patch

from apps.tracking import tachograph_service


class TachographServiceTests(TestCase):
    @patch('apps.tracking.tachograph_service.get_objects')
    @patch('apps.tracking.tachograph_service.get_trips')
    def test_get_vehicle_locations_uses_timezone_aware_trip_window(self, mock_get_trips, mock_get_objects):
        mock_get_objects.return_value = [
            {
                'id': 'obj-1',
                'name': 'Truck 1',
                'vehicle_params': {'plate_number': '12-AB-34'},
            }
        ]

        captured_ranges = []

        def _capture_range(object_id, date_from, date_till):
            captured_ranges.append((date_from, date_till))
            return []

        mock_get_trips.side_effect = _capture_range

        positions = tachograph_service.get_vehicle_locations()

        self.assertEqual(positions, [])
        self.assertGreater(len(captured_ranges), 0)
        self.assertIsNotNone(captured_ranges[0][0].tzinfo)
        self.assertIsNotNone(captured_ranges[0][1].tzinfo)

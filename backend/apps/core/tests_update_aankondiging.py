from datetime import timedelta
from unittest import mock

from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.core.models import UpdateAankondiging


class UpdateAankondigingTests(TestCase):
    def status(self):
        return APIClient().get('/api/core/update-status/').json()

    def test_zonder_aankondiging_geen_banner(self):
        self.assertFalse(self.status()['gepland'])

    @mock.patch('apps.notifications.services.get_push_service')
    def test_aankondigen_toont_banner_en_stuurt_push(self, service):
        service.return_value.is_configured.return_value = True
        call_command('kondig_update_aan', '--seconden', '60', stdout=mock.Mock())

        data = self.status()
        self.assertTrue(data['gepland'])
        service.return_value.send_to_all.assert_called_once()

        call_command('kondig_update_aan', '--klaar', stdout=mock.Mock())
        self.assertFalse(self.status()['gepland'])

    def test_vergeten_klaarmelding_verloopt(self):
        UpdateAankondiging.objects.create(start_om=timezone.now() - timedelta(hours=1))
        self.assertFalse(self.status()['gepland'])

    @mock.patch('apps.notifications.services.get_push_service', side_effect=RuntimeError('stuk'))
    def test_mislukte_push_breekt_update_niet(self, _service):
        call_command('kondig_update_aan', stdout=mock.Mock(), stderr=mock.Mock())
        self.assertTrue(self.status()['gepland'])

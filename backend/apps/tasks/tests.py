"""Tests voor de taken-module, met nadruk op het melden van toewijzingen."""
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import User

from .models import Task, TaskStatus


def _maak_gebruiker(email, rol='gebruiker', module_permissions=None):
    return User.objects.create_user(
        email=email, password='testpass123',
        username=email.split('@')[0],
        voornaam='Test', achternaam=email.split('@')[0],
        rol=rol, module_permissions=module_permissions or [],
    )


class TaakToewijzingMeldingTests(TestCase):
    """
    Wie een taak toegewezen krijgt, hoort dat meteen te horen - net als bij
    een nieuwe opdracht. Voorheen kwam die melding pas de volgende ochtend.
    """

    def setUp(self):
        self.client = APIClient()
        self.beheerder = _maak_gebruiker('beheerder@test.com', rol='admin')
        self.medewerker = _maak_gebruiker('medewerker@test.com')
        self.collega = _maak_gebruiker('collega@test.com')

    def _push(self):
        """Vervang de pushdienst door een dubbel dat meetelt wat verstuurd is."""
        dienst = MagicMock()
        dienst.is_configured.return_value = True
        dienst.send_to_user.return_value = {'success_count': 1}
        return dienst

    def test_toewijzen_aan_ander_stuurt_melding(self):
        dienst = self._push()
        with patch('apps.notifications.services.PushNotificationService', return_value=dienst):
            self.client.force_authenticate(self.beheerder)
            antwoord = self.client.post('/api/tasks/tasks/', {
                'titel': 'Bandenwissel inplannen',
                'toegewezen_aan_id': str(self.medewerker.id),
            }, format='json')

        self.assertEqual(antwoord.status_code, 201, getattr(antwoord, 'data', antwoord.content))
        dienst.send_to_user.assert_called_once()
        verstuurd = dienst.send_to_user.call_args.kwargs
        self.assertEqual(verstuurd['user'], self.medewerker)
        self.assertEqual(verstuurd['title'], 'Nieuwe taak toegewezen')
        self.assertEqual(verstuurd['body'], 'Bandenwissel inplannen')

    def test_taak_voor_jezelf_stuurt_geen_melding(self):
        dienst = self._push()
        with patch('apps.notifications.services.PushNotificationService', return_value=dienst):
            self.client.force_authenticate(self.medewerker)
            antwoord = self.client.post('/api/tasks/tasks/', {
                'titel': 'Eigen notitie',
            }, format='json')

        self.assertEqual(antwoord.status_code, 201, getattr(antwoord, 'data', antwoord.content))
        dienst.send_to_user.assert_not_called()

    def test_hertoewijzen_meldt_de_nieuwe_uitvoerder(self):
        taak = Task.objects.create(
            titel='Factuur controleren',
            aangemaakt_door=self.beheerder,
            toegewezen_aan=self.medewerker,
        )
        dienst = self._push()
        with patch('apps.notifications.services.PushNotificationService', return_value=dienst):
            self.client.force_authenticate(self.beheerder)
            antwoord = self.client.post(
                f'/api/tasks/tasks/{taak.id}/reassign/',
                {'toegewezen_aan_id': str(self.collega.id)},
                format='json',
            )

        self.assertEqual(antwoord.status_code, 200, getattr(antwoord, 'data', antwoord.content))
        dienst.send_to_user.assert_called_once()
        self.assertEqual(dienst.send_to_user.call_args.kwargs['user'], self.collega)

    def test_melding_aan_inactieve_gebruiker_wordt_overgeslagen(self):
        self.medewerker.is_active = False
        self.medewerker.save(update_fields=['is_active'])

        taak = Task.objects.create(
            titel='Oude taak',
            aangemaakt_door=self.beheerder,
            toegewezen_aan=self.medewerker,
        )
        dienst = self._push()
        with patch('apps.notifications.services.PushNotificationService', return_value=dienst):
            from .views import _notify_assignee
            verstuurd = _notify_assignee(taak, self.beheerder)

        self.assertFalse(verstuurd)
        dienst.send_to_user.assert_not_called()

    def test_mislukte_push_laat_het_aanmaken_doorgaan(self):
        """Een storing in meldingen mag nooit het aanmaken van werk blokkeren."""
        dienst = MagicMock()
        dienst.is_configured.return_value = True
        dienst.send_to_user.side_effect = RuntimeError('pushdienst onbereikbaar')

        with patch('apps.notifications.services.PushNotificationService', return_value=dienst):
            self.client.force_authenticate(self.beheerder)
            antwoord = self.client.post('/api/tasks/tasks/', {
                'titel': 'Taak ondanks storing',
                'toegewezen_aan_id': str(self.medewerker.id),
            }, format='json')

        self.assertEqual(antwoord.status_code, 201, getattr(antwoord, 'data', antwoord.content))
        self.assertTrue(
            Task.objects.filter(titel='Taak ondanks storing', status=TaskStatus.NIEUW).exists()
        )

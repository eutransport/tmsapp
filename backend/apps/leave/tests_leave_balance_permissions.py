"""
Tests for leave balance permission-based filtering.

Verifies that:
- Admins see all employee balances.
- Users with the 'view_leave_balances' module permission see all balances.
- Users without the permission only see their own balance.
"""
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from backend.apps.accounts.models import User
from backend.apps.leave.models import LeaveBalance


def _make_user(email, rol='gebruiker', module_permissions=None):
    user = User.objects.create_user(
        email=email,
        password='testpass123',
        username=email.split('@')[0],
        voornaam='Test',
        achternaam='User',
        rol=rol,
        module_permissions=module_permissions or [],
    )
    return user


class LeaveBalancePermissionTests(TestCase):
    """Test that the /leave/balances/ endpoint respects module permissions."""

    def setUp(self):
        self.client = APIClient()

        # Two regular employees
        self.employee1 = _make_user('emp1@test.com')
        self.employee2 = _make_user('emp2@test.com')

        # Employee with the view_leave_balances module permission
        self.manager = _make_user(
            'manager@test.com',
            module_permissions=['view_leave_balances'],
        )

        # Admin user
        self.admin = _make_user('admin@test.com', rol='admin')

        # Create leave balances
        self.bal1 = LeaveBalance.objects.create(
            user=self.employee1, vacation_hours=100, overtime_hours=5
        )
        self.bal2 = LeaveBalance.objects.create(
            user=self.employee2, vacation_hours=200, overtime_hours=10
        )
        self.bal_manager = LeaveBalance.objects.create(
            user=self.manager, vacation_hours=150, overtime_hours=8
        )
        self.bal_admin = LeaveBalance.objects.create(
            user=self.admin, vacation_hours=180, overtime_hours=0
        )

        self.url = '/api/leave/balances/'

    # ------------------------------------------------------------------
    # Admin sees all balances
    # ------------------------------------------------------------------
    def test_admin_sees_all_balances(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        ids = {item['id'] for item in response.data}
        self.assertIn(str(self.bal1.id), ids)
        self.assertIn(str(self.bal2.id), ids)
        self.assertIn(str(self.bal_manager.id), ids)
        self.assertIn(str(self.bal_admin.id), ids)

    # ------------------------------------------------------------------
    # User WITH view_leave_balances sees all balances
    # ------------------------------------------------------------------
    def test_user_with_permission_sees_all_balances(self):
        self.client.force_authenticate(self.manager)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        ids = {item['id'] for item in response.data}
        self.assertIn(str(self.bal1.id), ids)
        self.assertIn(str(self.bal2.id), ids)
        self.assertIn(str(self.bal_manager.id), ids)

    # ------------------------------------------------------------------
    # User WITHOUT view_leave_balances only sees own balance
    # ------------------------------------------------------------------
    def test_user_without_permission_sees_only_own_balance(self):
        self.client.force_authenticate(self.employee1)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        ids = {item['id'] for item in response.data}
        self.assertIn(str(self.bal1.id), ids)
        self.assertNotIn(str(self.bal2.id), ids)
        self.assertNotIn(str(self.bal_manager.id), ids)
        self.assertEqual(len(response.data), 1)

    # ------------------------------------------------------------------
    # retrieve() — user WITHOUT permission cannot fetch another user's balance
    # The object is not in the restricted queryset, so Django returns 404
    # (the 403 branch in retrieve() is an additional safety net for edge cases)
    # ------------------------------------------------------------------
    def test_user_without_permission_cannot_retrieve_other_balance(self):
        self.client.force_authenticate(self.employee1)
        url = f'/api/leave/balances/{self.bal2.id}/'
        response = self.client.get(url)
        # get_object() raises 404 because bal2 is not in the filtered queryset
        self.assertEqual(response.status_code, 404)

    # ------------------------------------------------------------------
    # retrieve() — user WITH permission can fetch another user's balance
    # ------------------------------------------------------------------
    def test_user_with_permission_can_retrieve_any_balance(self):
        self.client.force_authenticate(self.manager)
        url = f'/api/leave/balances/{self.bal1.id}/'
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(str(response.data['id']), str(self.bal1.id))

    # ------------------------------------------------------------------
    # adjust() — admin can add hours per type to any balance
    # ------------------------------------------------------------------
    def test_admin_can_adjust_balance(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/leave/balances/{self.bal1.id}/adjust/'
        response = self.client.post(
            url,
            {'vacation_delta': '8', 'overtime_delta': '2', 'reason': 'correctie'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.bal1.refresh_from_db()
        self.assertEqual(self.bal1.vacation_hours, 108)
        self.assertEqual(self.bal1.overtime_hours, 7)

    # ------------------------------------------------------------------
    # adjust() — manager with view_leave_balances can also adjust
    # ------------------------------------------------------------------
    def test_manager_with_permission_can_adjust_balance(self):
        self.client.force_authenticate(self.manager)
        url = f'/api/leave/balances/{self.bal2.id}/adjust/'
        response = self.client.post(
            url,
            {'vacation_delta': '4'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.bal2.refresh_from_db()
        self.assertEqual(self.bal2.vacation_hours, 204)
        self.assertEqual(self.bal2.overtime_hours, 10)

    # ------------------------------------------------------------------
    # adjust() — regular employee may NOT adjust any balance (their own or others)
    # ------------------------------------------------------------------
    def test_user_without_permission_cannot_adjust_own_balance(self):
        self.client.force_authenticate(self.employee1)
        url = f'/api/leave/balances/{self.bal1.id}/adjust/'
        response = self.client.post(
            url,
            {'vacation_delta': '8'},
            format='json',
        )
        # Forbidden — the balance is in their queryset but adjust is permission-gated
        self.assertEqual(response.status_code, 403)
        self.bal1.refresh_from_db()
        self.assertEqual(self.bal1.vacation_hours, 100)

    def test_user_without_permission_cannot_adjust_other_balance(self):
        self.client.force_authenticate(self.employee1)
        url = f'/api/leave/balances/{self.bal2.id}/adjust/'
        response = self.client.post(
            url,
            {'vacation_delta': '8'},
            format='json',
        )
        # 404 (object not in queryset) or 403 — both are acceptable denials
        self.assertIn(response.status_code, (403, 404))
        self.bal2.refresh_from_db()
        self.assertEqual(self.bal2.vacation_hours, 200)

    # ------------------------------------------------------------------
    # adjust() — validation: empty payload is rejected
    # ------------------------------------------------------------------
    def test_adjust_requires_non_zero_delta(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/leave/balances/{self.bal1.id}/adjust/'
        response = self.client.post(url, {}, format='json')
        self.assertEqual(response.status_code, 400)

    # ------------------------------------------------------------------
    # adjust() — resulting balance may not go negative
    # ------------------------------------------------------------------
    def test_adjust_rejects_negative_resulting_balance(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/leave/balances/{self.bal1.id}/adjust/'
        response = self.client.post(
            url,
            {'vacation_delta': '-1000'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.bal1.refresh_from_db()
        self.assertEqual(self.bal1.vacation_hours, 100)

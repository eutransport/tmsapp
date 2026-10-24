"""Tests voor de geo-blocking regelevaluatie en IP-bepaling."""
from unittest.mock import patch

from django.test import RequestFactory, TestCase, override_settings

from apps.core.ip_utils import get_client_ip
from apps.geoblocking.models import (
    EnforcementMode,
    GeoBlockSettings,
    GeoRule,
    IPRule,
    RuleAction,
)
from apps.geoblocking.services import evaluate, invalidate_rules_cache


class ClientIPTests(TestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _request(self, remote_addr, xff=None):
        extra = {'REMOTE_ADDR': remote_addr}
        if xff is not None:
            extra['HTTP_X_FORWARDED_FOR'] = xff
        return self.factory.get('/api/test/', **extra)

    def test_directe_verbinding(self):
        self.assertEqual(get_client_ip(self._request('93.184.216.9')), '93.184.216.9')

    def test_achter_vertrouwde_proxy(self):
        request = self._request('172.18.0.5', '93.184.216.9')
        self.assertEqual(get_client_ip(request), '93.184.216.9')

    def test_vervalste_header_wordt_genegeerd(self):
        """Een client die rechtstreeks verbindt mag geen ander IP claimen."""
        request = self._request('93.184.216.9', '8.8.8.8')
        self.assertEqual(get_client_ip(request), '93.184.216.9')

    def test_langste_keten_pakt_laatste_niet_vertrouwde(self):
        # De client stuurde zelf '1.1.1.1' mee; onze proxy voegde het echte IP toe.
        request = self._request('172.18.0.5', '1.1.1.1, 93.184.216.9')
        self.assertEqual(get_client_ip(request), '93.184.216.9')


class RuleEvaluationTests(TestCase):
    def setUp(self):
        invalidate_rules_cache()
        self.config = GeoBlockSettings.load()
        self.config.enabled = True
        self.config.mode = EnforcementMode.ENFORCE
        self.config.default_action = RuleAction.BLOCK
        self.config.allow_superuser_bypass = True
        self.config.save()

    def tearDown(self):
        invalidate_rules_cache()

    @staticmethod
    def _met_land(code):
        return patch('apps.geoblocking.services.lookup_country', return_value=code)

    def test_nederland_toegestaan_rest_geblokkeerd(self):
        GeoRule.objects.create(country_code='NL', role='*', action=RuleAction.ALLOW)
        invalidate_rules_cache()

        with self._met_land('NL'):
            self.assertTrue(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])
        with self._met_land('RU'):
            self.assertFalse(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])

    def test_chauffeur_mag_vanuit_duitsland_maar_kantoor_niet(self):
        """Dit is het scenario per land en per rol."""
        GeoRule.objects.create(country_code='NL', role='*', action=RuleAction.ALLOW)
        GeoRule.objects.create(
            country_code='DE', role='chauffeur', action=RuleAction.ALLOW, priority=10
        )
        invalidate_rules_cache()

        with self._met_land('DE'):
            self.assertTrue(evaluate('93.184.216.9', 'chauffeur', self.config)['allowed'])
            self.assertFalse(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])

    def test_specifieke_regel_wint_van_algemene(self):
        GeoRule.objects.create(country_code='*', role='*', action=RuleAction.BLOCK, priority=50)
        GeoRule.objects.create(country_code='NL', role='*', action=RuleAction.ALLOW, priority=50)
        invalidate_rules_cache()

        with self._met_land('NL'):
            self.assertTrue(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])

    def test_ip_regel_gaat_voor_landregel(self):
        GeoRule.objects.create(country_code='RU', role='*', action=RuleAction.BLOCK)
        IPRule.objects.create(cidr='93.184.216.0/24', action=RuleAction.ALLOW, label='Partner')
        invalidate_rules_cache()

        with self._met_land('RU'):
            self.assertTrue(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])

    def test_monitormodus_blokkeert_niets(self):
        self.config.mode = EnforcementMode.MONITOR
        self.config.save()
        invalidate_rules_cache()

        with self._met_land('RU'):
            uitkomst = evaluate('93.184.216.9', 'gebruiker', self.config)
        self.assertTrue(uitkomst['allowed'])
        self.assertTrue(uitkomst['would_block'])

    def test_uitgeschakeld_laat_alles_door(self):
        self.config.enabled = False
        self.config.save()
        with self._met_land('RU'):
            self.assertTrue(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])

    def test_intern_netwerk_nooit_geblokkeerd(self):
        """Healthchecks en containerverkeer moeten blijven werken."""
        self.assertTrue(evaluate('172.18.0.5', 'anonymous', self.config)['allowed'])

    def test_onbekend_land_standaard_toegestaan(self):
        with self._met_land(''):
            self.assertTrue(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])

    def test_onbekend_land_blokkeren_indien_ingesteld(self):
        self.config.block_unknown_country = True
        self.config.save()
        with self._met_land(''):
            self.assertFalse(evaluate('93.184.216.9', 'gebruiker', self.config)['allowed'])

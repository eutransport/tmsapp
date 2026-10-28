"""
De Django-adminsite hoort niet bereikbaar te zijn.

De adminsite omzeilt de rollen en controles van het TMS: wie daar binnenkomt,
kan rechtstreeks in de database werken. Hij staat daarom standaard uit.

Daar komt bij dat de app zelf een pagina /admin/users heeft. Zolang Django
/admin/ opeiste, kaapte het de aanvraag zodra iemand die pagina herlaadde.
"""
from django.test import TestCase, override_settings
from django.urls import NoReverseMatch, reverse


class AdminsiteStaatUitTests(TestCase):
    def test_admin_login_bestaat_niet(self):
        antwoord = self.client.get('/admin/login/')
        self.assertEqual(antwoord.status_code, 404)

    def test_admin_hoofdpagina_bestaat_niet(self):
        """Mag ook niet omleiden naar een inlogpagina: dan bestaat hij nog."""
        antwoord = self.client.get('/admin/')
        self.assertEqual(antwoord.status_code, 404)

    def test_pagina_van_de_app_wordt_niet_gekaapt(self):
        """/admin/users is een pagina van de SPA, geen Django-pagina."""
        antwoord = self.client.get('/admin/users')
        self.assertEqual(antwoord.status_code, 404)
        self.assertNotIn('Location', antwoord.headers)

    def test_de_adminurls_zijn_niet_geregistreerd(self):
        with self.assertRaises(NoReverseMatch):
            reverse('admin:index')


class AdminsiteAanzettenTests(TestCase):
    """De noodingang moet aan te zetten zijn, anders is dit een eenrichtingsslot."""

    def tearDown(self):
        """
        De urlconf moet terug naar de stand zonder adminsite. Dit hoort buiten
        de aangepaste instelling te gebeuren, anders laadt hij de adminsite
        opnieuw in en lopen de volgende tests tegen een vervuilde urlconf aan.
        """
        self._herlaad_urls()

    @staticmethod
    def _herlaad_urls():
        import importlib

        from django.urls import clear_url_caches

        from tms import urls as tms_urls

        importlib.reload(tms_urls)
        clear_url_caches()

    def test_met_de_schakelaar_aan_bestaat_de_adminsite_weer(self):
        with override_settings(DJANGO_ADMIN_ENABLED=True):
            self._herlaad_urls()
            antwoord = self.client.get('/admin/login/')
            self.assertEqual(antwoord.status_code, 200)

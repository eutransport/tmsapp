"""De bronkeuze van het opdrachtgeversportaal.

Elke wagen hoort zijn ritten uit één bron te krijgen, en uit dezelfde bron als
track & trace. Linqo volgt alleen 41-BRR-3 nog, Navixy heeft 71-BTL-6, en al
het overige komt uit Radius. Linqo kent daarnaast nog tien oude kentekens;
zonder afbakening zou het portaal die uit Linqo halen en andere cijfers tonen
dan wij zelf zien.
"""
from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.core.cache import cache
from django.test import TestCase

from apps.opdrachten import portaal_ritten
from apps.tracking.models import NavixyConnection, NavixyTracker, RadiusJourney

NL = ZoneInfo('Europe/Amsterdam')

# Zoals Linqo ze op productie teruggeeft: elf objecten, waarvan er maar één
# werkelijk nog bijgehouden wordt.
LINQO_OBJECTEN = [
    {'id': '883805c8-9c6a-11f0-9ba8-1bbcb9a68afa',
     'vehicle_params': {'plate_number': '41-BRR-3'}},
    {'id': 'aa000000-0000-0000-0000-000000000001',
     'vehicle_params': {'plate_number': '99-BRD-5'}},
    {'id': 'aa000000-0000-0000-0000-000000000002',
     'vehicle_params': {'plate_number': '06-BZF-5'}},
]


class BronkeuzeTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        patcher = patch('apps.tracking.tachograph_service.get_objects',
                        return_value=LINQO_OBJECTEN)
        self.objecten = patcher.start()
        self.addCleanup(patcher.stop)

    def test_alleen_41_brr_3_komt_uit_linqo(self):
        kaart = portaal_ritten.linqo_objecten()

        self.assertEqual(list(kaart), ['41BRR3'])
        self.assertEqual(kaart['41BRR3']['object_id'],
                         '883805c8-9c6a-11f0-9ba8-1bbcb9a68afa')

    def test_oude_linqo_wagens_worden_niet_uit_linqo_gehaald(self):
        """99-BRD-5 staat nog in Linqo, maar Radius is voor die wagen de bron."""
        kaart = portaal_ritten.linqo_objecten()

        self.assertNotIn('99BRD5', kaart)
        self.assertNotIn('06BZF5', kaart)

    def test_de_lijst_is_aanpasbaar_zonder_codewijziging(self):
        with self.settings(PORTAAL_LINQO_KENTEKENS=['99-BRD-5']):
            cache.clear()
            kaart = portaal_ritten.linqo_objecten()

        self.assertEqual(list(kaart), ['99BRD5'])


class RittenPerBronTests(TestCase):
    """Elke wagen krijgt ritten uit precies één bron."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        patch('apps.tracking.tachograph_service.get_objects',
              return_value=LINQO_OBJECTEN).start()
        self.addCleanup(patch.stopall)

        koppeling = NavixyConnection.objects.create(naam='3687634', actief=True)
        NavixyTracker.objects.create(
            koppeling=koppeling, tracker_id=3687634,
            kenteken='71-BTL-6', actief=True,
        )

        RadiusJourney.objects.create(
            service_id='63531a56-d03e-4060-b2fd-507994929681',
            plate_number='99-BRD-5', date=date(2026, 10, 27),
            start_time=datetime(2026, 10, 27, 8, 0, tzinfo=NL),
            end_time=datetime(2026, 10, 27, 9, 0, tzinfo=NL),
            distance_km=37.7, duration_seconds=3600,
        )

    def test_41_brr_3_haalt_zijn_ritten_bij_linqo(self):
        with patch.object(portaal_ritten, '_linqo_ritten',
                          return_value=[{'datum': date(2026, 10, 27),
                                         'start_tijd': 'x', 'bron': 'linqo'}]) as linqo:
            ritten = portaal_ritten.haal_ritten(
                ['41-BRR-3'], date(2026, 10, 27), date(2026, 10, 27))

        linqo.assert_called_once()
        self.assertEqual([r['bron'] for r in ritten], ['linqo'])

    def test_71_btl_6_haalt_zijn_ritten_bij_navixy(self):
        with patch.object(portaal_ritten, '_navixy_ritten',
                          return_value=[]) as navixy, \
             patch.object(portaal_ritten, '_radius_ritten',
                          return_value=[]) as radius:
            portaal_ritten.haal_ritten(
                ['71-BTL-6'], date(2026, 10, 27), date(2026, 10, 27))

        navixy.assert_called_once_with(['71-BTL-6'], date(2026, 10, 27), date(2026, 10, 27))
        radius.assert_not_called()

    def test_99_brd_5_haalt_zijn_ritten_bij_radius(self):
        """Deze wagen staat ook in Linqo; toch moet Radius de bron zijn."""
        with patch.object(portaal_ritten, '_linqo_ritten') as linqo:
            ritten = portaal_ritten.haal_ritten(
                ['99-BRD-5'], date(2026, 10, 27), date(2026, 10, 27))

        linqo.assert_not_called()
        self.assertEqual([r['bron'] for r in ritten], ['radius'])
        self.assertEqual(ritten[0]['afstand_km'], 37.7)

    def test_elke_wagen_krijgt_zijn_eigen_bron_in_een_gemengde_opvraag(self):
        with patch.object(portaal_ritten, '_linqo_ritten',
                          return_value=[]) as linqo, \
             patch.object(portaal_ritten, '_navixy_ritten',
                          return_value=[]) as navixy, \
             patch.object(portaal_ritten, '_radius_ritten',
                          return_value=[]) as radius:
            portaal_ritten.haal_ritten(
                ['41-BRR-3', '71-BTL-6', '99-BRD-5'],
                date(2026, 10, 27), date(2026, 10, 27))

        self.assertEqual(linqo.call_count, 1)
        navixy.assert_called_once_with(['71-BTL-6'], date(2026, 10, 27), date(2026, 10, 27))
        radius.assert_called_once_with(['99-BRD-5'], date(2026, 10, 27), date(2026, 10, 27))


class StandaardBronTests(TestCase):
    """Zonder ritten moet het portaal nog steeds de juiste bron noemen."""

    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        patch('apps.tracking.tachograph_service.get_objects',
              return_value=LINQO_OBJECTEN).start()
        patch.object(portaal_ritten, '_live_positie', return_value=None).start()
        self.addCleanup(patch.stopall)

        koppeling = NavixyConnection.objects.create(naam='3687634', actief=True)
        NavixyTracker.objects.create(
            koppeling=koppeling, tracker_id=3687634,
            kenteken='71-BTL-6', actief=True,
        )

    def test_lege_dag_noemt_navixy_voor_71_btl_6(self):
        with patch.object(portaal_ritten, '_navixy_ritten', return_value=[]):
            overzicht = portaal_ritten.dagoverzicht('71-BTL-6', date(2026, 10, 27))

        self.assertEqual(overzicht['bron'], 'navixy')
        self.assertEqual(overzicht['aantal_ritten'], 0)

    def test_lege_dag_noemt_radius_voor_99_brd_5(self):
        overzicht = portaal_ritten.dagoverzicht('99-BRD-5', date(2026, 10, 27))

        self.assertEqual(overzicht['bron'], 'radius')

    def test_lege_dag_noemt_linqo_voor_41_brr_3(self):
        with patch.object(portaal_ritten, '_linqo_ritten', return_value=[]):
            overzicht = portaal_ritten.dagoverzicht('41-BRR-3', date(2026, 10, 27))

        self.assertEqual(overzicht['bron'], 'linqo')

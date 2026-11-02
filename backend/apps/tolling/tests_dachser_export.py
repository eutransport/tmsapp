"""De export per bedrijf moet de planning volgen, ook bij een wisselwagen.

De planning bepaalt wie er die dag op een route zit. Een wagen die niet
is ingepland mag niet via zijn vaste ritnummer uit de vloot alsnog op die
route belanden, want dan staat dezelfde route dubbel in de export.
"""

import datetime
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.companies.models import Company
from apps.fleet.models import Vehicle
from apps.planning.models import PlanningEntry, WeekPlanning
from apps.tolling.models import TollingEvent
from apps.tolling.views import TollingInvoicingViewSet

# Maandag 5 januari 2026 = week 2, dag 'ma'.
MAANDAG = datetime.date(2026, 1, 5)


class DachserExportPlanningTest(TestCase):
    """De route in de export komt uit de planning, niet uit de vloot."""

    def setUp(self):
        self.bedrijf = Company.objects.create(naam='Testvervoer')
        self.vaste = Vehicle.objects.create(
            kenteken='11-AAA-1', bedrijf=self.bedrijf, ritnummer='500')
        self.vervanger = Vehicle.objects.create(
            kenteken='22-BBB-2', bedrijf=self.bedrijf, ritnummer='501')
        self.planning = WeekPlanning.objects.create(
            bedrijf=self.bedrijf, weeknummer=MAANDAG.isocalendar()[1],
            jaar=MAANDAG.isocalendar()[0])

    def _event(self, kenteken, uur=10, ritnummer='', bron='', bedrag='10.00',
               dag=MAANDAG):
        norm = kenteken.replace('-', '')
        moment = timezone.make_aware(
            datetime.datetime.combine(dag, datetime.time(uur)),
            timezone.get_current_timezone())
        return TollingEvent.objects.create(
            start_at=moment, end_at=moment,
            distance_km=Decimal('10.000'), amount=Decimal(bedrag),
            license_plate_raw=kenteken, license_plate_normalized=norm,
            ritnummer=ritnummer, rit_bron=bron, bedrijf=self.bedrijf)

    def _plan(self, voertuig, ritnummer, vervangend=None):
        return PlanningEntry.objects.create(
            planning=self.planning, vehicle=voertuig, dag='ma',
            ritnummer=ritnummer, vervangend_voertuig=vervangend)

    def _rijen(self):
        return TollingInvoicingViewSet._dachser_aggregate(MAANDAG, MAANDAG)

    def test_niet_ingeplande_wagen_krijgt_de_route_niet(self):
        """De vervanger rijdt route 500; de vaste wagen mag die niet claimen."""
        self._plan(self.vaste, '500', vervangend=self.vervanger)
        self._event('22-BBB-2', ritnummer='500', bron='planning')
        self._event('11-AAA-1')  # niet ingepland, vloot zegt route 500

        rijen = self._rijen()
        op_500 = {r['plate_normalized'] for r in rijen if r['route'] == '500'}
        self.assertEqual(op_500, {'22BBB2'},
                         'alleen de ingeplande wagen hoort op route 500')

        zonder = [r for r in rijen if not r['route']]
        self.assertEqual([r['plate_normalized'] for r in zonder], ['11AAA1'],
                         'de niet-ingeplande wagen blijft zichtbaar zonder route')

    def test_bedrag_blijft_behouden(self):
        """Niets mag wegvallen: het totaalbedrag verandert niet."""
        self._plan(self.vaste, '500', vervangend=self.vervanger)
        self._event('22-BBB-2', ritnummer='500', bron='planning', bedrag='12.50')
        self._event('11-AAA-1', bedrag='7.25')

        totaal = sum(r['amount'] for r in self._rijen())
        self.assertEqual(totaal, Decimal('19.75'))

    def test_ingeplande_wagen_houdt_zijn_route(self):
        """Zonder wissel verandert er niets aan het bestaande gedrag."""
        self._plan(self.vaste, '500')
        self._event('11-AAA-1', ritnummer='500', bron='planning')

        rijen = self._rijen()
        self.assertEqual(len(rijen), 1)
        self.assertEqual(rijen[0]['route'], '500')
        self.assertEqual(rijen[0]['plate_normalized'], '11AAA1')

    def test_route_zonder_planning_blijft_uit_de_vloot_komen(self):
        """Is er die dag geen planning, dan blijft de vloot de bron."""
        self._event('11-AAA-1')

        rijen = self._rijen()
        self.assertEqual(len(rijen), 1)
        self.assertEqual(rijen[0]['route'], '500')

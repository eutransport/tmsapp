"""De tolafrekening moet dezelfde planning volgen als de export per bedrijf.

Staat er voor een dag een andere wagen in de planning op een rit, dan hoort
diens tol bij die rit en niet die van de vaste wagen. Zonder planning blijft
het kenteken van de bon leidend.
"""

import datetime
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from apps.companies.models import Company
from apps.fleet.models import Vehicle
from apps.planning.models import PlanningEntry, WeekPlanning
from apps.tolling.afrekening_analyse import analyseer_selectie
from apps.tolling.models import TolAfrekening, TolAfrekeningRegel, TollingEvent

# Maandag 5 januari 2026 = week 2, dag 'ma'.
MAANDAG = datetime.date(2026, 1, 5)
DINSDAG = datetime.date(2026, 1, 6)


class AfrekeningPlanningTest(TestCase):
    """De passages per rit volgen de planning van die dag."""

    def setUp(self):
        self.bedrijf = Company.objects.create(naam='Testvervoer')
        self.vaste = Vehicle.objects.create(
            kenteken='11-AAA-1', bedrijf=self.bedrijf, ritnummer='500')
        self.vervanger = Vehicle.objects.create(
            kenteken='22-BBB-2', bedrijf=self.bedrijf, ritnummer='501')
        self.planning = WeekPlanning.objects.create(
            bedrijf=self.bedrijf, weeknummer=MAANDAG.isocalendar()[1],
            jaar=MAANDAG.isocalendar()[0])
        self.bon = TolAfrekening.objects.create(
            bedrijf=self.bedrijf, periode_van=MAANDAG, periode_tot=DINSDAG,
            werktijd_van=datetime.time(6), werktijd_tot=datetime.time(18))

    def _regel(self, voertuig, ritnummer='500', ontvangen='0.00'):
        return TolAfrekeningRegel.objects.create(
            afrekening=self.bon, voertuig_label=voertuig.kenteken,
            ritnummer=ritnummer, vehicle=voertuig, kenteken=voertuig.kenteken,
            kentekens=[voertuig.kenteken.replace('-', '')],
            koppeling=TolAfrekeningRegel.Koppeling.GEKOPPELD,
            maut_ontvangen=Decimal(ontvangen),
            dagen=[{'datum': MAANDAG.isoformat()}, {'datum': DINSDAG.isoformat()}])

    def _event(self, kenteken, dag=MAANDAG, bedrag='10.00'):
        moment = timezone.make_aware(
            datetime.datetime.combine(dag, datetime.time(10)),
            timezone.get_current_timezone())
        return TollingEvent.objects.create(
            start_at=moment, end_at=moment,
            distance_km=Decimal('10.000'), amount=Decimal(bedrag),
            license_plate_raw=kenteken, license_plate_normalized=kenteken.replace('-', ''),
            bedrijf=self.bedrijf)

    def _plan(self, voertuig, ritnummer, dag='ma', vervangend=None):
        return PlanningEntry.objects.create(
            planning=self.planning, vehicle=voertuig, dag=dag,
            ritnummer=ritnummer, vervangend_voertuig=vervangend)

    def _rij(self, ritnummer='500'):
        regels = analyseer_selectie([self.bon])['regels']
        return next(r for r in regels if r['ritnummer'] == ritnummer)

    def test_wisselwagen_telt_mee_op_de_rit(self):
        """De vervanger rijdt route 500, dus zijn tol hoort bij die rit."""
        self._plan(self.vaste, '500', vervangend=self.vervanger)
        self._regel(self.vaste)
        self._event('22-BBB-2', bedrag='15.00')

        rij = self._rij()
        self.assertEqual(rij['betaald'], Decimal('15.00'))
        self.assertEqual(rij['kentekens_gereden'], ['22-BBB-2'])

    def test_vaste_wagen_telt_niet_op_een_dag_van_een_ander(self):
        """Rijdt de vervanger die dag de rit, dan telt de vaste wagen niet mee."""
        self._plan(self.vaste, '500', vervangend=self.vervanger)
        self._regel(self.vaste)
        self._event('22-BBB-2', bedrag='15.00')
        self._event('11-AAA-1', bedrag='99.00')  # niet ingepland die dag

        rij = self._rij()
        self.assertEqual(rij['betaald'], Decimal('15.00'))
        self.assertNotIn('11-AAA-1', rij['kentekens_gereden'])

    def test_dag_zonder_planning_houdt_het_kenteken_van_de_bon(self):
        """Dinsdag staat niet in de planning: de bon blijft dan leidend."""
        self._plan(self.vaste, '500', vervangend=self.vervanger)
        self._regel(self.vaste)
        self._event('11-AAA-1', dag=DINSDAG, bedrag='20.00')

        rij = self._rij()
        self.assertEqual(rij['betaald'], Decimal('20.00'))
        self.assertEqual(rij['kentekens_gereden'], ['11-AAA-1'])

    def test_zonder_planning_verandert_er_niets(self):
        """Het bestaande gedrag blijft gelden als er geen planning is."""
        self._regel(self.vaste)
        self._event('11-AAA-1', bedrag='30.00')
        self._event('22-BBB-2', bedrag='40.00')

        rij = self._rij()
        self.assertEqual(rij['betaald'], Decimal('30.00'))
        self.assertEqual(rij['kentekens_gereden'], ['11-AAA-1'])

    def test_beide_wagens_op_hun_eigen_dag(self):
        """Maandag de vervanger, dinsdag de vaste wagen: allebei op de rit."""
        self._plan(self.vaste, '500', vervangend=self.vervanger)
        self._plan(self.vaste, '500', dag='di')
        self._regel(self.vaste)
        self._event('22-BBB-2', bedrag='15.00')
        self._event('11-AAA-1', dag=DINSDAG, bedrag='25.00')

        rij = self._rij()
        self.assertEqual(rij['betaald'], Decimal('40.00'))
        self.assertEqual(rij['kentekens_gereden'], ['11-AAA-1', '22-BBB-2'])

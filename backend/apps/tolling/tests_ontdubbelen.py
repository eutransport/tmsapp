"""Twee bronnen, dezelfde passage: dat mag maar één keer in de database landen.

De fuel-API en de Radius-factuur noemen alleen uur en minuut, het OBU-bestand
van de wagen noemt ook de seconden. Zolang de ontdubbeling op de seconde
vergeleek kwamen 1.171 passages van oktober 2026 dubbel binnen.
"""
import datetime
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone

from .models import TollingEvent, TollingImportBatch
from .services import filter_reeds_aanwezig

PASSAGE_DUUR = datetime.timedelta(minutes=1)


def moment(dag, uur, minuut, seconde=0):
    return timezone.make_aware(
        datetime.datetime(2026, 10, dag, uur, minuut, seconde),
        timezone.get_current_timezone())


class OntdubbelenTest(TestCase):
    def setUp(self):
        self.batch = TollingImportBatch.objects.create(filename='OBU-bestand')

    def bestaand(self, start, bedrag='2.92', kenteken='BD747S', obu='315649'):
        return TollingEvent.objects.create(
            batch=self.batch, start_at=start, end_at=start + PASSAGE_DUUR,
            amount=Decimal(bedrag), distance_km=Decimal('0'), license_plate_raw=kenteken,
            license_plate_normalized=kenteken, obu=obu)

    def nieuw(self, start, bedrag='2.92', kenteken='BD747S', obu='54593'):
        return TollingEvent(
            batch=self.batch, start_at=start, end_at=start + PASSAGE_DUUR,
            amount=Decimal(bedrag), distance_km=Decimal('0'), license_plate_raw=kenteken,
            license_plate_normalized=kenteken, obu=obu)

    def test_zelfde_minuut_andere_seconden_is_een_duplicaat(self):
        """De API meldt 07:25, het OBU-bestand 07:25:33 - één passage."""
        self.bestaand(moment(1, 7, 25, 33))
        over, dubbel = filter_reeds_aanwezig([self.nieuw(moment(1, 7, 25))])
        self.assertEqual((len(over), dubbel), (0, 1))

    def test_andere_minuut_blijft_staan(self):
        self.bestaand(moment(1, 7, 25, 33))
        over, dubbel = filter_reeds_aanwezig([self.nieuw(moment(1, 7, 26))])
        self.assertEqual((len(over), dubbel), (1, 0))

    def test_ander_bedrag_blijft_staan(self):
        self.bestaand(moment(1, 7, 25, 33))
        over, dubbel = filter_reeds_aanwezig([self.nieuw(moment(1, 7, 25), bedrag='3.10')])
        self.assertEqual((len(over), dubbel), (1, 0))

    def test_andere_wagen_blijft_staan(self):
        self.bestaand(moment(1, 7, 25, 33))
        over, dubbel = filter_reeds_aanwezig([self.nieuw(moment(1, 7, 25), kenteken='BB625L')])
        self.assertEqual((len(over), dubbel), (1, 0))

    def test_twee_nauwkeurige_passages_in_dezelfde_minuut_blijven_allebei(self):
        """Zonder seconden zou de vrachtwagenheffing per wegsegment sneuvelen."""
        over, dubbel = filter_reeds_aanwezig([
            self.nieuw(moment(1, 6, 25, 10), bedrag='0.03', obu='315649'),
            self.nieuw(moment(1, 6, 25, 48), bedrag='0.03', obu='315649'),
        ])
        self.assertEqual((len(over), dubbel), (2, 0))

    def test_twee_ronde_regels_in_dezelfde_minuut_tellen_als_een(self):
        over, dubbel = filter_reeds_aanwezig([
            self.nieuw(moment(1, 6, 25), bedrag='0.03'),
            self.nieuw(moment(1, 6, 25), bedrag='0.03'),
        ])
        self.assertEqual((len(over), dubbel), (1, 1))

    def test_duplicaat_net_voor_de_rand_van_de_periode(self):
        """De ronde regel ligt vóór de nauwkeurige; de zoekperiode moet dat halen."""
        self.bestaand(moment(1, 7, 25, 33))
        over, dubbel = filter_reeds_aanwezig([self.nieuw(moment(1, 7, 25))])
        self.assertEqual((len(over), dubbel), (0, 1))

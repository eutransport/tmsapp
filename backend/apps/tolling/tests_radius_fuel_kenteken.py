"""Het kenteken van een toltransactie moet van de wagen komen, niet van de kaart.

E&U boekt de hele vloot op verzamelkaart 54593, waarop '51-BXN-5' gegraveerd
staat. Zolang de graveervelden leidend waren, kreeg elke passage van die kaart
het kenteken 51BXN5 - goed voor 1.307 verkeerd toegewezen passages in oktober.
"""
from django.test import SimpleTestCase

from .radius_fuel import kenteken_uit_transactie, verzamelkaarten
from .radius_fuel_service import _lokaal_tijdstip


def transactie(**kwargs):
    basis = {
        'card_no': 54593,
        'card_embossed_detail_1': '.',
        'card_embossed_detail_2': '51-BXN-5',
        'card_embossed_detail_3': 'None',
        'registration': None,
        'product_description': 'EETS Toll Charge',
    }
    basis.update(kwargs)
    return basis


class KentekenUitTransactieTest(SimpleTestCase):
    def test_registration_wint_van_graveerkenteken(self):
        """De verzamelkaart zegt 51-BXN-5, maar BD-747-S reed deze passage."""
        regel = transactie(registration='BD747S')
        self.assertEqual(kenteken_uit_transactie(regel), 'BD747S')

    def test_registration_met_spaties_wordt_genormaliseerd(self):
        regel = transactie(card_no=95758, card_embossed_detail_1='BB-625-L',
                           card_embossed_detail_2='None', registration='BB 625 L')
        self.assertEqual(kenteken_uit_transactie(regel), 'BB625L')

    def test_eigen_kaart_valt_terug_op_graveerkenteken(self):
        """Zonder registration mag een kaart van één wagen nog wel gebruikt worden."""
        regel = transactie(card_no=70, card_embossed_detail_1='BB-470-X',
                           card_embossed_detail_2='None')
        self.assertEqual(kenteken_uit_transactie(regel), 'BB470X')

    def test_verzamelkaart_valt_nooit_terug_op_graveerkenteken(self):
        """Liever geen kenteken dan het kenteken van de verkeerde wagen."""
        regels = [transactie(registration='BD747S'), transactie(registration='76BVJ7')]
        gedeeld = verzamelkaarten(regels)
        zonder = transactie(registration=None)
        self.assertEqual(kenteken_uit_transactie(zonder, {}, gedeeld), '')

    def test_kaartindex_wordt_niet_gebruikt_bij_verzamelkaart(self):
        kaarten = {54593: {'embossed_line_4': '51-BXN-5'}}
        regels = [transactie(registration='BD747S'), transactie(registration='41BRR3')]
        zonder = transactie(registration='.')
        self.assertEqual(
            kenteken_uit_transactie(zonder, kaarten, verzamelkaarten(regels)), '')

    def test_onbruikbare_registration_valt_door_naar_de_kaart(self):
        kaarten = {70: {'embossed_line_4': 'BB-470-X'}}
        regel = transactie(card_no=70, card_embossed_detail_1='ALGEMEEN 1',
                           card_embossed_detail_2='None', registration='.')
        self.assertEqual(kenteken_uit_transactie(regel, kaarten), 'BB470X')


class VerzamelkaartenTest(SimpleTestCase):
    def test_kaart_met_meerdere_wagens_is_een_verzamelkaart(self):
        regels = [transactie(registration='BD747S'), transactie(registration='BB625L'),
                  transactie(registration='BD747S')]
        self.assertEqual(verzamelkaarten(regels), {54593})

    def test_kaart_met_een_wagen_is_geen_verzamelkaart(self):
        regels = [transactie(card_no=95758, registration='BB625L'),
                  transactie(card_no=95758, registration='BB 625 L')]
        self.assertEqual(verzamelkaarten(regels), set())

    def test_lege_registration_telt_niet_mee(self):
        regels = [transactie(registration=None), transactie(registration='BB625L')]
        self.assertEqual(verzamelkaarten(regels), set())


class TijdstipTest(SimpleTestCase):
    """Radius mengt twee tijdbasissen; het land verraadt welke."""

    def test_nederlandse_regel_is_plaatselijke_tijd(self):
        moment = _lokaal_tijdstip('2026-10-02T08:03:00Z', 'NL')
        self.assertEqual(moment.strftime('%d-%m %H:%M'), '02-10 08:03')

    def test_duitse_regel_is_utc(self):
        """06:03 UTC is 08:03 bij ons - precies wat het OBU-bestand meldt."""
        moment = _lokaal_tijdstip('2026-10-02T06:03:00Z', 'DE')
        self.assertEqual(moment.strftime('%d-%m %H:%M'), '02-10 08:03')

    def test_belgische_disbursement_is_utc(self):
        moment = _lokaal_tijdstip('2026-10-14T12:29:00Z', 'BE')
        self.assertEqual(moment.strftime('%d-%m %H:%M'), '14-10 14:29')

    def test_wintertijd_schuift_een_uur(self):
        """Na de laatste zondag van oktober is het verschil nog maar een uur."""
        moment = _lokaal_tijdstip('2026-10-28T06:03:00Z', 'DE')
        self.assertEqual(moment.strftime('%d-%m %H:%M'), '28-10 07:03')

    def test_zonder_land_gaan_we_uit_van_utc(self):
        moment = _lokaal_tijdstip('2026-10-02T06:03:00Z', '')
        self.assertEqual(moment.strftime('%d-%m %H:%M'), '02-10 08:03')

    def test_lege_waarde_geeft_niets(self):
        self.assertIsNone(_lokaal_tijdstip('', 'NL'))
        self.assertIsNone(_lokaal_tijdstip('geen datum', 'DE'))

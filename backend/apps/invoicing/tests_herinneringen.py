from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

from django.core import mail
from django.core.mail import get_connection
from django.test import TestCase
from django.utils import timezone

from apps.companies.models import Company, HerinneringInstelling, MailingListContact
from apps.invoicing import tasks
from apps.invoicing.models import FactuurHerinnering, Invoice, InvoiceStatus, InvoiceType
from apps.maintenance.tasks import _recipients

SMTP = SimpleNamespace(
    smtp_host='smtp.test', smtp_port=25, smtp_username='', smtp_password='', smtp_use_tls=False,
)


def _locmem(**_kwargs):
    return get_connection('django.core.mail.backends.locmem.EmailBackend')


@mock.patch('apps.invoicing.tasks.get_connection', _locmem)
@mock.patch('apps.invoicing.tasks._smtp_bron', return_value=(SMTP, 'info@test.nl'))
class HandmatigeHerinneringTests(TestCase):
    def setUp(self):
        self.bedrijf = Company.objects.create(naam='Klant BV', email='klant@test.nl')
        MailingListContact.objects.create(bedrijf=self.bedrijf, naam='Boekhouding', email='fin@test.nl')
        vandaag = timezone.localdate()
        self.te_laat = Invoice.objects.create(
            factuurnummer='F-1', type=InvoiceType.VERKOOP, status=InvoiceStatus.VERZONDEN,
            bedrijf=self.bedrijf, factuurdatum=vandaag - timedelta(days=40),
            vervaldatum=vandaag - timedelta(days=10), totaal=100,
        )
        Invoice.objects.create(
            factuurnummer='F-2', type=InvoiceType.VERKOOP, status=InvoiceStatus.VERZONDEN,
            bedrijf=self.bedrijf, factuurdatum=vandaag, vervaldatum=vandaag + timedelta(days=5),
            totaal=50,
        )

    def test_alleen_te_late_facturen_naar_gekozen_adres(self, _bron):
        uitkomst = tasks.verstuur_handmatig(self.bedrijf, ['nieuw@test.nl'])

        self.assertEqual(uitkomst, {'verstuurd': ['F-1'], 'fouten': []})
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['nieuw@test.nl'])
        slot = FactuurHerinnering.objects.get()
        self.assertTrue(slot.handmatig and slot.gelukt)
        self.assertEqual(slot.ronde, 1)

    def test_handmatig_blokkeert_schema_niet(self, _bron):
        tasks.verstuur_handmatig(self.bedrijf, ['a@test.nl'])
        tasks.verstuur_handmatig(self.bedrijf, ['a@test.nl'])
        FactuurHerinnering.objects.create(invoice=self.te_laat, ronde=1, dagen_te_laat=10)
        self.assertEqual(FactuurHerinnering.objects.count(), 3)

    def test_schema_gebruikt_ingestelde_ontvangers(self, _bron):
        self.assertEqual(tasks._ontvangers(self.bedrijf), ['fin@test.nl'])
        HerinneringInstelling.objects.create(bedrijf=self.bedrijf, ontvangers=['x@test.nl'])
        self.bedrijf.refresh_from_db()
        self.assertEqual(tasks._ontvangers(self.bedrijf), ['x@test.nl'])


class APKOntvangersTests(TestCase):
    def test_zonder_ontvangers_naar_beheerders(self):
        record = mock.Mock(notify_extra_emails=[])
        record.notify_users.all.return_value = []
        beheerder = SimpleNamespace(email='beheer@test.nl')
        with mock.patch('apps.maintenance.tasks._onderhoud_beheerders', return_value=[beheerder]):
            self.assertEqual(_recipients(record), ['beheer@test.nl'])

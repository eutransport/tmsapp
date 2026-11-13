"""Kondig een update aan, of meld dat hij klaar is.

Het updatescript roept dit aan voordat het de applicatie stopt:

    python manage.py kondig_update_aan --seconden 60
    python manage.py kondig_update_aan --klaar
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import UpdateAankondiging


class Command(BaseCommand):
    help = 'Toon een updatebanner in de app en stuur een pushmelding naar iedereen.'

    def add_arguments(self, parser):
        parser.add_argument('--seconden', type=int, default=60,
                            help='Over hoeveel seconden de update begint (standaard 60).')
        parser.add_argument('--klaar', action='store_true',
                            help='De update is afgerond; de banner verdwijnt.')
        parser.add_argument('--geen-push', action='store_true',
                            help='Alleen de banner tonen, geen pushmelding sturen.')

    def handle(self, *args, **opties):
        nu = timezone.now()

        if opties['klaar']:
            aantal = UpdateAankondiging.rond_af(push=not opties['geen_push'])
            self.stdout.write(self.style.SUCCESS(f'Update afgerond ({aantal} aankondiging(en) gesloten).'))
            return

        seconden = max(0, opties['seconden'])
        UpdateAankondiging.objects.filter(afgerond_om__isnull=True).update(afgerond_om=nu)
        start = UpdateAankondiging.objects.create(start_om=nu + timedelta(seconds=seconden)).start_om
        self.stdout.write(self.style.SUCCESS(
            f'Update aangekondigd voor {timezone.localtime(start):%H:%M:%S}.'
        ))

        if opties['geen_push']:
            return
        try:
            from apps.notifications.services import get_push_service

            service = get_push_service()
            if not service.is_configured():
                self.stdout.write('Pushmeldingen zijn niet ingesteld; alleen de banner wordt getoond.')
                return
            minuten = max(1, round(seconden / 60))
            uitkomst = service.send_to_all(
                title='De applicatie wordt bijgewerkt',
                body=(
                    f'Over {minuten} minuut wordt de applicatie bijgewerkt. '
                    'Sla je werk op; de app is daarna enkele minuten niet bereikbaar.'
                ),
                url='/',
                data={'type': 'app_update'},
            )
            self.stdout.write(f'Pushmelding verstuurd: {uitkomst}')
        except Exception as fout:  # noqa: BLE001
            # De update mag nooit stranden op een mislukte melding.
            self.stderr.write(f'Pushmelding mislukt: {fout}')

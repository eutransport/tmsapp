"""
Herimporteer het Radius-ritarchief voor een periode.

Nodig na de tijdzonecorrectie: de ritten van Radius komen binnen zonder
tijdzone maar staan in UTC. Die waarden werden eerder als Amsterdamse tijd
gelezen, waardoor elke rit twee uur te vroeg in het archief stond.

Alleen opnieuw synchroniseren is niet genoeg. De unieke sleutel van een rit is
``(service_id, start_time)``; omdat het tijdstip verandert, zou een gewone sync
nieuwe records naast de oude zetten in plaats van ze bij te werken. Daarom
verwijdert dit commando eerst de betrokken periode en haalt die daarna opnieuw
op.

Gebruik:
    python manage.py radius_herimport --dagen 30 --bevestig
"""
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.tracking.models import RadiusJourney, RadiusSyncLog
from apps.tracking.radius_archive_service import sync_radius_journeys
from apps.tracking.radius_service import JOURNEYS_MAX_DAGEN, RadiusError


class Command(BaseCommand):
    help = 'Verwijdert het Radius-ritarchief voor een periode en haalt het opnieuw op.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dagen',
            type=int,
            default=30,
            help='Aantal dagen terug (standaard 30; Radius bewaart niet veel meer).',
        )
        parser.add_argument(
            '--bevestig',
            action='store_true',
            help='Vereist. Zonder deze vlag wordt er niets verwijderd.',
        )

    def handle(self, *args, **opties):
        dagen = opties['dagen']
        if dagen < 1:
            raise CommandError('--dagen moet minimaal 1 zijn.')

        tot = timezone.localdate()
        van = tot - timedelta(days=dagen - 1)

        aantal = RadiusJourney.objects.filter(date__gte=van, date__lte=tot).count()
        self.stdout.write(f'Periode: {van} t/m {tot} ({dagen} dagen)')
        self.stdout.write(f'Ritten die nu in het archief staan: {aantal}')

        if not opties['bevestig']:
            self.stdout.write(self.style.WARNING(
                '\nEr is NIETS gewijzigd. Draai het commando opnieuw met --bevestig '
                'om deze periode te verwijderen en opnieuw op te halen.'
            ))
            return

        totaal_opgehaald = 0
        totaal_nieuw = 0

        # Radius staat maar een beperkte periode per aanroep toe, dus in blokken.
        blok_start = van
        while blok_start <= tot:
            blok_eind = min(blok_start + timedelta(days=JOURNEYS_MAX_DAGEN - 1), tot)
            self.stdout.write(f'\n{blok_start} t/m {blok_eind} ...')

            try:
                with transaction.atomic():
                    verwijderd, _ = RadiusJourney.objects.filter(
                        date__gte=blok_start, date__lte=blok_eind
                    ).delete()
                    RadiusSyncLog.objects.filter(
                        date__gte=blok_start, date__lte=blok_eind
                    ).delete()
                    self.stdout.write(f'  verwijderd: {verwijderd}')

                    resultaat = sync_radius_journeys(
                        blok_start.isoformat(), blok_eind.isoformat()
                    )
            except RadiusError as exc:
                raise CommandError(f'Ophalen bij Radius mislukt: {exc}')

            opgehaald = resultaat.get('journeys_fetched', 0)
            aangemaakt = resultaat.get('journeys_created', 0)
            totaal_opgehaald += opgehaald
            totaal_nieuw += aangemaakt
            self.stdout.write(
                f'  opgehaald: {opgehaald}, opgeslagen: {aangemaakt}, '
                f'wagens: {resultaat.get("vehicles", 0)}'
            )

            blok_start = blok_eind + timedelta(days=1)

        self.stdout.write(self.style.SUCCESS(
            f'\nKlaar. {totaal_opgehaald} ritten opgehaald, {totaal_nieuw} opgeslagen.'
        ))

        vroegste = RadiusJourney.objects.filter(
            date__gte=van, date__lte=tot
        ).order_by('start_time').first()
        if vroegste:
            lokaal = timezone.localtime(vroegste.start_time)
            self.stdout.write(
                f'Vroegste rit in het archief: {vroegste.plate_number} op '
                f'{lokaal.strftime("%d-%m-%Y om %H:%M")} (lokale tijd).'
            )

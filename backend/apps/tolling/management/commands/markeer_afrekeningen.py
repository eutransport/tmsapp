"""Inhaalslag: tolheffing die de opdrachtgever al vergoed heeft markeren.

Sinds het inlezen van een afrekening dit zelf doet is dit alleen nog nodig
voor de bonnen die daarvoor al ingelezen waren.
"""
from django.core.management.base import BaseCommand

from apps.tolling import afrekening_service as service
from apps.tolling.models import TolAfrekening


class Command(BaseCommand):
    help = 'Markeer de tolpassages binnen de werkdag van alle ingelezen afrekeningen.'

    def add_arguments(self, parser):
        parser.add_argument('--bon', action='append', default=[],
                            help='Alleen dit bonnummer (mag vaker).')
        parser.add_argument('--toepassen', action='store_true',
                            help='Zonder deze vlag wordt alleen geteld.')

    def handle(self, *args, **opties):
        bonnen = TolAfrekening.objects.all().order_by('periode_van')
        if opties['bon']:
            bonnen = bonnen.filter(bonnummer__in=opties['bon'])

        totaal = 0
        for afrekening in bonnen:
            aantal = (service.markeer_gefactureerd(afrekening)['gemarkeerd']
                      if opties['toepassen'] else service.tel_te_markeren(afrekening))
            totaal += aantal
            self.stdout.write(
                f"{afrekening.bonnummer or '-'} "
                f"({afrekening.periode_van} t/m {afrekening.periode_tot}): {aantal} passages")

        woord = 'gemarkeerd' if opties['toepassen'] else 'te markeren'
        self.stdout.write(self.style.SUCCESS(f'Totaal {totaal} passages {woord}.'))
        if not opties['toepassen']:
            self.stdout.write('Draai opnieuw met --toepassen om het door te voeren.')

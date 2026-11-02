"""Tolpassages herstellen die op het kenteken van een verzamelkaart staan.

E&U boekt de hele vloot op kaart 54593. Op die kaart staat '51-BXN-5'
gegraveerd, en zolang de import dat graveerkenteken gebruikte kreeg elke
passage van die kaart het kenteken 51BXN5: in oktober 2026 waren dat er 1.307,
goed voor bijna 5.000 euro op de verkeerde wagen.

De import leest het kenteken inmiddels uit ``registration`` (zie
``apps.tolling.radius_fuel``). Dit commando ruimt op wat er onder het oude
gedrag is binnengekomen: het verwijdert de passages van de verzamelkaart en
haalt de periode opnieuw op. Wat al via een andere bron is ingelezen wordt
daarbij ontdubbeld op kenteken, tijd en bedrag.

    python manage.py herstel_verzamelkaart --van 2026-09-18
    python manage.py herstel_verzamelkaart --van 2026-09-18 --toepassen
"""
from collections import Counter
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone

from apps.tolling.models import TollingEvent
from apps.tolling.radius_factuur_parser import Factuur
from apps.tolling.radius_factuur_service import importeer
from apps.tolling.radius_fuel_service import haal_tolregels

# Het kaartnummer belandt als OBU op de passage.
VERZAMELKAART = '54593'


def _datum(tekst):
    try:
        return date.fromisoformat(tekst)
    except (TypeError, ValueError):
        raise CommandError(f'Onbruikbare datum: {tekst!r} (verwacht JJJJ-MM-DD).')


class Command(BaseCommand):
    help = ('Verwijder tolpassages die op het kenteken van een verzamelkaart staan '
            'en haal de periode opnieuw op met het juiste kenteken.')

    def add_arguments(self, parser):
        parser.add_argument('--kaart', default=VERZAMELKAART,
                            help=f'Kaartnummer van de verzamelkaart (standaard {VERZAMELKAART}).')
        parser.add_argument('--van', help='Eerste dag om opnieuw op te halen (JJJJ-MM-DD).')
        parser.add_argument('--tot', help='Laatste dag om opnieuw op te halen (JJJJ-MM-DD).')
        parser.add_argument('--toepassen', action='store_true',
                            help='Zonder deze vlag wordt alleen getoond wat er zou gebeuren.')

    def handle(self, *args, **opties):
        kaart = str(opties['kaart'])
        besmet = TollingEvent.objects.filter(obu=kaart)
        cijfers = besmet.aggregate(n=Count('id'), bedrag=Sum('amount'))
        aantal = cijfers['n'] or 0

        if not aantal:
            self.stdout.write(self.style.SUCCESS(
                f'Geen passages met kaart {kaart}; er valt niets te herstellen.'))
            return

        verdeling = Counter(besmet.values_list('license_plate_normalized', flat=True))
        self.stdout.write(f'Passages op kaart {kaart}: {aantal} '
                          f'(EUR {cijfers["bedrag"] or 0})')
        for kenteken, n in verdeling.most_common():
            self.stdout.write(f'   {kenteken or "(leeg)":12} {n}')

        eerste = besmet.order_by('start_at').values_list('start_at', flat=True).first()
        laatste = besmet.order_by('-start_at').values_list('start_at', flat=True).first()
        van = _datum(opties['van']) if opties['van'] else timezone.localtime(eerste).date()
        tot = _datum(opties['tot']) if opties['tot'] else timezone.localtime(laatste).date()
        if van > tot:
            raise CommandError('--van ligt na --tot.')

        self.stdout.write(f'Opnieuw ophalen: {van} t/m {tot}')

        if not opties['toepassen']:
            self.stdout.write('Proefdraai; draai opnieuw met --toepassen om het door te voeren.')
            return

        # Eerst weg, dan opnieuw: anders ziet de ontdubbeling de foute passages
        # als bestaand en slaat ze de juiste over.
        with transaction.atomic():
            verwijderd, _ = besmet.delete()
        self.stdout.write(f'{verwijderd} passages verwijderd.')

        regels, overgeslagen, verslag = haal_tolregels(van, tot)
        for rij in verslag:
            self.stdout.write(f'   {rij}')
        if overgeslagen:
            self.stdout.write(self.style.WARNING(
                f'{len(overgeslagen)} transacties zonder kenteken overgeslagen.'))

        naam = f'Herstel verzamelkaart {kaart} {van} t/m {tot}'
        uitkomst = importeer(Factuur(factuurnummer='Radius API',
                                     factuurdatum=timezone.localdate().isoformat(),
                                     regels=regels), None, naam)

        nieuw = Counter(TollingEvent.objects.filter(batch=uitkomst.batch)
                        .values_list('license_plate_normalized', flat=True))
        self.stdout.write(f'Opnieuw ingelezen: {uitkomst.geimporteerd} van {uitkomst.totaal} '
                          f'({uitkomst.duplicaten} al aanwezig).')
        for kenteken, n in nieuw.most_common():
            self.stdout.write(f'   {kenteken or "(leeg)":12} {n}')
        self.stdout.write(self.style.SUCCESS('Herstel afgerond.'))

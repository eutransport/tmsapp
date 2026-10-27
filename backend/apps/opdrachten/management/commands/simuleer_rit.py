"""Speel een rit na zodat de voortgangsbalk bij de opdrachtgever zichtbaar beweegt.

Bedoeld om met eigen ogen te controleren of de balk meeloopt en of de melding
'aangekomen bij klant' vanzelf verschijnt. Alleen vanaf de commandoregel te
starten; er is geen webpad naartoe.

De wagen rijdt in rechte lijn naar het adres. Per stap wordt de stand
weggeschreven zoals de GPS-koppeling dat zou doen, en de laatste stap loopt
door de echte aankomstcontrole uit eta.py.

Voorbeeld:
    python manage.py simuleer_rit --minuten 60 --stappen 12 --pauze 20
    python manage.py simuleer_rit --opruimen
"""
import time
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from apps.opdrachten import eta as eta_module
from apps.opdrachten.models import (
    Opdracht, OpdrachtFase, OpdrachtRegel, OpdrachtStatus, RegelSoort,
)

RITNUMMER = 'SIM-RIT'

# Bestemming: Moveo in Nijmegen. De wagen vertrekt uit de richting Arnhem.
BESTEMMING = (51.8126, 5.8372)
START = (51.9851, 5.8987)


def _tussenpunt(fractie):
    """Positie onderweg: 0 is het vertrekpunt, 1 is de bestemming."""
    lat = START[0] + (BESTEMMING[0] - START[0]) * fractie
    lng = START[1] + (BESTEMMING[1] - START[1]) * fractie
    return lat, lng


class Command(BaseCommand):
    help = 'Speelt een rit na zodat de voortgangsbalk zichtbaar meebeweegt.'

    def add_arguments(self, parser):
        parser.add_argument('--minuten', type=int, default=60,
                            help='Rijtijd waarmee de rit begint (standaard 60).')
        parser.add_argument('--stappen', type=int, default=12,
                            help='Aantal metingen onderweg (standaard 12).')
        parser.add_argument('--pauze', type=float, default=20.0,
                            help='Seconden tussen twee metingen (standaard 20).')
        parser.add_argument('--opruimen', action='store_true',
                            help='Verwijder de proefopdracht en stop.')

    def handle(self, *args, **opties):
        if opties['opruimen']:
            aantal, _ = Opdracht.objects.filter(ritnummer=RITNUMMER).delete()
            self.stdout.write(self.style.SUCCESS(
                f'Proefopdracht opgeruimd ({aantal} rijen).'
            ))
            return

        opdracht = self._opdracht_klaarzetten()
        self.stdout.write(self.style.SUCCESS(
            f'Opdracht {opdracht.ritnummer} staat klaar bij {opdracht.bedrijf.naam}.'
        ))
        self.stdout.write(
            'Open het portaal van de opdrachtgever en kijk mee. '
            'Opruimen kan met --opruimen.\n'
        )

        self._rijden(opdracht, opties['minuten'], opties['stappen'], opties['pauze'])

    # -- opzet --------------------------------------------------------------

    def _opdracht_klaarzetten(self):
        from apps.accounts.models import User
        from apps.drivers.models import Driver

        opdrachtgever = (
            User.objects.filter(rol='opdrachtgever', opdrachtgever_bedrijf__isnull=False)
            .select_related('opdrachtgever_bedrijf').first()
        )
        if opdrachtgever is None:
            raise CommandError(
                'Geen opdrachtgever met een bedrijf gevonden; maak er eerst een aan.'
            )
        bedrijf = opdrachtgever.opdrachtgever_bedrijf

        chauffeur = Driver.objects.filter(bedrijf=bedrijf).first()
        if chauffeur is None:
            raise CommandError(f'Geen chauffeur gevonden bij {bedrijf.naam}.')

        Opdracht.objects.filter(ritnummer=RITNUMMER).delete()

        nu = timezone.now()
        opdracht = Opdracht.objects.create(
            ritnummer=RITNUMMER,
            bedrijf=bedrijf,
            aangemaakt_door=opdrachtgever,
            chauffeur=chauffeur,
            klant_naam='Proefrit (simulatie)',
            adres='Kerkenbos 1101',
            postcode='6546 BC',
            plaats='Nijmegen',
            notitie='Nagespeelde rit om de voortgangsbalk te controleren.',
            kenteken='SIM-01',
            bestemming_lat=BESTEMMING[0],
            bestemming_lng=BESTEMMING[1],
            werk_laden=True,
            werk_lossen=True,
            status=OpdrachtStatus.GESTART,
            gestart_op=nu,
            fase=OpdrachtFase.ONDERWEG,
        )
        OpdrachtRegel.objects.bulk_create([
            OpdrachtRegel(opdracht=opdracht, ordernummer='HMMU6426781',
                          omschrijving='PEAR 999 BOX', aantal_pallets=9,
                          soort=RegelSoort.LADEN, volgorde=0),
            OpdrachtRegel(opdracht=opdracht, ordernummer='CLKU5011377',
                          omschrijving='NOIR 758 BOX', aantal_pallets=5,
                          soort=RegelSoort.LOSSEN, volgorde=1),
        ])
        return opdracht

    # -- de rit zelf --------------------------------------------------------

    def _rijden(self, opdracht, minuten, stappen, pauze):
        totale_afstand = eta_module._afstand_meter(START, BESTEMMING) / 1000

        for stap in range(stappen + 1):
            fractie = stap / stappen
            positie = _tussenpunt(fractie)
            resterend = max(int(round(minuten * (1 - fractie))), 0)
            afstand = round(totale_afstand * (1 - fractie), 1)

            # De echte aankomstcontrole, niet een eigen kopie ervan.
            aangekomen = eta_module._aankomst_bijwerken(
                opdracht,
                {'latitude': positie[0], 'longitude': positie[1]},
                BESTEMMING,
            )
            if aangekomen:
                self._regel(stap, stappen, resterend, afstand, 100, 'AANGEKOMEN BIJ KLANT')
                self.stdout.write(self.style.SUCCESS(
                    '\nDe balk staat nu vol en groen. De chauffeur kan kiezen uit '
                    'wachten op klant, beginnen met laden of beginnen met lossen.'
                ))
                return

            # Zet de stand weg zoals de GPS-koppeling dat zou doen. Door
            # eta_bijgewerkt_op op nu te zetten laat de echte verversing deze
            # opdracht met rust, zodat de simulatie niet overschreven wordt.
            eta_module._bewaar(
                opdracht,
                eta_minuten=resterend,
                eta_start_minuten=opdracht.eta_start_minuten or minuten,
                eta_afstand_km=afstand,
                eta_aankomst=timezone.now() + timedelta(minutes=resterend),
                eta_fout='',
            )
            start = opdracht.eta_start_minuten or minuten
            percentage = int(round((start - resterend) / start * 100)) if start else 0
            self._regel(stap, stappen, resterend, afstand, percentage, 'onderweg')

            if stap < stappen:
                time.sleep(pauze)

        self.stdout.write(self.style.WARNING(
            '\nDe rit is afgelopen zonder dat de aankomst werd vastgesteld. '
            f'Controleer de straal (nu {eta_module.AANKOMST_STRAAL_METER} meter).'
        ))

    def _regel(self, stap, stappen, resterend, afstand, percentage, fase):
        balk = '#' * (percentage // 5) + '.' * (20 - percentage // 5)
        self.stdout.write(
            f'[{stap:>2}/{stappen}] [{balk}] {percentage:>3}%  '
            f'nog {resterend:>3} min  {afstand:>6} km  {fase}'
        )

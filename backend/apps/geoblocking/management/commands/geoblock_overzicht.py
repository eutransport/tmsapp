"""
Samenvatting van het geo-logboek, bedoeld als beslishulp.

Het logboek zelf is een lijst losse verzoeken. Bij honderden regels per dag
zie je het patroon niet. Dit commando telt ze op per land en rol, en zet
bovenaan waar het om gaat: zouden er mensen sneuvelen die erin horen?

    python manage.py geoblock_overzicht
    python manage.py geoblock_overzicht --dagen 3
"""

from collections import Counter

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.geoblocking.models import (
    ROLE_ANONYMOUS,
    GeoAccessLog,
    GeoBlockSettings,
    LogDecision,
)

# Rollen die bij een ingelogde medewerker of klant horen. Verkeer van deze
# rollen dat geweigerd zou worden, is vrijwel altijd een eigen gebruiker die
# je per ongeluk buitensluit - en dus een reden om nog niet om te zetten.
EIGEN_ROLLEN = {'admin', 'gebruiker', 'chauffeur', 'opdrachtgever'}


class Command(BaseCommand):
    help = 'Vat het geo-logboek samen per land en rol, als hulp bij de beslissing.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dagen',
            type=int,
            default=1,
            help='Over hoeveel dagen terugkijken (standaard 1).',
        )

    def handle(self, *args, **options):
        dagen = max(1, options['dagen'])
        vanaf = timezone.now() - timezone.timedelta(days=dagen)

        config = GeoBlockSettings.load()
        logs = GeoAccessLog.objects.filter(created_at__gte=vanaf)
        totaal = logs.count()

        modus = 'alleen loggen' if config.mode == 'monitor' else 'ACTIEF BLOKKEREN'
        self.stdout.write('')
        self.stdout.write(f'Geo-logboek over de laatste {dagen} dag(en)')
        self.stdout.write(f'Stand: {"aan" if config.enabled else "uit"}, modus {modus}')
        self.stdout.write('')

        if not totaal:
            self.stdout.write(
                'Geen enkele logregel. Let op: je eigen kantoorverkeer wordt '
                'bewust niet gelogd, dus dit kan kloppen. Maar het betekent ook '
                'dat je nog niets gemeten hebt om op te beslissen.'
            )
            return

        geweigerd = [
            lg for lg in logs
            if lg.decision in (LogDecision.WOULD_BLOCK, LogDecision.BLOCKED)
        ]
        toegestaan = totaal - len(geweigerd)

        self.stdout.write(f'Totaal verzoeken      : {totaal}')
        self.stdout.write(f'  zou doorgelaten     : {toegestaan}')
        self.stdout.write(f'  zou geweigerd       : {len(geweigerd)}')
        self.stdout.write('')

        self._tabel('Zou geweigerd worden, per land en rol', geweigerd)
        self._onbekend(geweigerd)
        self._oordeel(geweigerd)

    def _tabel(self, titel, regels):
        self.stdout.write(titel)
        if not regels:
            self.stdout.write('  (niets)')
            self.stdout.write('')
            return

        teller = Counter((lg.country_code or '??', lg.role or '?') for lg in regels)
        for (land, rol), aantal in teller.most_common():
            markering = '  <-- EIGEN GEBRUIKER' if rol in EIGEN_ROLLEN else ''
            self.stdout.write(f'  {land:4s} {rol:14s} {aantal:5d}{markering}')
        self.stdout.write('')

    def _onbekend(self, geweigerd):
        onbekend = [lg for lg in geweigerd if not lg.country_code]
        if not onbekend:
            return
        self.stdout.write(
            f'Let op: {len(onbekend)} verzoek(en) zonder herkenbaar land. '
            'Bij actief blokkeren worden die geweigerd zodra je "onbekend land '
            'blokkeren" aanzet. Laat die instelling voorlopig uit.'
        )
        self.stdout.write('')

    def _oordeel(self, geweigerd):
        eigen = [lg for lg in geweigerd if lg.role in EIGEN_ROLLEN]
        anoniem_landen = {
            lg.country_code for lg in geweigerd
            if lg.role == ROLE_ANONYMOUS and lg.country_code
        }

        self.stdout.write('Oordeel')
        if eigen:
            landen = sorted({lg.country_code or '??' for lg in eigen})
            self.stdout.write(self.style.WARNING(
                '  NOG NIET omzetten. Er zijn ingelogde eigen gebruikers die '
                'geweigerd zouden worden, uit: ' + ', '.join(landen) + '.'
            ))
            self.stdout.write(
                '  Voeg die landen toe (eventueel alleen voor de rol die je ziet) '
                'en meet opnieuw.'
            )
        else:
            self.stdout.write(self.style.SUCCESS(
                '  Geen enkele ingelogde eigen gebruiker zou geweigerd worden.'
            ))
            if anoniem_landen:
                self.stdout.write(
                    '  Alleen niet-ingelogd verkeer uit: '
                    + ', '.join(sorted(anoniem_landen))
                    + '. Dat is doorgaans precies wat je wilt weren.'
                )
            self.stdout.write(
                '  Je kunt omzetten naar actief blokkeren. Zet daarna '
                '"Ook toegestane verzoeken loggen" uit.'
            )
        self.stdout.write('')

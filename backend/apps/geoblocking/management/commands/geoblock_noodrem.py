"""
Noodrem voor geo-blokkering, te bedienen vanaf de server.

Dit commando bestaat voor één scenario: je hebt jezelf buitengesloten.
Je komt niet meer bij de beheerpagina, dus je moet het via SSH kunnen
herstellen. Daarom doet dit commando bewust niets ingewikkelds en vraagt
het nergens om een inlog.

Voorbeelden:

    # Wat staat er nu aan?
    python manage.py geoblock_noodrem --status

    # Alles uitzetten (snelste weg terug naar binnen)
    python manage.py geoblock_noodrem --uit

    # Je nieuwe IP blijvend toelaten en daarna weer aanzetten
    python manage.py geoblock_noodrem --sta-ip-toe 1.2.3.4 --label "Kantoor"
    python manage.py geoblock_noodrem --aan
"""

import ipaddress

from django.core.management.base import BaseCommand, CommandError

from apps.geoblocking import services
from apps.geoblocking.models import (
    EnforcementMode,
    GeoBlockSettings,
    IPRule,
    RuleAction,
)


class Command(BaseCommand):
    help = 'Noodrem: zet geo-blokkering uit of laat een IP-adres alsnog toe.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--uit',
            action='store_true',
            help='Zet geo-blokkering volledig uit. Niemand wordt meer geweigerd.',
        )
        parser.add_argument(
            '--aan',
            action='store_true',
            help='Zet geo-blokkering weer aan in actief blokkeren.',
        )
        parser.add_argument(
            '--monitor',
            action='store_true',
            help='Zet aan, maar alleen loggen: er wordt niets geblokkeerd.',
        )
        parser.add_argument(
            '--sta-ip-toe',
            dest='ip',
            help='IP-adres of reeks (CIDR) dat er altijd door mag, bijv. 1.2.3.4 of 1.2.3.0/24.',
        )
        parser.add_argument(
            '--label',
            default='Noodrem',
            help='Omschrijving bij de IP-regel, bijv. "Kantoor Ede".',
        )
        parser.add_argument(
            '--status',
            action='store_true',
            help='Toon de huidige instellingen en toegestane IP-adressen.',
        )

    def handle(self, *args, **options):
        config = GeoBlockSettings.load()

        if options['ip']:
            self._sta_ip_toe(options['ip'], options['label'])

        if options['uit']:
            config.enabled = False
            config.save(update_fields=['enabled', 'updated_at'])
            self.stdout.write(self.style.SUCCESS(
                'Geo-blokkering staat UIT. Er wordt niemand meer geweigerd.'
            ))

        if options['monitor']:
            config.enabled = True
            config.mode = EnforcementMode.MONITOR
            config.save(update_fields=['enabled', 'mode', 'updated_at'])
            self.stdout.write(self.style.SUCCESS(
                'Geo-blokkering staat AAN in alleen loggen. Er wordt nog niets geblokkeerd.'
            ))

        if options['aan']:
            config.enabled = True
            config.mode = EnforcementMode.ENFORCE
            config.save(update_fields=['enabled', 'mode', 'updated_at'])
            self.stdout.write(self.style.WARNING(
                'Geo-blokkering staat AAN en blokkeert actief.'
            ))

        services.invalidate_rules_cache()
        self._toon_status(GeoBlockSettings.load())

    def _sta_ip_toe(self, cidr, label):
        # Eerst controleren, pas daarna opslaan. Andersom zou een typefout
        # een onbruikbare regel in de database achterlaten.
        tekst = (cidr or '').strip()
        try:
            netwerk = ipaddress.ip_network(tekst, strict=False)
        except ValueError:
            raise CommandError(
                f'"{tekst}" is geen geldig IP-adres of reeks. '
                'Gebruik bijvoorbeeld 203.0.113.5 of 203.0.113.0/24.'
            )

        genormaliseerd = str(netwerk)
        regel, aangemaakt = IPRule.objects.get_or_create(
            cidr=genormaliseerd,
            defaults={'action': RuleAction.ALLOW, 'label': label, 'active': True},
        )
        if not aangemaakt:
            regel.action = RuleAction.ALLOW
            regel.active = True
            regel.label = label or regel.label
            regel.save(update_fields=['action', 'active', 'label'])

        self.stdout.write(self.style.SUCCESS(
            f'{genormaliseerd} mag er altijd door ({regel.label}).'
        ))

    def _toon_status(self, config):
        modus = 'alleen loggen' if config.mode == EnforcementMode.MONITOR else 'actief blokkeren'
        self.stdout.write('')
        self.stdout.write('Huidige stand van zaken')
        self.stdout.write(f'  Ingeschakeld          : {"ja" if config.enabled else "nee"}')
        self.stdout.write(f'  Modus                 : {modus}')
        self.stdout.write(f'  Standaardactie        : {config.default_action}')
        self.stdout.write(f'  Onbekend land blokkeren: {"ja" if config.block_unknown_country else "nee"}')
        self.stdout.write(f'  Superusers nooit blokkeren: {"ja" if config.allow_superuser_bypass else "nee"}')
        self.stdout.write(f'  GeoIP-database aanwezig: {"ja" if services.database_available() else "nee"}')

        toegestaan = IPRule.objects.filter(active=True, action=RuleAction.ALLOW)
        self.stdout.write('  Altijd toegestane IP-adressen:')
        if not toegestaan:
            self.stdout.write('    (geen)')
        for regel in toegestaan:
            self.stdout.write(f'    {regel.cidr}  {regel.label}')
        self.stdout.write('')

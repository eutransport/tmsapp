"""
Download of ververs de MaxMind GeoLite2-Country database.

Gebruik:
    python manage.py update_geoip_db

Vereist een gratis MaxMind-account. Zet de licentiesleutel in de omgeving:
    MAXMIND_LICENSE_KEY=...
    MAXMIND_ACCOUNT_ID=...   (niet nodig voor de download-URL, wel voor het portaal)
"""
import io
import os
import shutil
import tarfile
import tempfile

import requests
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from apps.geoblocking.services import get_database_path, reset_reader

DOWNLOAD_URL = (
    'https://download.maxmind.com/app/geoip_download'
    '?edition_id=GeoLite2-Country&license_key={key}&suffix=tar.gz'
)
# MaxMind accepteert daarnaast basic auth met account-id + licentiesleutel.
# Dat is de weg die de officiele geoipupdate-tool bewandelt.
DOWNLOAD_URL_BASIC = (
    'https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz'
)


class Command(BaseCommand):
    help = 'Download de MaxMind GeoLite2-Country database voor geo-blocking.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--license-key',
            dest='license_key',
            default=None,
            help='Overschrijft MAXMIND_LICENSE_KEY uit de omgeving.',
        )

        parser.add_argument(
            '--account-id',
            dest='account_id',
            default=None,
            help='Overschrijft MAXMIND_ACCOUNT_ID uit de omgeving.',
        )

    def handle(self, *args, **options):
        key = (
            options.get('license_key')
            or os.environ.get('MAXMIND_LICENSE_KEY')
            or getattr(settings, 'MAXMIND_LICENSE_KEY', '')
        )
        if not key:
            raise CommandError(
                'Geen licentiesleutel gevonden. Zet MAXMIND_LICENSE_KEY in de omgeving '
                'of gebruik --license-key. Een gratis sleutel maak je aan op '
                'https://www.maxmind.com/en/geolite2/signup'
            )

        doel = get_database_path()
        os.makedirs(os.path.dirname(doel), exist_ok=True)

        self.stdout.write('GeoLite2-Country database ophalen bij MaxMind...')
        account_id = (
            options.get('account_id')
            or os.environ.get('MAXMIND_ACCOUNT_ID')
            or getattr(settings, 'MAXMIND_ACCOUNT_ID', '')
        )
        try:
            if account_id:
                antwoord = requests.get(
                    DOWNLOAD_URL_BASIC, auth=(str(account_id), key), timeout=120
                )
            else:
                antwoord = requests.get(DOWNLOAD_URL.format(key=key), timeout=120)
        except requests.RequestException as exc:
            raise CommandError(f'Download mislukt: {exc}')

        if antwoord.status_code == 401:
            raise CommandError(
                'MaxMind weigert de licentiesleutel (401). Controleer MAXMIND_LICENSE_KEY.'
            )
        if antwoord.status_code != 200:
            raise CommandError(f'Download mislukt met status {antwoord.status_code}.')

        mmdb = self._extract(antwoord.content)
        if mmdb is None:
            raise CommandError('Geen .mmdb-bestand gevonden in het archief van MaxMind.')

        with tempfile.NamedTemporaryFile(delete=False, dir=os.path.dirname(doel)) as tmp:
            tmp.write(mmdb)
            tijdelijk = tmp.name
        # Atomisch vervangen, zodat lopende verzoeken geen half bestand zien.
        shutil.move(tijdelijk, doel)
        reset_reader()

        grootte = os.path.getsize(doel) / (1024 * 1024)
        self.stdout.write(self.style.SUCCESS(f'Database opgeslagen in {doel} ({grootte:.1f} MB).'))

    @staticmethod
    def _extract(inhoud):
        with tarfile.open(fileobj=io.BytesIO(inhoud), mode='r:gz') as archief:
            for lid in archief.getmembers():
                if lid.name.endswith('.mmdb'):
                    bestand = archief.extractfile(lid)
                    if bestand is not None:
                        return bestand.read()
        return None

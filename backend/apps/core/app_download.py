"""Download van de Android-app (APK) vanaf de eigen server.

De APK staat buiten de publieke mediapaden, dus hij is alleen bereikbaar via
een ondertekende, aflopende URL die uitsluitend aan ingelogde gebruikers
wordt uitgegeven.
"""
from __future__ import annotations

import os
import re
from urllib.parse import quote

from django.conf import settings
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .file_signing import sign_media_path

APK_RELATIVE_PATH = 'app/tms-android.apk'
VERSION_FILE = 'app/android-version.txt'
DOWNLOAD_TTL_SECONDS = 15 * 60


def _apk_absolute_path() -> str:
    return os.path.join(settings.MEDIA_ROOT, *APK_RELATIVE_PATH.split('/'))


def _read_version() -> str:
    pad = os.path.join(settings.MEDIA_ROOT, *VERSION_FILE.split('/'))
    try:
        with open(pad, 'r', encoding='utf-8') as fh:
            rauw = fh.read().strip()[:32]
    except OSError:
        return ''
    # Beperk tot wat veilig in een bestandsnaam past.
    return rauw if re.fullmatch(r'[0-9A-Za-z._-]{1,32}', rauw) else ''


class AndroidAppInfoView(APIView):
    """Vertelt of er een APK klaarstaat; nodig om de knop wel of niet te tonen."""

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        pad = _apk_absolute_path()
        if not os.path.isfile(pad):
            return Response({'available': False})
        stat = os.stat(pad)
        return Response({
            'available': True,
            'version': _read_version(),
            'size': stat.st_size,
            'updated_at': timezone.datetime.fromtimestamp(
                stat.st_mtime, tz=timezone.get_current_timezone()
            ).isoformat(),
        })


class AndroidAppDownloadView(APIView):
    """Geeft een kortlevende ondertekende URL terug waarmee de browser de APK ophaalt."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not os.path.isfile(_apk_absolute_path()):
            return Response({'detail': 'Geen Android-app beschikbaar.'}, status=404)
        versie = _read_version()
        naam = f'tms-{versie}.apk' if versie else 'tms-android.apk'
        url = sign_media_path(APK_RELATIVE_PATH, ttl=DOWNLOAD_TTL_SECONDS)
        return Response({
            'url': f'{url}&dl=1&naam={quote(naam)}',
            'version': versie,
        })

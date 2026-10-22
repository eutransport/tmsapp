"""HMAC-based signed URLs for protected media files.

Why: Frontend uses JWT in Authorization header which cannot be attached to
<img>/<iframe>/direct downloads in the browser. Instead, the API hands out
time-limited signed URLs that the browser can load directly.

Public paths (logos, fonts) remain served openly by nginx; everything else
must go through /files/<path>?sig=...&exp=... which validates the HMAC and
streams the file via X-Accel-Redirect (production) or directly (development).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time
from urllib.parse import quote, urlencode

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponseForbidden

# Default signed URL lifetime (24 hours). API responses include fresh URLs on
# every request, so this is a comfortable safety net for browser caching.
DEFAULT_TTL_SECONDS = 24 * 60 * 60

# Paths under MEDIA_ROOT that stay publicly served by nginx (no signing needed).
# Keep this list narrow — only assets used in unauthenticated contexts.
PUBLIC_MEDIA_PREFIXES: tuple[str, ...] = ('branding/', 'fonts/')


def _secret() -> bytes:
    # Reuse SECRET_KEY so no extra env var is required. A dedicated secret
    # could be added later if rotation of signing keys is needed.
    return settings.SECRET_KEY.encode('utf-8')


def _normalize_path(path: str) -> str:
    # Strip leading slash and any /media/ prefix so signatures are stable
    # regardless of where the path came from.
    p = path.lstrip('/')
    if p.startswith('media/'):
        p = p[len('media/'):]
    return p


def _sign(path: str, exp: int) -> str:
    msg = f'{path}|{exp}'.encode('utf-8')
    return hmac.new(_secret(), msg, hashlib.sha256).hexdigest()


def is_public_media(path: str) -> bool:
    p = _normalize_path(path)
    return any(p.startswith(prefix) for prefix in PUBLIC_MEDIA_PREFIXES)


def sign_media_path(path: str, ttl: int = DEFAULT_TTL_SECONDS) -> str:
    """Return a signed URL (relative path) for a protected media file.

    Public media is returned as the regular /media/<path> URL since nginx
    serves those directly.
    """
    p = _normalize_path(path)
    if not p:
        return ''
    if is_public_media(p):
        return f'/media/{p}'
    exp = int(time.time()) + max(60, int(ttl))
    sig = _sign(p, exp)
    query = urlencode({'sig': sig, 'exp': exp})
    # quote path components but keep '/'
    return f'/files/{quote(p, safe="/")}?{query}'


def sign_file_field(file_field, ttl: int = DEFAULT_TTL_SECONDS) -> str | None:
    """Helper: sign a Django FieldFile (e.g. ``invoice.pdf_file``).

    Returns None when the field has no file attached. Always returns the
    relative URL — call ``request.build_absolute_uri`` if you need the full URL.
    """
    if not file_field:
        return None
    name = getattr(file_field, 'name', None)
    if not name:
        return None
    return sign_media_path(name, ttl=ttl)


def verify_signed(path: str, sig: str, exp: str) -> bool:
    if not sig or not exp:
        return False
    try:
        exp_int = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_int < int(time.time()):
        return False
    p = _normalize_path(path)
    expected = _sign(p, exp_int)
    return hmac.compare_digest(expected, sig)


def serve_signed_media(request, path: str):
    """View that validates a signed media URL and streams the file via Django.

    We stream through Django (rather than X-Accel-Redirect) because in
    production the frontend sits behind Nginx Proxy Manager, which is the
    only nginx that sees the backend response — and it has no
    ``/protected-media/`` internal alias. ``FileResponse`` uses sendfile()
    when available, so throughput remains acceptable for typical PDF sizes.
    """
    sig = request.GET.get('sig', '')
    exp = request.GET.get('exp', '')

    if not verify_signed(path, sig, exp):
        return HttpResponseForbidden('Ongeldige of verlopen download-link')

    rel = _normalize_path(path)
    # Defense in depth against path traversal: resolve and make sure the
    # result stays within MEDIA_ROOT.
    media_root = os.path.realpath(str(settings.MEDIA_ROOT))
    resolved = os.path.realpath(os.path.join(media_root, rel))
    if not (resolved == media_root or resolved.startswith(media_root + os.sep)):
        return HttpResponseForbidden('Ongeldig pad')
    if not os.path.isfile(resolved):
        raise Http404('Bestand niet gevonden')

    # ?dl=1 forceert een download in plaats van een voorvertoning.
    als_bijlage = request.GET.get('dl') in ('1', 'true')
    naam = os.path.basename(resolved)
    gevraagd = (request.GET.get('naam') or '').strip()
    if als_bijlage and gevraagd:
        # Alleen de kale bestandsnaam overnemen, nooit een pad.
        naam = os.path.basename(gevraagd.replace('\\', '/'))[:120] or naam

    response = FileResponse(
        open(resolved, 'rb'),
        as_attachment=als_bijlage,
        filename=naam if als_bijlage else None,
    )
    # Allow same-origin iframe embedding so PDFs can be previewed inline.
    response['X-Frame-Options'] = 'SAMEORIGIN'
    return response

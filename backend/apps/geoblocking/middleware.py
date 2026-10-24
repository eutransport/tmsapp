"""
Middleware die geo-regels toepast op binnenkomend verkeer.

Let op twee dingen die makkelijk misgaan:

1. De applicatie gebruikt uitsluitend JWT-authenticatie. Django's
   AuthenticationMiddleware kijkt alleen naar sessies, dus ``request.user`` is
   hier normaal gesproken anoniem. Om regels per rol te kunnen toepassen lezen
   we de token zelf uit.

2. Je kunt jezelf buitensluiten. Daarom zijn er meerdere noodremmen: de
   beheer-API blijft altijd bereikbaar, superusers kunnen worden vrijgesteld,
   en via de omgevingsvariabele GEOBLOCK_BYPASS_IPS houd je altijd een ingang.
"""
import logging

from django.conf import settings
from django.http import HttpResponse, JsonResponse

from apps.core.ip_utils import get_client_ip, parse_ip

logger = logging.getLogger(__name__)

# Paden die nooit geblokkeerd worden.
EXEMPT_PREFIXES = (
    '/api/health/',        # healthcheck van Docker en de loadbalancer
    '/api/geoblocking/',   # beheer-API: noodrem om jezelf weer binnen te laten
    '/static/',
    '/media/branding/',
)

BLOCK_MESSAGE = (
    'Toegang vanaf jouw locatie is geblokkeerd door de beheerder.'
)


class GeoBlockMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self._bypass_networks = self._load_bypass()

    @staticmethod
    def _load_bypass():
        import ipaddress

        raw = getattr(settings, 'GEOBLOCK_BYPASS_IPS', '') or ''
        if isinstance(raw, str):
            parts = [p.strip() for p in raw.split(',') if p.strip()]
        else:
            parts = [str(p).strip() for p in raw if str(p).strip()]
        networks = []
        for part in parts:
            try:
                networks.append(ipaddress.ip_network(part, strict=False))
            except ValueError:
                logger.warning('Ongeldige waarde in GEOBLOCK_BYPASS_IPS: %r', part)
        return networks

    def __call__(self, request):
        if not self._should_check(request):
            return self.get_response(request)

        try:
            decision = self._evaluate(request)
        except Exception as exc:
            # Nooit de applicatie platleggen door een fout in geo-blocking.
            logger.exception('Geo-blocking overgeslagen door fout: %s', exc)
            return self.get_response(request)

        if decision is None:
            return self.get_response(request)

        if decision['allowed']:
            return self.get_response(request)

        return self._blocked_response(request, decision)

    def _should_check(self, request):
        path = request.path or ''
        return not any(path.startswith(prefix) for prefix in EXEMPT_PREFIXES)

    def _evaluate(self, request):
        from .models import GeoBlockSettings
        from .services import evaluate, role_for_user

        try:
            config = GeoBlockSettings.load()
        except Exception as exc:
            # Tabel bestaat nog niet (eerste deploy, vóór migratie).
            logger.warning('Geo-blocking instellingen niet beschikbaar: %s', exc)
            return None

        if not config.enabled:
            return None

        ip = get_client_ip(request)
        request.geo_client_ip = ip

        address = parse_ip(ip)
        if address is not None and any(
            address.version == net.version and address in net for net in self._bypass_networks
        ):
            return None

        user = self._resolve_user(request)
        if (
            config.allow_superuser_bypass
            and user is not None
            and getattr(user, 'is_superuser', False)
        ):
            return None

        role = role_for_user(user)
        result = evaluate(ip, role, config=config)
        request.geo_country = result.get('country', '')

        self._log(request, result, user, ip, role)
        return result

    @staticmethod
    def _resolve_user(request):
        """Haal de gebruiker uit de JWT-token, of uit de sessie als die er is."""
        session_user = getattr(request, 'user', None)
        if session_user is not None and getattr(session_user, 'is_authenticated', False):
            return session_user

        header = request.META.get('HTTP_AUTHORIZATION', '')
        if not header:
            return None
        try:
            from rest_framework_simplejwt.authentication import JWTAuthentication

            result = JWTAuthentication().authenticate(request)
        except Exception:
            # Ongeldige, verlopen of onleesbare token: behandel als anoniem.
            return None
        if not result:
            return None
        return result[0]

    @staticmethod
    def _log(request, result, user, ip, role):
        from .models import GeoAccessLog, GeoBlockSettings, LogDecision

        config = GeoBlockSettings.load()
        if result['allowed'] and not result['would_block'] and not config.log_allowed:
            return

        if result['would_block']:
            decision = LogDecision.WOULD_BLOCK
        elif result['allowed']:
            decision = LogDecision.ALLOWED
        else:
            decision = LogDecision.BLOCKED

        try:
            GeoAccessLog.objects.create(
                ip_address=ip or None,
                country_code=result.get('country', '') or '',
                role=role or '',
                user=user if user is not None and getattr(user, 'pk', None) else None,
                path=(request.path or '')[:255],
                method=(request.method or '')[:10],
                decision=decision,
                reason=(result.get('reason') or '')[:200],
                user_agent=request.META.get('HTTP_USER_AGENT', '')[:255],
            )
        except Exception as exc:
            logger.warning('Kon geo-logregel niet wegschrijven: %s', exc)

    @staticmethod
    def _blocked_response(request, decision):
        country = decision.get('country') or 'onbekend'
        if request.path.startswith('/api/'):
            return JsonResponse(
                {
                    'detail': BLOCK_MESSAGE,
                    'code': 'geo_blocked',
                    'country': country,
                },
                status=403,
            )
        return HttpResponse(
            f'<!doctype html><html lang="nl"><meta charset="utf-8">'
            f'<title>Toegang geblokkeerd</title>'
            f'<body style="font-family:system-ui;padding:3rem;max-width:34rem;margin:auto">'
            f'<h1>Toegang geblokkeerd</h1><p>{BLOCK_MESSAGE}</p>'
            f'<p style="color:#666;font-size:.9rem">Land: {country}</p></body></html>',
            status=403,
            content_type='text/html; charset=utf-8',
        )

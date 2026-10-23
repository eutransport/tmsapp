"""
Custom middleware for TMS application.
"""
from django.utils import timezone
from django.core.cache import cache
from django.http import JsonResponse


class LastActivityMiddleware:
    """
    Update user's last_activity timestamp on each authenticated request.
    Throttled to max once per 60 seconds per user via cache to avoid DB spam.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        if hasattr(request, 'user') and request.user.is_authenticated:
            cache_key = f'last_activity_{request.user.pk}'
            if not cache.get(cache_key):
                try:
                    from apps.accounts.models import User
                    User.objects.filter(pk=request.user.pk).update(
                        last_activity=timezone.now()
                    )
                    cache.set(cache_key, True, 60)  # Throttle: 1 update per 60s
                except Exception:
                    pass

        return response


class MediaXFrameOptionsMiddleware:
    """
    Middleware that sets X-Frame-Options to SAMEORIGIN for media files.
    This allows PDFs and images to be embedded in iframes from the same origin
    while still preventing embedding from external sites.
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        response = self.get_response(request)
        
        # Set SAMEORIGIN for media files to allow same-origin embedding
        if request.path.startswith('/media/'):
            response['X-Frame-Options'] = 'SAMEORIGIN'
            # Prevent MIME sniffing of uploaded files
            response['X-Content-Type-Options'] = 'nosniff'
        
        return response


# Paden die een opdrachtgever wel mag benaderen. Alles daarbuiten is verboden.
OPDRACHTGEVER_TOEGESTANE_PADEN = (
    '/api/auth/',
    '/api/portaal/',
    '/api/core/settings/',
    '/api/core/fonts/css/',
    '/api/core/app/android/',
    '/api/licensing/',
    # Alleen het aan- en afmelden voor pushberichten; beheer blijft dicht.
    '/api/notifications/config/',
    '/api/notifications/subscriptions/',
    '/files/',
    '/media/',
)


class OpdrachtgeverScopeMiddleware:
    """
    Sluit het hele interne systeem af voor de rol opdrachtgever.

    De bestaande views gaan er allemaal van uit dat elke ingelogde gebruiker
    intern is; een flink deel vraagt alleen om IsAuthenticated. In plaats van
    ruim honderd views aan te passen weigeren we hier alles wat niet expliciet
    bij het portaal hoort. De rol wordt uit het JWT gehaald, want DRF heeft de
    gebruiker op dit punt nog niet bepaald.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._is_opdrachtgever(request) and not request.path.startswith(
            OPDRACHTGEVER_TOEGESTANE_PADEN
        ):
            return JsonResponse(
                {'detail': 'Geen toegang tot dit onderdeel.'}, status=403
            )
        return self.get_response(request)

    def _is_opdrachtgever(self, request) -> bool:
        gebruiker_id = self._gebruiker_uit_token(request)
        if not gebruiker_id:
            return False

        cache_key = f'rol_{gebruiker_id}'
        rol = cache.get(cache_key)
        if rol is None:
            from apps.accounts.models import User
            rol = User.objects.filter(pk=gebruiker_id).values_list(
                'rol', flat=True
            ).first() or ''
            cache.set(cache_key, rol, 300)
        return rol == 'opdrachtgever'

    @staticmethod
    def _gebruiker_uit_token(request):
        header = request.META.get('HTTP_AUTHORIZATION', '')
        if not header.startswith('Bearer '):
            return None
        try:
            from rest_framework_simplejwt.tokens import AccessToken
            return AccessToken(header[7:]).get('user_id')
        except Exception:
            return None

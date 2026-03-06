"""
Custom middleware for TMS application.
"""
from django.utils import timezone
from django.core.cache import cache


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

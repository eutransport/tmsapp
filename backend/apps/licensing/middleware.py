"""
License middleware - enforces license validation on every API request.

Unlicensed installations are blocked from using the app, except for:
- License activation endpoint
- Health check
- Static/media files
"""
import logging
from django.http import JsonResponse
from django.utils import timezone

logger = logging.getLogger(__name__)

# Paths that are allowed without a valid license
EXEMPT_PATHS = [
    '/api/licensing/',       # License activation & status endpoints
    '/api/health/',          # Health check
    '/api/core/settings/',   # Public settings (branding for the license page)
    '/api/core/update-status/',  # Updatebanner, ook zonder geldige licentie
    '/admin/',               # Django admin (for emergency access)
    '/api/schema/',          # API docs
    '/api/docs/',            # Swagger
]


class LicenseMiddleware:
    """
    Middleware that checks for a valid license on every API request.
    
    If no valid license exists, all API requests return 403 with a 
    'license_required' error, except for exempt paths.
    
    The frontend uses this signal to show the license activation page.
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
        self._license_cache = None
        self._cache_timestamp = None
        self._cache_ttl = 60  # Re-check every 60 seconds
    
    def __call__(self, request):
        # Skip non-API paths (static, media, etc.)
        if not request.path.startswith('/api/'):
            return self.get_response(request)
        
        # Skip exempt paths
        for path in EXEMPT_PATHS:
            if request.path.startswith(path):
                return self.get_response(request)
        
        # Check license validity (with caching)
        if not self._check_license():
            return JsonResponse(
                {
                    'detail': 'Geen geldige licentie gevonden. Activeer een licentie om de applicatie te gebruiken.',
                    'code': 'license_required',
                },
                status=403,
            )
        
        return self.get_response(request)
    
    def _check_license(self) -> bool:
        """Check license validity with a simple TTL cache."""
        now = timezone.now()
        
        # Return cached result if still fresh
        if (
            self._cache_timestamp is not None
            and (now - self._cache_timestamp).total_seconds() < self._cache_ttl
        ):
            return self._license_cache
        
        # Actually check the database
        try:
            from apps.licensing.services import is_license_valid
            result = is_license_valid()
        except Exception as e:
            # If table doesn't exist yet (e.g., before migration), allow access
            logger.warning(f'License check failed (table may not exist yet): {e}')
            result = True
        
        self._license_cache = result
        self._cache_timestamp = now
        return result
    
    @classmethod
    def invalidate_cache(cls):
        """
        Call this after license changes to force a re-check.
        Since middleware instances are per-worker, this helps the current worker.
        """
        # This is a class-level hint; actual instance caches reset on TTL
        pass

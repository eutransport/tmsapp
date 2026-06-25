"""
URL configuration for TMS project.
"""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path, re_path
from django.http import JsonResponse
from django.views.static import serve
from django.views.decorators.clickjacking import xframe_options_exempt
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.file_signing import serve_signed_media, PUBLIC_MEDIA_PREFIXES


def health_check(request):
    """Simple health check endpoint for Docker/monitoring."""
    return JsonResponse({'status': 'healthy', 'service': 'tms-api'})


# Custom media serve view that allows iframe embedding
@xframe_options_exempt
def serve_media(request, path, document_root=None):
    """Serve media files without X-Frame-Options restriction (public paths only)."""
    # In dev we still want only public paths to be openly reachable via /media/.
    if not any(path.startswith(p) for p in PUBLIC_MEDIA_PREFIXES):
        from django.http import HttpResponseForbidden
        return HttpResponseForbidden('Dit bestand is alleen via een ondertekende URL beschikbaar')
    return serve(request, path, document_root=document_root)


urlpatterns = [
    # Health check (for Docker/load balancers)
    path('api/health/', health_check, name='health-check'),
    
    # Admin (only for developers)
    path('admin/', admin.site.urls),
    
    # API Documentation
    path('api/schema/', SpectacularAPIView.as_view(), name='schema'),
    path('api/docs/', SpectacularSwaggerView.as_view(url_name='schema'), name='swagger-ui'),
    
    # API Routes
    path('api/auth/', include('apps.accounts.urls')),
    path('api/core/', include('apps.core.urls')),
    path('api/companies/', include('apps.companies.urls')),
    path('api/drivers/', include('apps.drivers.urls')),
    path('api/fleet/', include('apps.fleet.urls')),
    path('api/time-entries/', include('apps.timetracking.urls')),
    path('api/planning/', include('apps.planning.urls')),
    path('api/invoicing/', include('apps.invoicing.urls')),
    path('api/leave/', include('apps.leave.urls')),
    path('api/notifications/', include('apps.notifications.urls')),
    path('api/documents/', include('apps.documents.urls')),
    path('api/dossiers/', include('apps.dossiers.urls')),
    path('api/spreadsheets/', include('apps.spreadsheets.urls')),
    path('api/maintenance/', include('apps.maintenance.urls')),
    path('api/licensing/', include('apps.licensing.urls')),
    path('api/tracking/', include('apps.tracking.urls')),
    path('api/banking/', include('apps.banking.urls')),
    path('api/reports/', include('apps.reports.urls')),
    path('api/chat/', include('apps.chatbot.urls')),
    path('api/pakmiddelen/', include('apps.pakmiddelen.urls')),
    path('api/tasks/', include('apps.tasks.urls')),

    # Signed media files (HMAC-protected, valid in dev and prod)
    re_path(r'^files/(?P<path>.+)$', serve_signed_media, name='signed-media'),
]

# Serve media files in development
if settings.DEBUG:
    # Public-only fallback: branding/fonts via /media/, everything else 403.
    urlpatterns += [
        re_path(r'^media/(?P<path>.*)$', serve_media, {'document_root': settings.MEDIA_ROOT}),
    ]
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    
    # Debug toolbar (only if installed AND in INSTALLED_APPS)
    if 'debug_toolbar' in settings.INSTALLED_APPS:
        try:
            import debug_toolbar
            urlpatterns = [
                path('__debug__/', include(debug_toolbar.urls)),
            ] + urlpatterns
        except ImportError:
            pass

"""
Core app URL configuration.
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    PublicSettingsView, 
    AdminSettingsViewSet, 
    DashboardStatsView,
    OnlineUsersView,
    RecentLoginsView,
    RecentActivityView,
    ActivityListView,
    ImageUploadView,
    HealthCheckView,
    CustomFontViewSet,
)

# Router for viewsets
router = DefaultRouter()
router.register(r'fonts', CustomFontViewSet, basename='fonts')

urlpatterns = [
    # Health check (no auth required)
    path('health/', HealthCheckView.as_view(), name='health-check'),
    
    # Public settings (no auth required)
    path('settings/', PublicSettingsView.as_view(), name='public-settings'),
    
    # Dashboard stats
    path('dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    
    # Online users (polled every 2 minutes)
    path('dashboard/online-users/', OnlineUsersView.as_view(), name='online-users'),
    
    # Recent logins (paginated)
    path('dashboard/recent-logins/', RecentLoginsView.as_view(), name='recent-logins'),
    
    # Recent activity (dashboard - max 10)
    path('dashboard/activity/', RecentActivityView.as_view(), name='recent-activity'),
    
    # Full activity list (activity page - paginated)
    path('activities/', ActivityListView.as_view(), name='activity-list'),
    
    # Image upload
    path('upload/image/', ImageUploadView.as_view(), name='upload-image'),
    
    # Font management (via router)
    path('', include(router.urls)),
    
    # Admin settings management
    path('admin/settings/', AdminSettingsViewSet.as_view({
        'get': 'list',
        'patch': 'partial_update',
    }), name='admin-settings'),
    path('admin/settings/upload-logo/', AdminSettingsViewSet.as_view({
        'post': 'upload_logo',
    }), name='admin-settings-upload-logo'),
    path('admin/settings/upload-favicon/', AdminSettingsViewSet.as_view({
        'post': 'upload_favicon',
    }), name='admin-settings-upload-favicon'),
    path('admin/settings/delete-logo/', AdminSettingsViewSet.as_view({
        'post': 'delete_logo',
    }), name='admin-settings-delete-logo'),
    path('admin/settings/delete-favicon/', AdminSettingsViewSet.as_view({
        'post': 'delete_favicon',
    }), name='admin-settings-delete-favicon'),
    path('admin/settings/test-email/', AdminSettingsViewSet.as_view({
        'post': 'test_email',
    }), name='admin-settings-test-email'),
]

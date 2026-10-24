from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    GeoAccessLogViewSet,
    GeoBlockSettingsView,
    GeoRuleViewSet,
    GeoStatusView,
    GeoTestView,
    IPRuleViewSet,
)

router = DefaultRouter()
router.register(r'rules', GeoRuleViewSet, basename='geo-rule')
router.register(r'ip-rules', IPRuleViewSet, basename='geo-ip-rule')
router.register(r'logs', GeoAccessLogViewSet, basename='geo-log')

urlpatterns = [
    path('settings/', GeoBlockSettingsView.as_view(), name='geo-settings'),
    path('status/', GeoStatusView.as_view(), name='geo-status'),
    path('test/', GeoTestView.as_view(), name='geo-test'),
    path('', include(router.urls)),
]

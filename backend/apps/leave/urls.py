"""URL patterns for leave management."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    GlobalLeaveSettingsViewSet,
    LeaveBalanceViewSet,
    LeaveRequestViewSet,
    PublicHolidayViewSet,
)

router = DefaultRouter()
router.register(r'settings', GlobalLeaveSettingsViewSet, basename='leave-settings')
router.register(r'balances', LeaveBalanceViewSet, basename='leave-balance')
router.register(r'requests', LeaveRequestViewSet, basename='leave-request')
router.register(r'holidays', PublicHolidayViewSet, basename='public-holiday')

urlpatterns = [
    path('', include(router.urls)),
]

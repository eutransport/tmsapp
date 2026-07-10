from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PrivateTollRegistrationViewSet,
    TollingEventViewSet,
    TollingImportBatchViewSet,
    TollingInvoicingViewSet,
    TollingVehicleViewSet,
)

router = DefaultRouter()
router.register(r'imports', TollingImportBatchViewSet, basename='tolling-imports')
router.register(r'events', TollingEventViewSet, basename='tolling-events')
router.register(r'vehicles', TollingVehicleViewSet, basename='tolling-vehicles')
router.register(r'invoicing', TollingInvoicingViewSet, basename='tolling-invoicing')
router.register(r'private', PrivateTollRegistrationViewSet, basename='tolling-private')

urlpatterns = [
    path('', include(router.urls)),
]

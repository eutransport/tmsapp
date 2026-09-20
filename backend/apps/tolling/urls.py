from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .buiten_uren_views import TollingBuitenUrenViewSet
from .factuur_detail_views import TollingFactuurDetailViewSet
from .sync_views import TollingSyncViewSet
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
router.register(r'sync', TollingSyncViewSet, basename='tolling-sync')
router.register(r'factuur-detail', TollingFactuurDetailViewSet,
                basename='tolling-factuur-detail')
router.register(r'buiten-uren', TollingBuitenUrenViewSet,
                basename='tolling-buiten-uren')
router.register(r'private', PrivateTollRegistrationViewSet, basename='tolling-private')

urlpatterns = [
    path('', include(router.urls)),
]

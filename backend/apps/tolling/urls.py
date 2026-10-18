from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .afrekening_views import TolAfrekeningViewSet
from .backup_views import TolBackupViewSet
from .buiten_uren_views import TollingBuitenUrenViewSet
from .buitenland_views import TolBuitenlandViewSet
from .factuur_detail_views import TollingFactuurDetailViewSet
from .import_voorbeeld_views import TolImportVoorbeeldViewSet
from .koppel_views import TolKoppelingViewSet
from .radius_factuur_views import RadiusFactuurViewSet
from .sync_views import TollingSyncViewSet
from .station_views import TolStationViewSet
from .tarief_views import TariefBronViewSet
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
router.register(r'afrekeningen', TolAfrekeningViewSet, basename='tolling-afrekeningen')
router.register(r'radius-factuur', RadiusFactuurViewSet, basename='tolling-radius-factuur')
router.register(r'backups', TolBackupViewSet, basename='tolling-backups')
router.register(r'import-voorbeeld', TolImportVoorbeeldViewSet,
                basename='tolling-import-voorbeeld')
router.register(r'tariefbronnen', TariefBronViewSet, basename='tolling-tariefbronnen')
router.register(r'stations', TolStationViewSet, basename='tolling-stations')
router.register(r'koppeling', TolKoppelingViewSet, basename='tolling-koppeling')
router.register(r'buitenland', TolBuitenlandViewSet, basename='tolling-buitenland')

urlpatterns = [
    path('', include(router.urls)),
]

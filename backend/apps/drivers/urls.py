from django.urls import path, include
from rest_framework.routers import DefaultRouter, SimpleRouter
from .views import CharterViewSet, DriverCharterPeriodeViewSet, DriverViewSet

# Eigen router vóór de chauffeursrouter: die vangt anders 'charters/' op als id.
# SimpleRouter, want een DefaultRouter zet een API-rootpagina op '' en kaapt
# daarmee de chauffeurslijst op /api/drivers/.
charter_router = SimpleRouter()
charter_router.register(r'charters', CharterViewSet, basename='charters')
charter_router.register(r'charter-periodes', DriverCharterPeriodeViewSet, basename='charter-periodes')

router = DefaultRouter()
router.register(r'', DriverViewSet, basename='drivers')

urlpatterns = [
    path('', include(charter_router.urls)),
    path('', include(router.urls)),
]

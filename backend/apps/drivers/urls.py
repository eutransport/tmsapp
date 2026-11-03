from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CharterViewSet, DriverCharterPeriodeViewSet, DriverViewSet

# Eigen router vóór de chauffeursrouter: die vangt anders 'charters/' op als id.
charter_router = DefaultRouter()
charter_router.register(r'charters', CharterViewSet, basename='charters')
charter_router.register(r'charter-periodes', DriverCharterPeriodeViewSet, basename='charter-periodes')

router = DefaultRouter()
router.register(r'', DriverViewSet, basename='drivers')

urlpatterns = [
    path('', include(charter_router.urls)),
    path('', include(router.urls)),
]

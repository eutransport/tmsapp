from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .portaal_views import (
    PortaalDashboardView,
    PortaalPositiesView,
    PortaalRittenView,
    PortaalTolView,
    PortaalUrenView,
    PortaalVoertuigDagView,
    PortaalVoertuigenView,
)
from .views import PortaalKlantViewSet, PortaalOpdrachtViewSet

router = DefaultRouter()
router.register('opdrachten', PortaalOpdrachtViewSet, basename='portaal-opdracht')
router.register('klanten', PortaalKlantViewSet, basename='portaal-klant')

urlpatterns = [
    path('dashboard/', PortaalDashboardView.as_view(), name='portaal-dashboard'),
    path('voertuigen/', PortaalVoertuigenView.as_view(), name='portaal-voertuigen'),
    path('voertuigen/<str:kenteken>/dag/', PortaalVoertuigDagView.as_view(), name='portaal-voertuig-dag'),
    path('posities/', PortaalPositiesView.as_view(), name='portaal-posities'),
    path('ritten/', PortaalRittenView.as_view(), name='portaal-ritten'),
    path('uren/', PortaalUrenView.as_view(), name='portaal-uren'),
    path('tol/', PortaalTolView.as_view(), name='portaal-tol'),
    path('', include(router.urls)),
]

from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.invoicing.portaal_views import (
    PortaalFacturenView,
    PortaalFactuurPdfView,
    PortaalFactuurSamenvattingView,
    PortaalFactuurTolView,
)

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
    path('facturen/', PortaalFacturenView.as_view(), name='portaal-facturen'),
    path('facturen/samenvatting/', PortaalFactuurSamenvattingView.as_view(), name='portaal-facturen-samenvatting'),
    path('facturen/<uuid:factuur_id>/pdf/', PortaalFactuurPdfView.as_view(), name='portaal-factuur-pdf'),
    path('facturen/<uuid:factuur_id>/tol/', PortaalFactuurTolView.as_view(), name='portaal-factuur-tol'),
    path('', include(router.urls)),
]

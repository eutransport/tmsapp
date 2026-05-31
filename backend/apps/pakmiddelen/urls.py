from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    PakmiddelenCheckResultViewSet,
    PakmiddelenConfigViewSet,
    PakmiddelenRitnummerSelectionViewSet,
)

router = DefaultRouter()
router.register('config', PakmiddelenConfigViewSet, basename='pakmiddelen-config')
router.register('ritnummers', PakmiddelenRitnummerSelectionViewSet, basename='pakmiddelen-ritnummers')
router.register('results', PakmiddelenCheckResultViewSet, basename='pakmiddelen-results')

urlpatterns = [
    path('', include(router.urls)),
]

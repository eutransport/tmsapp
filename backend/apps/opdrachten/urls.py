from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .chauffeur_views import MijnOpdrachtenViewSet
from .views import BeheerOpdrachtViewSet

router = DefaultRouter()
router.register('opdrachten', BeheerOpdrachtViewSet, basename='beheer-opdracht')
router.register('mijn', MijnOpdrachtenViewSet, basename='mijn-opdracht')

urlpatterns = [
    path('', include(router.urls)),
]

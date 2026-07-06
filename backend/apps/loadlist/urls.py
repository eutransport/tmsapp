from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import DepotViewSet, LoadListViewSet

router = DefaultRouter()
router.register('lists', LoadListViewSet, basename='loadlist')
router.register('depots', DepotViewSet, basename='depot')

urlpatterns = router.urls

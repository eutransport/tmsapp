from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import LoadListViewSet

router = DefaultRouter()
router.register('lists', LoadListViewSet, basename='loadlist')

urlpatterns = router.urls

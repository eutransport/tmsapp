from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import TimeEntryViewSet, ImportBatchViewSet

router = DefaultRouter()
router.register(r'', TimeEntryViewSet, basename='time-entries')

import_router = DefaultRouter()
import_router.register(r'', ImportBatchViewSet, basename='import-batches')

urlpatterns = [
    path('imports/', include(import_router.urls)),
    path('', include(router.urls)),
]

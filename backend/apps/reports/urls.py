"""URL patterns for the reports agent."""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import ReportRequestViewSet

router = DefaultRouter()
router.register(r'requests', ReportRequestViewSet, basename='report-request')

urlpatterns = [
    path('', include(router.urls)),
]

from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import VehicleRitnummerViewSet, VehicleViewSet

router = DefaultRouter()
router.register(r'', VehicleViewSet, basename='fleet')

# Eigen router, want de vlootrouter staat op het lege pad en zou
# 'ritnummer-periodes' anders als kenteken-id opvatten.
periode_router = DefaultRouter()
periode_router.register(r'', VehicleRitnummerViewSet, basename='fleet-ritnummer-periode')

urlpatterns = [
    # Deze route moet voor de vlootrouter staan.
    path('ritnummer-periodes/', include(periode_router.urls)),
    path('', include(router.urls)),
]

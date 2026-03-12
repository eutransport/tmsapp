import logging
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from apps.core.permissions import IsAdminOrManager
from .models import Driver
from .serializers import DriverSerializer

logger = logging.getLogger('accounts.security')


class DriverViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Driver CRUD operations.
    - Admin/Gebruiker: Full CRUD access
    - Chauffeur: Read-only access
    """
    queryset = Driver.objects.select_related('bedrijf', 'gekoppelde_gebruiker', 'voertuig').all()
    serializer_class = DriverSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    search_fields = ['naam', 'telefoon']
    filterset_fields = ['bedrijf', 'adr']
    ordering_fields = ['naam', 'created_at']
    ordering = ['naam']
    
    def perform_create(self, serializer):
        driver = serializer.save()
        logger.info(
            f"Driver created: {driver.naam} (ID: {driver.id}) by {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        driver = serializer.save()
        logger.info(
            f"Driver updated: {driver.naam} (ID: {driver.id}) by {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        logger.warning(
            f"Driver deleted: {instance.naam} (ID: {instance.id}) by {self.request.user.email}"
        )
        instance.delete()

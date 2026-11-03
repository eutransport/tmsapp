import logging
from django.db.models import ProtectedError
from rest_framework import mixins, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from apps.core.permissions import IsAdminOrManager, HasModulePermission, IsAdminOnly
from .models import Charter, Driver, DriverCharterPeriode
from .serializers import CharterSerializer, DriverCharterPeriodeSerializer, DriverSerializer

logger = logging.getLogger('accounts.security')


class DriverViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Driver CRUD operations.
    - Admin/Gebruiker: Full CRUD access
    - Chauffeur: Read-only access
    """
    queryset = Driver.objects.select_related('bedrijf', 'gekoppelde_gebruiker', 'voertuig', 'charter').all()
    serializer_class = DriverSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_drivers'
    search_fields = ['naam', 'telefoon']
    filterset_fields = ['bedrijf', 'charter', 'adr', 'auto_uren']
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



class CharterViewSet(viewsets.ModelViewSet):
    """Beheer van charters. Alleen admins: dit bepaalt wat een externe partij ziet."""
    queryset = Charter.objects.prefetch_related('voertuigen').all()
    serializer_class = CharterSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    search_fields = ['naam', 'kvk', 'contactpersoon']
    ordering = ['naam']
    pagination_class = None

    def perform_destroy(self, instance):
        try:
            instance.delete()
        except ProtectedError:
            raise ValidationError(
                'Deze charter heeft nog chauffeurs of gebruikers. Ontkoppel die eerst.'
            )
        logger.warning(
            f"Charter deleted: {instance.naam} (ID: {instance.id}) by {self.request.user.email}"
        )


class DriverCharterPeriodeViewSet(mixins.ListModelMixin,
                                  mixins.RetrieveModelMixin,
                                  mixins.UpdateModelMixin,
                                  mixins.DestroyModelMixin,
                                  viewsets.GenericViewSet):
    """Periodes per chauffeur bij een charter; alleen de datums zijn aan te passen."""
    queryset = DriverCharterPeriode.objects.select_related('driver', 'charter').all()
    serializer_class = DriverCharterPeriodeSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    filterset_fields = ['charter', 'driver']
    pagination_class = None

    def perform_update(self, serializer):
        periode = serializer.save()
        logger.info(
            f"Charter period updated: {periode} by {self.request.user.email}"
        )

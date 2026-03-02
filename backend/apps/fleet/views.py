import logging
from datetime import date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Count, Q
from apps.core.permissions import IsAdminOrManager
from .models import Vehicle
from .serializers import VehicleSerializer

logger = logging.getLogger('accounts.security')


class VehicleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Vehicle/Fleet CRUD operations.
    - Admin/Gebruiker: Full CRUD access
    - Chauffeur: Read-only access
    """
    queryset = Vehicle.objects.select_related('bedrijf').all()
    serializer_class = VehicleSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    search_fields = ['kenteken', 'ritnummer', 'type_wagen']
    filterset_fields = ['bedrijf', 'type_wagen']
    ordering_fields = ['kenteken', 'type_wagen', 'created_at']
    ordering = ['kenteken']
    
    def perform_create(self, serializer):
        vehicle = serializer.save()
        logger.info(
            f"Vehicle created: {vehicle.kenteken} (ID: {vehicle.id}) by {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        vehicle = serializer.save()
        logger.info(
            f"Vehicle updated: {vehicle.kenteken} (ID: {vehicle.id}) by {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        logger.warning(
            f"Vehicle deleted: {instance.kenteken} (ID: {instance.id}) by {self.request.user.email}"
        )
        instance.delete()

    @action(detail=False, methods=['get'], url_path='vehicle_weeks_overview')
    def vehicle_weeks_overview(self, request):
        """
        Overview of worked weeks per vehicle vs minimum weeks.
        Only vehicles with minimum_weken_per_jaar set are included.
        """
        from apps.timetracking.models import TimeEntry, TimeEntryStatus
        
        jaar = int(request.query_params.get('jaar', date.today().year))
        
        # Get vehicles that have minimum weeks configured
        vehicles = Vehicle.objects.select_related('bedrijf').filter(
            minimum_weken_per_jaar__isnull=False
        ).order_by('kenteken')
        
        results = []
        for vehicle in vehicles:
            # Count distinct weeks where this vehicle's kenteken has time entries
            worked_weeks = TimeEntry.objects.filter(
                kenteken__iexact=vehicle.kenteken,
                datum__year=jaar,
                status=TimeEntryStatus.INGEDIEND,
            ).values('weeknummer').distinct().count()
            
            minimum = vehicle.minimum_weken_per_jaar
            gemist = max(0, minimum - worked_weeks)
            percentage = round((worked_weeks / minimum) * 100, 1) if minimum > 0 else 100
            
            results.append({
                'vehicle_id': str(vehicle.id),
                'kenteken': vehicle.kenteken,
                'type_wagen': vehicle.type_wagen,
                'ritnummer': vehicle.ritnummer,
                'bedrijf_naam': vehicle.bedrijf.naam if vehicle.bedrijf else '',
                'minimum_weken': minimum,
                'gewerkte_weken': worked_weeks,
                'gemiste_weken': gemist,
                'percentage': min(percentage, 100),
            })
        
        return Response(results)

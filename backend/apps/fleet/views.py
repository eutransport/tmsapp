import logging
from datetime import date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.db.models import Count, Q
from apps.core.permissions import FleetPermission
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
    permission_classes = [IsAuthenticated, FleetPermission]
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

    @action(detail=False, methods=['get'], url_path='dropdown')
    def dropdown(self, request):
        """
        Lightweight vehicle list for dropdowns.
        Accessible by all authenticated users (including chauffeurs)
        so they can select a vehicle when registering hours.
        """
        vehicles = Vehicle.objects.filter(actief=True).select_related('bedrijf').order_by('kenteken')
        serializer = self.get_serializer(vehicles, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='vehicle_weeks_overview')
    def vehicle_weeks_overview(self, request):
        """
        Overview of worked days per vehicle vs minimum days.
        Minimum days = minimum_weken_per_jaar * 5 (working days per week).
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
            # Count distinct days where this vehicle's kenteken has time entries
            worked_days = TimeEntry.objects.filter(
                kenteken__iexact=vehicle.kenteken,
                datum__year=jaar,
                status=TimeEntryStatus.INGEDIEND,
            ).values('datum').distinct().count()
            
            minimum_weken = vehicle.minimum_weken_per_jaar
            minimum_dagen = minimum_weken * 5
            gemiste_dagen = max(0, minimum_dagen - worked_days)
            gewerkte_weken_decimal = round(worked_days / 5, 1)
            percentage = round((worked_days / minimum_dagen) * 100, 1) if minimum_dagen > 0 else 100
            
            results.append({
                'vehicle_id': str(vehicle.id),
                'kenteken': vehicle.kenteken,
                'type_wagen': vehicle.type_wagen,
                'ritnummer': vehicle.ritnummer,
                'bedrijf_naam': vehicle.bedrijf.naam if vehicle.bedrijf else '',
                'minimum_weken': minimum_weken,
                'minimum_dagen': minimum_dagen,
                'gewerkte_dagen': worked_days,
                'gemiste_dagen': gemiste_dagen,
                'gewerkte_weken_decimal': gewerkte_weken_decimal,
                'percentage': min(percentage, 100),
            })
        
        return Response(results)

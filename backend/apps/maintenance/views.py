"""
Fleet Maintenance Management Views

Uitgebreide API endpoints voor vloot onderhoudsbeheer.
"""
import logging
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Sum, Count, Avg, Q, F, Value, CharField
from django.db.models.functions import TruncMonth, Coalesce
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdminOrManager, IsAdminOnly, HasModulePermission

from .models import (
    MaintenanceCategory,
    MaintenanceType,
    VehicleMaintenanceProfile,
    APKRecord,
    ADRRecord,
    ADRSettings,
    MaintenanceTask,
    MaintenancePart,
    TireRecord,
    MaintenanceThreshold,
    MaintenanceAlert,
    MaintenanceDashboard,
    DashboardWidget,
    MaintenanceQuery,
    OBDDevice,
    OBDReading,
    MaintenanceStatus,
)
from .serializers import (
    MaintenanceCategorySerializer,
    MaintenanceTypeSerializer,
    MaintenanceTypeListSerializer,
    VehicleMaintenanceProfileSerializer,
    APKRecordSerializer,
    APKCountdownSerializer,
    ADRRecordSerializer,
    ADRSettingsSerializer,
    MaintenanceTaskSerializer,
    MaintenanceTaskCreateSerializer,
    MaintenanceTaskListSerializer,
    MaintenancePartSerializer,
    TireRecordSerializer,
    MaintenanceThresholdSerializer,
    MaintenanceAlertSerializer,
    MaintenanceDashboardSerializer,
    MaintenanceDashboardListSerializer,
    DashboardWidgetSerializer,
    MaintenanceQuerySerializer,
    OBDDeviceSerializer,
    OBDReadingSerializer,
    OBDReadingSummarySerializer,
    VehicleCostSummarySerializer,
    CostByTypeSerializer,
    FleetHealthSerializer,
    MaintenanceStatsSerializer,
)

logger = logging.getLogger('accounts.security')


# =============================================================================
# CATEGORIEËN & TYPES
# =============================================================================

class MaintenanceCategoryViewSet(viewsets.ModelViewSet):
    """CRUD voor onderhoudscategorieën."""
    queryset = MaintenanceCategory.objects.all()
    serializer_class = MaintenanceCategorySerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    search_fields = ['name', 'name_en', 'description']
    ordering_fields = ['name', 'sort_order', 'created_at']
    ordering = ['sort_order', 'name']

    def perform_create(self, serializer):
        category = serializer.save()
        logger.info(f"Maintenance category created: {category.name} by {self.request.user.email}")

    def perform_destroy(self, instance):
        logger.warning(f"Maintenance category deleted: {instance.name} by {self.request.user.email}")
        instance.delete()


class MaintenanceTypeViewSet(viewsets.ModelViewSet):
    """CRUD voor onderhoudstypes."""
    queryset = MaintenanceType.objects.select_related('category').all()
    serializer_class = MaintenanceTypeSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    search_fields = ['name', 'name_en', 'description']
    filterset_fields = ['category', 'vehicle_type', 'is_mandatory', 'is_active']
    ordering_fields = ['name', 'sort_order', 'created_at']
    ordering = ['category__sort_order', 'sort_order', 'name']

    def get_serializer_class(self):
        if self.action == 'list' and self.request.query_params.get('compact'):
            return MaintenanceTypeListSerializer
        return MaintenanceTypeSerializer

    @action(detail=False, methods=['get'])
    def choices(self, request):
        """Geeft alle actieve types terug voor dropdowns."""
        types = MaintenanceType.objects.filter(is_active=True).select_related('category')
        serializer = MaintenanceTypeListSerializer(types, many=True)
        return Response(serializer.data)

    def perform_create(self, serializer):
        mt = serializer.save()
        logger.info(f"Maintenance type created: {mt.name} by {self.request.user.email}")


# =============================================================================
# VOERTUIG ONDERHOUDSPROFIEL
# =============================================================================

class VehicleMaintenanceProfileViewSet(viewsets.ModelViewSet):
    """Onderhoudsprofielen per voertuig."""
    queryset = VehicleMaintenanceProfile.objects.select_related(
        'vehicle', 'vehicle__bedrijf', 'maintenance_type', 'maintenance_type__category'
    ).all()
    serializer_class = VehicleMaintenanceProfileSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    filterset_fields = ['vehicle', 'maintenance_type', 'is_active']
    ordering_fields = ['next_due_date', 'vehicle__kenteken']
    ordering = ['next_due_date']

    @action(detail=False, methods=['get'], url_path='vehicle/(?P<vehicle_id>[^/.]+)')
    def by_vehicle(self, request, vehicle_id=None):
        """Alle profielen voor een specifiek voertuig."""
        profiles = self.queryset.filter(vehicle_id=vehicle_id, is_active=True)
        serializer = self.get_serializer(profiles, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def mark_completed(self, request, pk=None):
        """Markeer onderhoud als uitgevoerd en herbereken volgende datum."""
        profile = self.get_object()
        performed_date = request.data.get('performed_date', str(date.today()))
        performed_km = request.data.get('performed_km')

        profile.calculate_next_due(
            performed_date=date.fromisoformat(performed_date),
            performed_km=int(performed_km) if performed_km else None
        )
        profile.save()

        logger.info(
            f"Maintenance profile completed: {profile.vehicle.kenteken} - "
            f"{profile.maintenance_type.name} by {request.user.email}"
        )
        serializer = self.get_serializer(profile)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def upcoming(self, request):
        """Aankomende onderhouden (volgende 30 dagen)."""
        days = int(request.query_params.get('days', 30))
        cutoff = date.today() + timedelta(days=days)
        profiles = self.queryset.filter(
            is_active=True,
            next_due_date__isnull=False,
            next_due_date__lte=cutoff
        ).order_by('next_due_date')
        serializer = self.get_serializer(profiles, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def overdue(self, request):
        """Alle achterstallige onderhouden."""
        profiles = self.queryset.filter(
            is_active=True,
            next_due_date__isnull=False,
            next_due_date__lt=date.today()
        ).order_by('next_due_date')
        serializer = self.get_serializer(profiles, many=True)
        return Response(serializer.data)


# =============================================================================
# APK
# =============================================================================

class APKRecordViewSet(viewsets.ModelViewSet):
    """CRUD voor APK records met countdown functionaliteit."""
    queryset = APKRecord.objects.select_related(
        'vehicle', 'vehicle__bedrijf', 'created_by'
    ).all()
    serializer_class = APKRecordSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    filterset_fields = ['vehicle', 'status', 'is_current', 'passed']
    search_fields = ['vehicle__kenteken', 'inspection_station']
    ordering_fields = ['expiry_date', 'inspection_date', 'created_at']
    ordering = ['-inspection_date']

    def perform_create(self, serializer):
        apk = serializer.save(created_by=self.request.user)
        logger.info(
            f"APK record created: {apk.vehicle.kenteken} expiry {apk.expiry_date} "
            f"by {self.request.user.email}"
        )

    @action(detail=False, methods=['get'])
    def countdown(self, request):
        """APK countdown voor alle voertuigen met huidige APK."""
        records = APKRecord.objects.filter(
            is_current=True
        ).select_related('vehicle', 'vehicle__bedrijf').order_by('expiry_date')
        serializer = APKCountdownSerializer(records, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def expiring_soon(self, request):
        """APK's die binnen X dagen verlopen."""
        days = int(request.query_params.get('days', 30))
        cutoff = date.today() + timedelta(days=days)
        records = APKRecord.objects.filter(
            is_current=True,
            expiry_date__lte=cutoff
        ).select_related('vehicle', 'vehicle__bedrijf').order_by('expiry_date')
        serializer = APKCountdownSerializer(records, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def renew(self, request, pk=None):
        """
        APK vernieuwen: maak een nieuw APK record aan met de opgegeven nieuwe data.
        De oude wordt automatisch op is_current=False gezet.
        """
        old_apk = self.get_object()
        new_data = {
            'vehicle': old_apk.vehicle.id,
            'inspection_date': request.data.get('inspection_date', str(date.today())),
            'expiry_date': request.data.get('expiry_date'),
            'passed': request.data.get('passed', True),
            'inspection_station': request.data.get('inspection_station', old_apk.inspection_station),
            'mileage_at_inspection': request.data.get('mileage_at_inspection'),
            'cost': request.data.get('cost', '0.00'),
            'remarks': request.data.get('remarks', ''),
            'is_current': True,
        }

        if not new_data.get('expiry_date'):
            return Response(
                {'error': 'expiry_date is verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = APKRecordSerializer(data=new_data)
        if serializer.is_valid():
            apk = serializer.save(created_by=request.user)
            logger.info(
                f"APK renewed: {apk.vehicle.kenteken} new expiry {apk.expiry_date} "
                f"by {request.user.email}"
            )
            return Response(APKRecordSerializer(apk).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['get'])
    def history(self, request):
        """APK historie per voertuig."""
        vehicle_id = request.query_params.get('vehicle')
        if not vehicle_id:
            return Response(
                {'error': 'vehicle parameter is verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )
        records = APKRecord.objects.filter(
            vehicle_id=vehicle_id
        ).select_related('vehicle', 'created_by').order_by('-inspection_date')
        serializer = APKRecordSerializer(records, many=True)
        return Response(serializer.data)


# =============================================================================
# ADR
# =============================================================================

class ADRRecordViewSet(viewsets.ModelViewSet):
    """CRUD voor ADR-controles met countdown tot de volgende controle."""
    queryset = ADRRecord.objects.select_related(
        'vehicle', 'vehicle__bedrijf', 'created_by'
    ).prefetch_related('notify_users').all()
    serializer_class = ADRRecordSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    filterset_fields = ['vehicle', 'has_adr', 'case_sealed']
    search_fields = ['vehicle__kenteken', 'route', 'remarks']
    ordering_fields = ['next_inspection_date', 'inspection_date', 'created_at']
    ordering = ['next_inspection_date']

    def perform_create(self, serializer):
        record = serializer.save(created_by=self.request.user)
        logger.info(
            f"ADR record created: {record.vehicle.kenteken} next check "
            f"{record.next_inspection_date} by {self.request.user.email}"
        )

    @action(detail=False, methods=['get'])
    def expiring_soon(self, request):
        """ADR-controles die binnen X dagen moeten gebeuren (of al te laat zijn)."""
        days = int(request.query_params.get('days', 14))
        cutoff = date.today() + timedelta(days=days)
        records = self.get_queryset().filter(next_inspection_date__lte=cutoff)
        serializer = self.get_serializer(records, many=True)
        return Response(serializer.data)


class ADRSettingsView(APIView):
    """Instellingen voor de ADR-herinneringen: lezen door beheerders/managers,
    wijzigen alleen door admins."""
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'

    def get_permissions(self):
        if self.request.method in ('PUT', 'PATCH'):
            return [IsAuthenticated(), IsAdminOnly()]
        return super().get_permissions()

    def get(self, request):
        instellingen = ADRSettings.get_settings()
        return Response(ADRSettingsSerializer(instellingen, context={'request': request}).data)

    def put(self, request):
        return self._update(request)

    def patch(self, request):
        return self._update(request, partial=True)

    def _update(self, request, partial=False):
        instellingen = ADRSettings.get_settings()
        serializer = ADRSettingsSerializer(
            instellingen, data=request.data, partial=partial, context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        logger.info(f"ADR settings updated by {request.user.email}")
        return Response(serializer.data)


# =============================================================================
# ONDERHOUDSTAKEN
# =============================================================================

class MaintenanceTaskViewSet(viewsets.ModelViewSet):
    """CRUD voor onderhoudstaken / werkorders."""
    queryset = MaintenanceTask.objects.select_related(
        'vehicle', 'vehicle__bedrijf', 'maintenance_type',
        'maintenance_type__category', 'assigned_to', 'created_by', 'completed_by'
    ).prefetch_related('parts').all()
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    search_fields = ['title', 'description', 'vehicle__kenteken', 'service_provider', 'invoice_number']
    filterset_fields = ['vehicle', 'maintenance_type', 'status', 'priority']
    ordering_fields = ['scheduled_date', 'completed_date', 'total_cost', 'created_at', 'priority']
    ordering = ['-scheduled_date']

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return MaintenanceTaskCreateSerializer
        if self.action == 'list':
            compact = self.request.query_params.get('compact')
            if compact:
                return MaintenanceTaskListSerializer
        return MaintenanceTaskSerializer

    def perform_create(self, serializer):
        task = serializer.save(created_by=self.request.user)
        logger.info(
            f"Maintenance task created: {task.title} for {task.vehicle.kenteken} "
            f"by {self.request.user.email}"
        )

    def perform_update(self, serializer):
        task = serializer.save()
        logger.info(
            f"Maintenance task updated: {task.title} for {task.vehicle.kenteken} "
            f"by {self.request.user.email}"
        )

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """Markeer een taak als afgerond."""
        task = self.get_object()
        task.status = MaintenanceStatus.COMPLETED
        task.completed_date = request.data.get('completed_date', date.today())
        task.completed_by = request.user
        task.mileage_at_service = request.data.get('mileage_at_service', task.mileage_at_service)
        task.work_performed = request.data.get('work_performed', task.work_performed)
        task.labor_cost = Decimal(request.data.get('labor_cost', str(task.labor_cost)))
        task.parts_cost = Decimal(request.data.get('parts_cost', str(task.parts_cost)))
        task.save()

        # Update het bijbehorende onderhoudsprofiel
        profiles = VehicleMaintenanceProfile.objects.filter(
            vehicle=task.vehicle,
            maintenance_type=task.maintenance_type,
            is_active=True
        )
        for profile in profiles:
            profile.calculate_next_due(
                performed_date=task.completed_date,
                performed_km=task.mileage_at_service
            )
            profile.save()

        logger.info(
            f"Maintenance task completed: {task.title} for {task.vehicle.kenteken} "
            f"by {request.user.email}"
        )
        serializer = MaintenanceTaskSerializer(task)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        """Annuleer een onderhoudstaak."""
        task = self.get_object()
        task.status = MaintenanceStatus.CANCELLED
        task.save()
        logger.info(
            f"Maintenance task cancelled: {task.title} by {request.user.email}"
        )
        serializer = MaintenanceTaskSerializer(task)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def upcoming(self, request):
        """Aankomende taken."""
        days = int(request.query_params.get('days', 30))
        cutoff = date.today() + timedelta(days=days)
        tasks = self.queryset.filter(
            status=MaintenanceStatus.SCHEDULED,
            scheduled_date__lte=cutoff,
            scheduled_date__gte=date.today()
        ).order_by('scheduled_date')

        page = self.paginate_queryset(tasks)
        if page is not None:
            serializer = MaintenanceTaskListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = MaintenanceTaskListSerializer(tasks, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def overdue(self, request):
        """Te late taken."""
        tasks = self.queryset.filter(
            status__in=[MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS],
            scheduled_date__lt=date.today()
        ).order_by('scheduled_date')

        page = self.paginate_queryset(tasks)
        if page is not None:
            serializer = MaintenanceTaskListSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = MaintenanceTaskListSerializer(tasks, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'], url_path='vehicle/(?P<vehicle_id>[^/.]+)')
    def by_vehicle(self, request, vehicle_id=None):
        """Alle taken voor een specifiek voertuig."""
        tasks = self.queryset.filter(vehicle_id=vehicle_id)

        status_filter = request.query_params.get('status')
        if status_filter:
            tasks = tasks.filter(status=status_filter)

        page = self.paginate_queryset(tasks)
        if page is not None:
            serializer = MaintenanceTaskSerializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = MaintenanceTaskSerializer(tasks, many=True)
        return Response(serializer.data)


# =============================================================================
# ONDERDELEN
# =============================================================================

class MaintenancePartViewSet(viewsets.ModelViewSet):
    """CRUD voor onderdelen bij een onderhoudstaak."""
    queryset = MaintenancePart.objects.select_related('task', 'task__vehicle').all()
    serializer_class = MaintenancePartSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    filterset_fields = ['task']
    ordering = ['name']

    def perform_create(self, serializer):
        part = serializer.save()
        # Update parts_cost op de taak
        task = part.task
        total_parts = task.parts.aggregate(total=Sum('total_price'))['total'] or Decimal('0.00')
        task.parts_cost = total_parts
        task.save()

    def perform_destroy(self, instance):
        task = instance.task
        instance.delete()
        # Update parts_cost op de taak
        total_parts = task.parts.aggregate(total=Sum('total_price'))['total'] or Decimal('0.00')
        task.parts_cost = total_parts
        task.save()


# =============================================================================
# BANDEN
# =============================================================================

class TireRecordViewSet(viewsets.ModelViewSet):
    """CRUD voor bandenregistratie."""
    queryset = TireRecord.objects.select_related('vehicle', 'vehicle__bedrijf').all()
    serializer_class = TireRecordSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    filterset_fields = ['vehicle', 'tire_type', 'is_current', 'position']
    search_fields = ['brand', 'model', 'serial_number', 'vehicle__kenteken']
    ordering_fields = ['mounted_date', 'expected_replacement_date', 'vehicle__kenteken']
    ordering = ['vehicle__kenteken', 'position']

    @action(detail=False, methods=['get'], url_path='vehicle/(?P<vehicle_id>[^/.]+)')
    def by_vehicle(self, request, vehicle_id=None):
        """Alle banden voor een specifiek voertuig."""
        current_only = request.query_params.get('current_only', 'true').lower() == 'true'
        records = self.queryset.filter(vehicle_id=vehicle_id)
        if current_only:
            records = records.filter(is_current=True)
        serializer = self.get_serializer(records, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def extend(self, request, pk=None):
        """Verleng de verwachte vervangingsdatum."""
        tire = self.get_object()
        new_date = request.data.get('expected_replacement_date')
        if not new_date:
            return Response(
                {'error': 'expected_replacement_date is verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )
        tire.extend_replacement(date.fromisoformat(new_date))
        logger.info(
            f"Tire replacement extended: {tire.vehicle.kenteken} {tire.get_position_display()} "
            f"to {new_date} by {request.user.email}"
        )
        serializer = self.get_serializer(tire)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def replace(self, request, pk=None):
        """Markeer een band als vervangen."""
        old_tire = self.get_object()
        old_tire.is_current = False
        old_tire.removed_date = request.data.get('removed_date', date.today())
        old_tire.removed_km = request.data.get('removed_km')
        old_tire.removal_reason = request.data.get('removal_reason', 'Vervanging')
        old_tire.save()

        logger.info(
            f"Tire replaced: {old_tire.vehicle.kenteken} {old_tire.get_position_display()} "
            f"by {request.user.email}"
        )
        serializer = self.get_serializer(old_tire)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def choices(self, request):
        """Geeft keuze opties terug voor formulieren."""
        from .models import TirePosition, TireType
        return Response({
            'positions': [{'value': c[0], 'label': c[1]} for c in TirePosition.choices],
            'types': [{'value': c[0], 'label': c[1]} for c in TireType.choices],
        })


# =============================================================================
# THRESHOLDS & ALERTS
# =============================================================================

class MaintenanceThresholdViewSet(viewsets.ModelViewSet):
    """CRUD voor onderhoud thresholds."""
    queryset = MaintenanceThreshold.objects.select_related('maintenance_type').all()
    serializer_class = MaintenanceThresholdSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    filterset_fields = ['maintenance_type', 'is_apk_threshold', 'is_active']
    ordering = ['name']

    def perform_create(self, serializer):
        threshold = serializer.save()
        logger.info(f"Maintenance threshold created: {threshold.name} by {self.request.user.email}")


class MaintenanceAlertViewSet(viewsets.ModelViewSet):
    """Waarschuwingen voor onderhoud."""
    queryset = MaintenanceAlert.objects.select_related(
        'vehicle', 'threshold', 'maintenance_task', 'apk_record', 'resolved_by'
    ).all()
    serializer_class = MaintenanceAlertSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'
    filterset_fields = ['vehicle', 'severity', 'is_read', 'is_dismissed', 'is_resolved']
    ordering_fields = ['created_at', 'severity']
    ordering = ['-created_at']

    @action(detail=True, methods=['post'])
    def dismiss(self, request, pk=None):
        """Wijs een waarschuwing af."""
        alert = self.get_object()
        alert.dismiss(user=request.user)
        return Response({'status': 'dismissed'})

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """Markeer een waarschuwing als opgelost."""
        alert = self.get_object()
        alert.resolve(user=request.user)
        return Response({'status': 'resolved'})

    @action(detail=False, methods=['post'])
    def dismiss_all(self, request):
        """Wijs alle waarschuwingen af."""
        count = self.queryset.filter(
            is_dismissed=False, is_resolved=False
        ).update(is_dismissed=True)
        return Response({'dismissed': count})

    @action(detail=False, methods=['get'])
    def active(self, request):
        """Alleen actieve (niet afgewezen/opgeloste) waarschuwingen."""
        alerts = self.queryset.filter(is_dismissed=False, is_resolved=False)
        page = self.paginate_queryset(alerts)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(alerts, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['get'])
    def count(self, request):
        """Telt actieve waarschuwingen per ernst."""
        alerts = self.queryset.filter(is_dismissed=False, is_resolved=False)
        counts = alerts.values('severity').annotate(count=Count('id'))
        total = alerts.count()
        return Response({
            'total': total,
            'by_severity': {item['severity']: item['count'] for item in counts}
        })


# =============================================================================
# DASHBOARD & QUERIES
# =============================================================================

class MaintenanceDashboardViewSet(viewsets.ModelViewSet):
    """Configureerbare dashboards."""
    serializer_class = MaintenanceDashboardSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_maintenance'

    def get_queryset(self):
        return MaintenanceDashboard.objects.filter(
            Q(user=self.request.user) | Q(is_shared=True)
        ).prefetch_related('widgets', 'widgets__custom_query')

    def get_serializer_class(self):
        if self.action == 'list':
            return MaintenanceDashboardListSerializer
        return MaintenanceDashboardSerializer

    def perform_create(self, serializer):
        dashboard = serializer.save(user=self.request.user)
        if dashboard.is_default:
            # Zet andere dashboards van deze gebruiker op niet-standaard
            MaintenanceDashboard.objects.filter(
                user=self.request.user, is_default=True
            ).exclude(pk=dashboard.pk).update(is_default=False)

    @action(detail=False, methods=['get'])
    def default(self, request):
        """Haal het standaard dashboard op, of maak er een aan."""
        dashboard = MaintenanceDashboard.objects.filter(
            user=request.user, is_default=True
        ).prefetch_related('widgets', 'widgets__custom_query').first()

        if not dashboard:
            dashboard = self._create_default_dashboard(request.user)

        serializer = MaintenanceDashboardSerializer(dashboard)
        return Response(serializer.data)

    def _create_default_dashboard(self, user):
        """Maak een standaard dashboard aan met basis widgets."""
        dashboard = MaintenanceDashboard.objects.create(
            user=user,
            name='Onderhoud Dashboard',
            description='Standaard onderhoudsdashboard',
            is_default=True,
        )
        # Voeg standaard widgets toe
        default_widgets = [
            {'widget_type': 'fleet_health', 'title': 'Vloot Gezondheid', 'size': 'full', 'sort_order': 0},
            {'widget_type': 'apk_countdown', 'title': 'APK Countdown', 'size': 'medium', 'sort_order': 1},
            {'widget_type': 'upcoming_maintenance', 'title': 'Aankomend Onderhoud', 'size': 'medium', 'sort_order': 2},
            {'widget_type': 'overdue_tasks', 'title': 'Achterstallig Onderhoud', 'size': 'medium', 'sort_order': 3},
            {'widget_type': 'alerts_summary', 'title': 'Waarschuwingen', 'size': 'medium', 'sort_order': 4},
            {'widget_type': 'cost_per_vehicle', 'title': 'Kosten per Voertuig', 'size': 'large', 'sort_order': 5},
            {'widget_type': 'cost_trend', 'title': 'Kosten Trend', 'size': 'large', 'sort_order': 6},
        ]
        for widget_data in default_widgets:
            DashboardWidget.objects.create(dashboard=dashboard, **widget_data)
        return dashboard


class DashboardWidgetViewSet(viewsets.ModelViewSet):
    """CRUD voor dashboard widgets."""
    serializer_class = DashboardWidgetSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['dashboard', 'widget_type', 'is_visible']
    ordering = ['sort_order']

    def get_queryset(self):
        return DashboardWidget.objects.filter(
            Q(dashboard__user=self.request.user) | Q(dashboard__is_shared=True)
        ).select_related('dashboard', 'custom_query')

    @action(detail=False, methods=['get'])
    def types(self, request):
        """Beschikbare widget types."""
        from .models import DashboardWidgetType, DashboardWidgetSize
        return Response({
            'widget_types': [{'value': c[0], 'label': c[1]} for c in DashboardWidgetType.choices],
            'sizes': [{'value': c[0], 'label': c[1]} for c in DashboardWidgetSize.choices],
        })

    @action(detail=True, methods=['get'])
    def data(self, request, pk=None):
        """Haal de data op voor een specifieke widget."""
        widget = self.get_object()
        data = self._get_widget_data(widget, request)
        return Response(data)

    def _get_widget_data(self, widget, request):
        """Genereer data op basis van widget type."""
        handler_map = {
            'fleet_health': self._get_fleet_health,
            'apk_countdown': self._get_apk_countdown,
            'upcoming_maintenance': self._get_upcoming_maintenance,
            'overdue_tasks': self._get_overdue_tasks,
            'alerts_summary': self._get_alerts_summary,
            'cost_per_vehicle': self._get_cost_per_vehicle,
            'cost_by_type': self._get_cost_by_type,
            'cost_trend': self._get_cost_trend,
            'tire_status': self._get_tire_status,
            'maintenance_calendar': self._get_maintenance_calendar,
            'kpi_card': self._get_kpi_data,
            'custom_query': self._get_custom_query_data,
        }
        handler = handler_map.get(widget.widget_type)
        if handler:
            return handler(widget, request)
        return {'message': f'Widget type {widget.widget_type} niet ondersteund'}

    def _get_fleet_health(self, widget, request):
        from apps.fleet.models import Vehicle
        total_vehicles = Vehicle.objects.count()
        apk_expired = APKRecord.objects.filter(
            is_current=True, expiry_date__lt=date.today()
        ).count()
        upcoming_7 = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.SCHEDULED,
            scheduled_date__lte=date.today() + timedelta(days=7),
            scheduled_date__gte=date.today()
        ).count()
        upcoming_30 = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.SCHEDULED,
            scheduled_date__lte=date.today() + timedelta(days=30),
            scheduled_date__gte=date.today()
        ).count()
        overdue = MaintenanceTask.objects.filter(
            status__in=[MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS],
            scheduled_date__lt=date.today()
        ).count()
        active_alerts = MaintenanceAlert.objects.filter(
            is_dismissed=False, is_resolved=False
        ).count()

        return {
            'total_vehicles': total_vehicles,
            'apk_expired': apk_expired,
            'upcoming_tasks_7days': upcoming_7,
            'upcoming_tasks_30days': upcoming_30,
            'overdue_tasks': overdue,
            'total_active_alerts': active_alerts,
        }

    def _get_apk_countdown(self, widget, request):
        records = APKRecord.objects.filter(
            is_current=True
        ).select_related('vehicle', 'vehicle__bedrijf').order_by('expiry_date')[:20]
        return APKCountdownSerializer(records, many=True).data

    def _get_upcoming_maintenance(self, widget, request):
        days = widget.config.get('days', 30)
        tasks = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.SCHEDULED,
            scheduled_date__lte=date.today() + timedelta(days=days),
            scheduled_date__gte=date.today()
        ).select_related(
            'vehicle', 'maintenance_type', 'maintenance_type__category'
        ).order_by('scheduled_date')[:20]
        return MaintenanceTaskListSerializer(tasks, many=True).data

    def _get_overdue_tasks(self, widget, request):
        tasks = MaintenanceTask.objects.filter(
            status__in=[MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS],
            scheduled_date__lt=date.today()
        ).select_related(
            'vehicle', 'maintenance_type', 'maintenance_type__category'
        ).order_by('scheduled_date')[:20]
        return MaintenanceTaskListSerializer(tasks, many=True).data

    def _get_alerts_summary(self, widget, request):
        alerts = MaintenanceAlert.objects.filter(
            is_dismissed=False, is_resolved=False
        ).select_related('vehicle', 'threshold').order_by('-created_at')[:20]
        return MaintenanceAlertSerializer(alerts, many=True).data

    def _get_cost_per_vehicle(self, widget, request):
        from apps.fleet.models import Vehicle
        period = widget.config.get('period', 'year')
        if period == 'year':
            start_date = date(date.today().year, 1, 1)
        elif period == 'month':
            start_date = date(date.today().year, date.today().month, 1)
        else:
            start_date = date(date.today().year, 1, 1)

        costs = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.COMPLETED,
            completed_date__gte=start_date
        ).values(
            'vehicle__id', 'vehicle__kenteken', 'vehicle__type_wagen'
        ).annotate(
            total_cost=Coalesce(Sum('total_cost'), Decimal('0.00')),
            labor_cost=Coalesce(Sum('labor_cost'), Decimal('0.00')),
            parts_cost=Coalesce(Sum('parts_cost'), Decimal('0.00')),
            task_count=Count('id')
        ).order_by('-total_cost')

        return list(costs)

    def _get_cost_by_type(self, widget, request):
        period = widget.config.get('period', 'year')
        start_date = date(date.today().year, 1, 1) if period == 'year' else date(date.today().year, date.today().month, 1)

        costs = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.COMPLETED,
            completed_date__gte=start_date
        ).values(
            'maintenance_type__id', 'maintenance_type__name',
            'maintenance_type__category__name', 'maintenance_type__category__color'
        ).annotate(
            total_cost=Coalesce(Sum('total_cost'), Decimal('0.00')),
            task_count=Count('id')
        ).order_by('-total_cost')

        return list(costs)

    def _get_cost_trend(self, widget, request):
        months = widget.config.get('months', 12)
        start_date = date.today() - timedelta(days=months * 30)

        trend = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.COMPLETED,
            completed_date__gte=start_date
        ).annotate(
            month=TruncMonth('completed_date')
        ).values('month').annotate(
            total_cost=Coalesce(Sum('total_cost'), Decimal('0.00')),
            task_count=Count('id')
        ).order_by('month')

        return list(trend)

    def _get_tire_status(self, widget, request):
        tires = TireRecord.objects.filter(
            is_current=True
        ).select_related('vehicle').order_by('expected_replacement_date')[:20]
        return TireRecordSerializer(tires, many=True).data

    def _get_maintenance_calendar(self, widget, request):
        days = widget.config.get('days', 90)
        tasks = MaintenanceTask.objects.filter(
            scheduled_date__gte=date.today(),
            scheduled_date__lte=date.today() + timedelta(days=days),
            status=MaintenanceStatus.SCHEDULED
        ).select_related(
            'vehicle', 'maintenance_type', 'maintenance_type__category'
        ).order_by('scheduled_date')
        return MaintenanceTaskListSerializer(tasks, many=True).data

    def _get_kpi_data(self, widget, request):
        kpi_type = widget.config.get('kpi_type', 'total_cost_ytd')
        today = date.today()
        year_start = date(today.year, 1, 1)
        month_start = date(today.year, today.month, 1)

        kpi_handlers = {
            'total_cost_ytd': lambda: MaintenanceTask.objects.filter(
                status=MaintenanceStatus.COMPLETED, completed_date__gte=year_start
            ).aggregate(total=Coalesce(Sum('total_cost'), Decimal('0.00')))['total'],
            'total_cost_month': lambda: MaintenanceTask.objects.filter(
                status=MaintenanceStatus.COMPLETED, completed_date__gte=month_start
            ).aggregate(total=Coalesce(Sum('total_cost'), Decimal('0.00')))['total'],
            'overdue_count': lambda: MaintenanceTask.objects.filter(
                status__in=[MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS],
                scheduled_date__lt=today
            ).count(),
            'completed_month': lambda: MaintenanceTask.objects.filter(
                status=MaintenanceStatus.COMPLETED, completed_date__gte=month_start
            ).count(),
        }

        handler = kpi_handlers.get(kpi_type, lambda: 0)
        return {'value': handler(), 'kpi_type': kpi_type}

    def _get_custom_query_data(self, widget, request):
        if not widget.custom_query:
            return {'error': 'Geen query gekoppeld'}
        return self._execute_query(widget.custom_query)

    def _execute_query(self, query):
        """Voer een opgeslagen query uit."""
        qd = query.query_definition
        # Basis query executie - veilig via ORM
        model_name = qd.get('model', 'MaintenanceTask')
        filters = qd.get('filters', {})
        aggregations = qd.get('aggregations', [])
        group_by = qd.get('group_by', [])
        order_by = qd.get('order_by', ['-created_at'])
        limit = min(qd.get('limit', 100), 500)

        model_map = {
            'MaintenanceTask': MaintenanceTask,
            'APKRecord': APKRecord,
            'TireRecord': TireRecord,
            'MaintenanceAlert': MaintenanceAlert,
        }

        model = model_map.get(model_name)
        if not model:
            return {'error': f'Onbekend model: {model_name}'}

        qs = model.objects.all()

        # Apply filters
        for field, value in filters.items():
            if '__' in field:
                qs = qs.filter(**{field: value})
            else:
                qs = qs.filter(**{field: value})

        # Group by + aggregate
        if group_by and aggregations:
            qs = qs.values(*group_by)
            agg_kwargs = {}
            for agg in aggregations:
                name = agg.get('name', 'value')
                func = agg.get('function', 'count')
                field = agg.get('field', 'id')
                if func == 'sum':
                    agg_kwargs[name] = Sum(field)
                elif func == 'count':
                    agg_kwargs[name] = Count(field)
                elif func == 'avg':
                    agg_kwargs[name] = Avg(field)
            qs = qs.annotate(**agg_kwargs)

        qs = qs.order_by(*order_by)[:limit]
        return list(qs)


class MaintenanceQueryViewSet(viewsets.ModelViewSet):
    """Opgeslagen queries voor dashboards."""
    serializer_class = MaintenanceQuerySerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['is_sample', 'is_public', 'result_type']
    search_fields = ['name', 'description']
    ordering = ['-is_sample', 'name']

    def get_queryset(self):
        return MaintenanceQuery.objects.filter(
            Q(created_by=self.request.user) | Q(is_public=True) | Q(is_sample=True)
        )

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['get'])
    def execute(self, request, pk=None):
        """Voer een query uit en geef resultaten terug."""
        query = self.get_object()
        widget_viewset = DashboardWidgetViewSet()
        result = widget_viewset._execute_query(query)
        return Response({
            'query': MaintenanceQuerySerializer(query).data,
            'results': result
        })

    @action(detail=False, methods=['get'])
    def samples(self, request):
        """Haal alle sample queries op."""
        queries = MaintenanceQuery.objects.filter(is_sample=True)
        serializer = self.get_serializer(queries, many=True)
        return Response(serializer.data)


# =============================================================================
# OBD
# =============================================================================

class OBDDeviceViewSet(viewsets.ModelViewSet):
    """CRUD voor OBD apparaten."""
    queryset = OBDDevice.objects.select_related('vehicle', 'vehicle__bedrijf').all()
    serializer_class = OBDDeviceSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    filterset_fields = ['vehicle', 'connection_type', 'is_active']
    search_fields = ['device_name', 'device_serial', 'vehicle__kenteken']
    ordering = ['vehicle__kenteken']


class OBDReadingViewSet(viewsets.ModelViewSet):
    """OBD uitlezingen."""
    queryset = OBDReading.objects.select_related('device', 'vehicle').all()
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['device', 'vehicle']
    ordering = ['-timestamp']

    def get_serializer_class(self):
        if self.action == 'list':
            return OBDReadingSummarySerializer
        return OBDReadingSerializer

    @action(detail=False, methods=['get'], url_path='vehicle/(?P<vehicle_id>[^/.]+)')
    def by_vehicle(self, request, vehicle_id=None):
        """OBD data voor een specifiek voertuig."""
        limit = int(request.query_params.get('limit', 100))
        readings = self.queryset.filter(vehicle_id=vehicle_id)[:limit]
        serializer = OBDReadingSummarySerializer(readings, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def ingest(self, request):
        """
        Ontvang OBD data van een externe bron (API/connector).
        Verwacht een lijst van readings.
        """
        readings_data = request.data.get('readings', [])
        device_id = request.data.get('device_id')

        if not device_id:
            return Response(
                {'error': 'device_id is verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            device = OBDDevice.objects.get(id=device_id, is_active=True)
        except OBDDevice.DoesNotExist:
            return Response(
                {'error': 'OBD apparaat niet gevonden of inactief'},
                status=status.HTTP_404_NOT_FOUND
            )

        created_count = 0
        for reading_data in readings_data:
            reading_data['device'] = str(device.id)
            reading_data['vehicle'] = str(device.vehicle.id)
            serializer = OBDReadingSerializer(data=reading_data)
            if serializer.is_valid():
                serializer.save()
                created_count += 1

        # Update last_sync
        device.last_sync = timezone.now()
        device.save(update_fields=['last_sync', 'updated_at'])

        logger.info(
            f"OBD data ingested: {created_count} readings for {device.vehicle.kenteken} "
            f"by {request.user.email}"
        )

        return Response({
            'created': created_count,
            'total_received': len(readings_data),
            'device': device.device_name,
            'vehicle': device.vehicle.kenteken,
        }, status=status.HTTP_201_CREATED)


# =============================================================================
# DASHBOARD DATA ENDPOINTS (statistieken en rapportages)
# =============================================================================

class MaintenanceStatsView(APIView):
    """Algemene onderhoudsstatistieken."""
    permission_classes = [IsAuthenticated, IsAdminOrManager]

    def get(self, request):
        today = date.today()
        year_start = date(today.year, 1, 1)
        month_start = date(today.year, today.month, 1)

        total_tasks = MaintenanceTask.objects.count()
        completed = MaintenanceTask.objects.filter(status=MaintenanceStatus.COMPLETED).count()
        scheduled = MaintenanceTask.objects.filter(status=MaintenanceStatus.SCHEDULED).count()
        overdue = MaintenanceTask.objects.filter(
            status__in=[MaintenanceStatus.SCHEDULED, MaintenanceStatus.IN_PROGRESS],
            scheduled_date__lt=today
        ).count()

        cost_ytd = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.COMPLETED,
            completed_date__gte=year_start
        ).aggregate(total=Coalesce(Sum('total_cost'), Decimal('0.00')))['total']

        cost_month = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.COMPLETED,
            completed_date__gte=month_start
        ).aggregate(total=Coalesce(Sum('total_cost'), Decimal('0.00')))['total']

        from apps.fleet.models import Vehicle
        vehicle_count = Vehicle.objects.count()
        avg_cost = cost_ytd / vehicle_count if vehicle_count > 0 else Decimal('0.00')

        # Duurste voertuig
        most_expensive = MaintenanceTask.objects.filter(
            status=MaintenanceStatus.COMPLETED,
            completed_date__gte=year_start
        ).values(
            'vehicle__kenteken', 'vehicle__type_wagen'
        ).annotate(
            total=Sum('total_cost')
        ).order_by('-total').first()

        # Kosten trend (laatste 12 maanden)
        trend_start = today - timedelta(days=365)
        cost_trend = list(
            MaintenanceTask.objects.filter(
                status=MaintenanceStatus.COMPLETED,
                completed_date__gte=trend_start
            ).annotate(
                month=TruncMonth('completed_date')
            ).values('month').annotate(
                total_cost=Coalesce(Sum('total_cost'), Decimal('0.00')),
                task_count=Count('id')
            ).order_by('month')
        )

        return Response({
            'total_tasks': total_tasks,
            'completed_tasks': completed,
            'scheduled_tasks': scheduled,
            'overdue_tasks': overdue,
            'total_cost_ytd': str(cost_ytd),
            'total_cost_month': str(cost_month),
            'avg_cost_per_vehicle': str(avg_cost),
            'most_expensive_vehicle': most_expensive,
            'cost_trend': cost_trend,
        })


class VehicleCostReportView(APIView):
    """Gedetailleerd kostenrapport per voertuig."""
    permission_classes = [IsAuthenticated, IsAdminOrManager]

    def get(self, request):
        vehicle_id = request.query_params.get('vehicle')
        period = request.query_params.get('period', 'year')

        if period == 'year':
            start_date = date(date.today().year, 1, 1)
        elif period == 'all':
            start_date = date(2000, 1, 1)
        else:
            start_date = date(date.today().year, date.today().month, 1)

        filters = {'status': MaintenanceStatus.COMPLETED, 'completed_date__gte': start_date}
        if vehicle_id:
            filters['vehicle_id'] = vehicle_id

        costs = MaintenanceTask.objects.filter(**filters).values(
            'vehicle__id', 'vehicle__kenteken', 'vehicle__type_wagen'
        ).annotate(
            total_cost=Coalesce(Sum('total_cost'), Decimal('0.00')),
            labor_cost=Coalesce(Sum('labor_cost'), Decimal('0.00')),
            parts_cost=Coalesce(Sum('parts_cost'), Decimal('0.00')),
            task_count=Count('id')
        ).order_by('-total_cost')

        # APK kosten toevoegen
        for cost_item in costs:
            apk_cost = APKRecord.objects.filter(
                vehicle_id=cost_item['vehicle__id'],
                inspection_date__gte=start_date
            ).aggregate(total=Coalesce(Sum('cost'), Decimal('0.00')))['total']
            cost_item['apk_cost'] = str(apk_cost)

            tire_cost = TireRecord.objects.filter(
                vehicle_id=cost_item['vehicle__id'],
                mounted_date__gte=start_date
            ).aggregate(total=Coalesce(Sum('purchase_cost'), Decimal('0.00')))['total']
            cost_item['tire_cost'] = str(tire_cost)

        return Response(list(costs))

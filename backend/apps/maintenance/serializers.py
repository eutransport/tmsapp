"""
Fleet Maintenance Management Serializers
"""
from datetime import date

from rest_framework import serializers

from .models import (
    MaintenanceCategory,
    MaintenanceType,
    VehicleMaintenanceProfile,
    APKRecord,
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
)


# =============================================================================
# CATEGORIEËN & TYPES
# =============================================================================

class MaintenanceCategorySerializer(serializers.ModelSerializer):
    type_count = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceCategory
        fields = [
            'id', 'name', 'name_en', 'description', 'icon', 'color',
            'sort_order', 'is_active', 'type_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_type_count(self, obj):
        return obj.maintenance_types.filter(is_active=True).count()


class MaintenanceTypeSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = MaintenanceType
        fields = [
            'id', 'category', 'category_name', 'name', 'name_en', 'description',
            'default_interval_km', 'default_interval_days', 'vehicle_type',
            'is_mandatory', 'estimated_cost', 'is_active', 'sort_order',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class MaintenanceTypeListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for dropdowns."""
    category_name = serializers.CharField(source='category.name', read_only=True)

    class Meta:
        model = MaintenanceType
        fields = ['id', 'name', 'category', 'category_name', 'vehicle_type', 'is_mandatory']


# =============================================================================
# VEHICLE MAINTENANCE PROFILE
# =============================================================================

class VehicleMaintenanceProfileSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    maintenance_type_name = serializers.CharField(source='maintenance_type.name', read_only=True)
    category_name = serializers.CharField(source='maintenance_type.category.name', read_only=True)
    days_until_due = serializers.IntegerField(read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    status = serializers.CharField(read_only=True)
    interval_km = serializers.IntegerField(read_only=True)
    interval_days = serializers.IntegerField(read_only=True)

    class Meta:
        model = VehicleMaintenanceProfile
        fields = [
            'id', 'vehicle', 'vehicle_kenteken', 'maintenance_type', 'maintenance_type_name',
            'category_name', 'custom_interval_km', 'custom_interval_days',
            'last_performed_date', 'last_performed_km', 'next_due_date', 'next_due_km',
            'is_active', 'notes', 'days_until_due', 'is_overdue', 'status',
            'interval_km', 'interval_days', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


# =============================================================================
# APK
# =============================================================================

class APKRecordSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    vehicle_type = serializers.CharField(source='vehicle.type_wagen', read_only=True)
    days_until_expiry = serializers.IntegerField(read_only=True)
    is_expired = serializers.BooleanField(read_only=True)
    countdown_status = serializers.CharField(read_only=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = APKRecord
        fields = [
            'id', 'vehicle', 'vehicle_kenteken', 'vehicle_type',
            'inspection_date', 'expiry_date', 'status', 'passed',
            'inspection_station', 'inspector_name', 'mileage_at_inspection',
            'cost', 'remarks', 'defects', 'certificate_file', 'is_current',
            'days_until_expiry', 'is_expired', 'countdown_status',
            'created_by', 'created_by_name', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        from apps.core.file_signing import sign_file_field
        request = self.context.get('request')
        signed = sign_file_field(getattr(instance, 'certificate_file', None))
        if signed and request:
            signed = request.build_absolute_uri(signed)
        data['certificate_file'] = signed
        return data

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return None


class APKCountdownSerializer(serializers.ModelSerializer):
    """Lightweight serializer voor APK countdown weergave."""
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    vehicle_type = serializers.CharField(source='vehicle.type_wagen', read_only=True)
    bedrijf_naam = serializers.CharField(source='vehicle.bedrijf.naam', read_only=True, default=None)
    days_until_expiry = serializers.IntegerField(read_only=True)
    countdown_status = serializers.CharField(read_only=True)

    class Meta:
        model = APKRecord
        fields = [
            'id', 'vehicle', 'vehicle_kenteken', 'vehicle_type', 'bedrijf_naam',
            'expiry_date', 'days_until_expiry', 'countdown_status', 'status'
        ]


# =============================================================================
# ONDERHOUDSTAKEN
# =============================================================================

class MaintenancePartSerializer(serializers.ModelSerializer):
    class Meta:
        model = MaintenancePart
        fields = [
            'id', 'task', 'name', 'part_number', 'quantity',
            'unit_price', 'total_price', 'supplier', 'warranty_months',
            'created_at'
        ]
        read_only_fields = ['id', 'total_price', 'created_at']


class MaintenanceTaskSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    vehicle_type = serializers.CharField(source='vehicle.type_wagen', read_only=True)
    bedrijf_naam = serializers.CharField(source='vehicle.bedrijf.naam', read_only=True, default=None)
    maintenance_type_name = serializers.CharField(source='maintenance_type.name', read_only=True)
    category_name = serializers.CharField(source='maintenance_type.category.name', read_only=True)
    category_color = serializers.CharField(source='maintenance_type.category.color', read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)
    parts = MaintenancePartSerializer(many=True, read_only=True)
    assigned_to_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    completed_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceTask
        fields = [
            'id', 'vehicle', 'vehicle_kenteken', 'vehicle_type', 'bedrijf_naam',
            'maintenance_type', 'maintenance_type_name', 'category_name', 'category_color',
            'status', 'priority', 'title', 'description',
            'scheduled_date', 'completed_date', 'mileage_at_service',
            'service_provider', 'service_provider_contact',
            'labor_cost', 'parts_cost', 'total_cost',
            'invoice_number', 'invoice_file',
            'work_performed', 'parts_replaced', 'technician_notes',
            'assigned_to', 'assigned_to_name',
            'created_by', 'created_by_name',
            'completed_by', 'completed_by_name',
            'is_overdue', 'parts',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'total_cost', 'created_at', 'updated_at']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        from apps.core.file_signing import sign_file_field
        request = self.context.get('request')
        signed = sign_file_field(getattr(instance, 'invoice_file', None))
        if signed and request:
            signed = request.build_absolute_uri(signed)
        data['invoice_file'] = signed
        return data

    def get_assigned_to_name(self, obj):
        if obj.assigned_to:
            return obj.assigned_to.get_full_name() or obj.assigned_to.email
        return None

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return None

    def get_completed_by_name(self, obj):
        if obj.completed_by:
            return obj.completed_by.get_full_name() or obj.completed_by.email
        return None


class MaintenanceTaskCreateSerializer(serializers.ModelSerializer):
    """Serializer voor het aanmaken van onderhoudstaken."""
    class Meta:
        model = MaintenanceTask
        fields = [
            'vehicle', 'maintenance_type', 'status', 'priority',
            'title', 'description', 'scheduled_date', 'completed_date',
            'mileage_at_service', 'service_provider', 'service_provider_contact',
            'labor_cost', 'parts_cost', 'invoice_number', 'invoice_file',
            'work_performed', 'parts_replaced', 'technician_notes',
            'assigned_to'
        ]


class MaintenanceTaskListSerializer(serializers.ModelSerializer):
    """Lightweight serializer voor lijstweergave."""
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    maintenance_type_name = serializers.CharField(source='maintenance_type.name', read_only=True)
    category_name = serializers.CharField(source='maintenance_type.category.name', read_only=True)
    category_color = serializers.CharField(source='maintenance_type.category.color', read_only=True)
    is_overdue = serializers.BooleanField(read_only=True)

    class Meta:
        model = MaintenanceTask
        fields = [
            'id', 'vehicle', 'vehicle_kenteken', 'maintenance_type_name',
            'category_name', 'category_color', 'status', 'priority',
            'title', 'scheduled_date', 'completed_date', 'total_cost',
            'is_overdue', 'created_at'
        ]


# =============================================================================
# BANDEN
# =============================================================================

class TireRecordSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    days_until_replacement = serializers.IntegerField(read_only=True)
    km_driven = serializers.IntegerField(read_only=True)
    position_display = serializers.CharField(source='get_position_display', read_only=True)
    tire_type_display = serializers.CharField(source='get_tire_type_display', read_only=True)

    class Meta:
        model = TireRecord
        fields = [
            'id', 'vehicle', 'vehicle_kenteken',
            'position', 'position_display', 'brand', 'model', 'size',
            'tire_type', 'tire_type_display', 'dot_code', 'serial_number',
            'tread_depth_mm', 'minimum_tread_depth',
            'mounted_date', 'mounted_km',
            'expected_replacement_date', 'days_until_replacement',
            'removed_date', 'removed_km', 'removal_reason', 'km_driven',
            'purchase_cost', 'is_current', 'notes',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'total_price', 'created_at', 'updated_at']


# =============================================================================
# THRESHOLDS & ALERTS
# =============================================================================

class MaintenanceThresholdSerializer(serializers.ModelSerializer):
    maintenance_type_name = serializers.CharField(
        source='maintenance_type.name', read_only=True, default=None
    )
    active_alerts_count = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceThreshold
        fields = [
            'id', 'name', 'description',
            'maintenance_type', 'maintenance_type_name', 'is_apk_threshold',
            'warning_days', 'critical_days', 'urgent_days',
            'warning_km', 'critical_km',
            'send_email', 'send_push', 'send_to_admin',
            'extra_email_recipients', 'is_active',
            'active_alerts_count', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_active_alerts_count(self, obj):
        return obj.alerts.filter(is_resolved=False, is_dismissed=False).count()


class MaintenanceAlertSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    threshold_name = serializers.CharField(source='threshold.name', read_only=True, default=None)
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceAlert
        fields = [
            'id', 'vehicle', 'vehicle_kenteken',
            'threshold', 'threshold_name',
            'maintenance_task', 'apk_record',
            'severity', 'title', 'message',
            'is_read', 'is_dismissed', 'is_resolved',
            'email_sent', 'email_sent_at', 'push_sent',
            'resolved_at', 'resolved_by', 'resolved_by_name',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_resolved_by_name(self, obj):
        if obj.resolved_by:
            return obj.resolved_by.get_full_name() or obj.resolved_by.email
        return None


# =============================================================================
# DASHBOARD & QUERIES
# =============================================================================

class DashboardWidgetSerializer(serializers.ModelSerializer):
    custom_query_name = serializers.CharField(
        source='custom_query.name', read_only=True, default=None
    )
    widget_type_display = serializers.CharField(source='get_widget_type_display', read_only=True)
    size_display = serializers.CharField(source='get_size_display', read_only=True)

    class Meta:
        model = DashboardWidget
        fields = [
            'id', 'dashboard', 'widget_type', 'widget_type_display',
            'title', 'size', 'size_display',
            'position_x', 'position_y', 'sort_order',
            'config', 'custom_query', 'custom_query_name',
            'is_visible', 'refresh_interval_seconds',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class MaintenanceDashboardSerializer(serializers.ModelSerializer):
    widgets = DashboardWidgetSerializer(many=True, read_only=True)
    user_name = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceDashboard
        fields = [
            'id', 'user', 'user_name', 'name', 'description',
            'is_default', 'is_shared', 'layout', 'widgets',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'user', 'created_at', 'updated_at']

    def get_user_name(self, obj):
        return obj.user.get_full_name() or obj.user.email


class MaintenanceDashboardListSerializer(serializers.ModelSerializer):
    widget_count = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceDashboard
        fields = [
            'id', 'name', 'description', 'is_default', 'is_shared',
            'widget_count', 'created_at', 'updated_at'
        ]

    def get_widget_count(self, obj):
        return obj.widgets.count()


class MaintenanceQuerySerializer(serializers.ModelSerializer):
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceQuery
        fields = [
            'id', 'name', 'description', 'query_definition', 'result_type',
            'created_by', 'created_by_name', 'is_sample', 'is_public',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def get_created_by_name(self, obj):
        if obj.created_by:
            return obj.created_by.get_full_name() or obj.created_by.email
        return None


# =============================================================================
# OBD
# =============================================================================

class OBDDeviceSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)
    reading_count = serializers.SerializerMethodField()
    connection_type_display = serializers.CharField(source='get_connection_type_display', read_only=True)

    class Meta:
        model = OBDDevice
        fields = [
            'id', 'vehicle', 'vehicle_kenteken',
            'device_name', 'device_serial', 'connection_type', 'connection_type_display',
            'api_endpoint', 'api_key', 'api_provider',
            'is_active', 'last_sync', 'reading_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_reading_count(self, obj):
        return obj.readings.count()


class OBDReadingSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)

    class Meta:
        model = OBDReading
        fields = [
            'id', 'device', 'vehicle', 'vehicle_kenteken', 'timestamp',
            'engine_rpm', 'engine_temp_celsius', 'engine_load_percent', 'engine_hours',
            'speed_kmh', 'odometer_km',
            'fuel_level_percent', 'fuel_rate_lph', 'fuel_type',
            'dtc_codes', 'mil_on',
            'oil_temp_celsius', 'oil_pressure_kpa',
            'tire_pressure_data', 'battery_voltage',
            'adblue_level_percent',
            'latitude', 'longitude',
            'raw_data', 'created_at'
        ]
        read_only_fields = ['id', 'created_at']


class OBDReadingSummarySerializer(serializers.ModelSerializer):
    """Lightweight serializer voor OBD data overzicht."""
    class Meta:
        model = OBDReading
        fields = [
            'id', 'timestamp', 'odometer_km', 'engine_temp_celsius',
            'fuel_level_percent', 'battery_voltage', 'mil_on',
            'speed_kmh', 'dtc_codes'
        ]


# =============================================================================
# DASHBOARD DATA SERIALIZERS (voor API endpoints die aggregaties teruggeven)
# =============================================================================

class VehicleCostSummarySerializer(serializers.Serializer):
    """Kosten samenvatting per voertuig."""
    vehicle_id = serializers.UUIDField()
    vehicle_kenteken = serializers.CharField()
    vehicle_type = serializers.CharField()
    total_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    labor_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    parts_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    task_count = serializers.IntegerField()
    apk_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    tire_cost = serializers.DecimalField(max_digits=12, decimal_places=2)


class CostByTypeSerializer(serializers.Serializer):
    """Kosten per onderhoudstype."""
    maintenance_type_id = serializers.UUIDField()
    maintenance_type_name = serializers.CharField()
    category_name = serializers.CharField()
    category_color = serializers.CharField()
    total_cost = serializers.DecimalField(max_digits=12, decimal_places=2)
    task_count = serializers.IntegerField()


class FleetHealthSerializer(serializers.Serializer):
    """Vloot gezondheid overzicht."""
    total_vehicles = serializers.IntegerField()
    vehicles_ok = serializers.IntegerField()
    vehicles_warning = serializers.IntegerField()
    vehicles_critical = serializers.IntegerField()
    vehicles_overdue = serializers.IntegerField()
    apk_expired = serializers.IntegerField()
    upcoming_tasks_7days = serializers.IntegerField()
    upcoming_tasks_30days = serializers.IntegerField()
    total_active_alerts = serializers.IntegerField()


class MaintenanceStatsSerializer(serializers.Serializer):
    """Algemene onderhoudsstatistieken."""
    total_tasks = serializers.IntegerField()
    completed_tasks = serializers.IntegerField()
    scheduled_tasks = serializers.IntegerField()
    overdue_tasks = serializers.IntegerField()
    total_cost_ytd = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_cost_month = serializers.DecimalField(max_digits=12, decimal_places=2)
    avg_cost_per_vehicle = serializers.DecimalField(max_digits=12, decimal_places=2)
    most_expensive_vehicle = serializers.DictField(allow_null=True)
    cost_trend = serializers.ListField(child=serializers.DictField())

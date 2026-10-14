"""Fleet Maintenance Admin Configuration."""
from django.contrib import admin
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
)


@admin.register(MaintenanceCategory)
class MaintenanceCategoryAdmin(admin.ModelAdmin):
    list_display = ['name', 'sort_order', 'is_active', 'created_at']
    list_filter = ['is_active']
    search_fields = ['name']


@admin.register(MaintenanceType)
class MaintenanceTypeAdmin(admin.ModelAdmin):
    list_display = ['name', 'category', 'vehicle_type', 'is_mandatory', 'default_interval_days', 'default_interval_km', 'is_active']
    list_filter = ['category', 'vehicle_type', 'is_mandatory', 'is_active']
    search_fields = ['name', 'description']


@admin.register(VehicleMaintenanceProfile)
class VehicleMaintenanceProfileAdmin(admin.ModelAdmin):
    list_display = ['vehicle', 'maintenance_type', 'next_due_date', 'is_active']
    list_filter = ['is_active', 'maintenance_type__category']
    search_fields = ['vehicle__kenteken']
    raw_id_fields = ['vehicle', 'maintenance_type']


@admin.register(ADRRecord)
class ADRRecordAdmin(admin.ModelAdmin):
    list_display = ['vehicle', 'route', 'has_adr', 'case_sealed', 'inspection_date', 'next_inspection_date']
    list_filter = ['has_adr', 'case_sealed']
    search_fields = ['vehicle__kenteken', 'route']
    raw_id_fields = ['vehicle']
    filter_horizontal = ['notify_users']


@admin.register(ADRSettings)
class ADRSettingsAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'email_profile', 'last_run_on', 'updated_at']
    filter_horizontal = ['default_notify_users']


@admin.register(APKRecord)
class APKRecordAdmin(admin.ModelAdmin):
    list_display = ['vehicle', 'inspection_date', 'expiry_date', 'status', 'passed', 'is_current', 'cost']
    list_filter = ['status', 'passed', 'is_current']
    search_fields = ['vehicle__kenteken', 'inspection_station']
    raw_id_fields = ['vehicle']


@admin.register(MaintenanceTask)
class MaintenanceTaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'vehicle', 'maintenance_type', 'status', 'priority', 'scheduled_date', 'total_cost']
    list_filter = ['status', 'priority', 'maintenance_type__category']
    search_fields = ['title', 'vehicle__kenteken', 'service_provider']
    raw_id_fields = ['vehicle', 'maintenance_type', 'assigned_to', 'created_by', 'completed_by']
    date_hierarchy = 'scheduled_date'


class MaintenancePartInline(admin.TabularInline):
    model = MaintenancePart
    extra = 0


@admin.register(MaintenancePart)
class MaintenancePartAdmin(admin.ModelAdmin):
    list_display = ['name', 'task', 'quantity', 'unit_price', 'total_price', 'supplier']
    search_fields = ['name', 'part_number']
    raw_id_fields = ['task']


@admin.register(TireRecord)
class TireRecordAdmin(admin.ModelAdmin):
    list_display = ['vehicle', 'position', 'brand', 'size', 'tire_type', 'tread_depth_mm', 'is_current']
    list_filter = ['tire_type', 'is_current', 'position']
    search_fields = ['vehicle__kenteken', 'brand', 'serial_number']
    raw_id_fields = ['vehicle']


@admin.register(MaintenanceThreshold)
class MaintenanceThresholdAdmin(admin.ModelAdmin):
    list_display = ['name', 'maintenance_type', 'is_apk_threshold', 'warning_days', 'critical_days', 'is_active']
    list_filter = ['is_apk_threshold', 'is_active']


@admin.register(MaintenanceAlert)
class MaintenanceAlertAdmin(admin.ModelAdmin):
    list_display = ['title', 'vehicle', 'severity', 'is_read', 'is_dismissed', 'is_resolved', 'created_at']
    list_filter = ['severity', 'is_read', 'is_dismissed', 'is_resolved']
    search_fields = ['title', 'vehicle__kenteken']


@admin.register(MaintenanceDashboard)
class MaintenanceDashboardAdmin(admin.ModelAdmin):
    list_display = ['name', 'user', 'is_default', 'is_shared', 'created_at']
    list_filter = ['is_default', 'is_shared']


@admin.register(DashboardWidget)
class DashboardWidgetAdmin(admin.ModelAdmin):
    list_display = ['title', 'dashboard', 'widget_type', 'size', 'sort_order', 'is_visible']
    list_filter = ['widget_type', 'size', 'is_visible']


@admin.register(MaintenanceQuery)
class MaintenanceQueryAdmin(admin.ModelAdmin):
    list_display = ['name', 'result_type', 'is_sample', 'is_public', 'created_by']
    list_filter = ['result_type', 'is_sample', 'is_public']


@admin.register(OBDDevice)
class OBDDeviceAdmin(admin.ModelAdmin):
    list_display = ['device_name', 'vehicle', 'connection_type', 'is_active', 'last_sync']
    list_filter = ['connection_type', 'is_active']
    raw_id_fields = ['vehicle']


@admin.register(OBDReading)
class OBDReadingAdmin(admin.ModelAdmin):
    list_display = ['vehicle', 'timestamp', 'odometer_km', 'engine_temp_celsius', 'fuel_level_percent']
    list_filter = ['vehicle']
    date_hierarchy = 'timestamp'
    raw_id_fields = ['device', 'vehicle']

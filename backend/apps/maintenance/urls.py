"""
Fleet Maintenance Management URL Configuration
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    MaintenanceCategoryViewSet,
    MaintenanceTypeViewSet,
    VehicleMaintenanceProfileViewSet,
    APKRecordViewSet,
    APKSettingsView,
    ADRRecordViewSet,
    ADRSettingsView,
    FireExtinguisherRecordViewSet,
    FireExtinguisherSettingsView,
    ExpiringOverviewView,
    MaintenanceTaskViewSet,
    MaintenancePartViewSet,
    TireRecordViewSet,
    MaintenanceThresholdViewSet,
    MaintenanceAlertViewSet,
    MaintenanceDashboardViewSet,
    DashboardWidgetViewSet,
    MaintenanceQueryViewSet,
    OBDDeviceViewSet,
    OBDReadingViewSet,
    MaintenanceStatsView,
    VehicleCostReportView,
)

router = DefaultRouter()
router.register(r'categories', MaintenanceCategoryViewSet, basename='maintenance-categories')
router.register(r'types', MaintenanceTypeViewSet, basename='maintenance-types')
router.register(r'profiles', VehicleMaintenanceProfileViewSet, basename='maintenance-profiles')
router.register(r'apk', APKRecordViewSet, basename='apk-records')
router.register(r'adr', ADRRecordViewSet, basename='adr-records')
router.register(r'fire-extinguishers', FireExtinguisherRecordViewSet, basename='fire-extinguishers')
router.register(r'tasks', MaintenanceTaskViewSet, basename='maintenance-tasks')
router.register(r'parts', MaintenancePartViewSet, basename='maintenance-parts')
router.register(r'tires', TireRecordViewSet, basename='tire-records')
router.register(r'thresholds', MaintenanceThresholdViewSet, basename='maintenance-thresholds')
router.register(r'alerts', MaintenanceAlertViewSet, basename='maintenance-alerts')
router.register(r'dashboards', MaintenanceDashboardViewSet, basename='maintenance-dashboards')
router.register(r'widgets', DashboardWidgetViewSet, basename='dashboard-widgets')
router.register(r'queries', MaintenanceQueryViewSet, basename='maintenance-queries')
router.register(r'obd/devices', OBDDeviceViewSet, basename='obd-devices')
router.register(r'obd/readings', OBDReadingViewSet, basename='obd-readings')

urlpatterns = [
    path('apk-settings/', APKSettingsView.as_view(), name='apk-settings'),
    path('adr-settings/', ADRSettingsView.as_view(), name='adr-settings'),
    path('fire-extinguisher-settings/', FireExtinguisherSettingsView.as_view(), name='fire-extinguisher-settings'),
    path('expiring-overview/', ExpiringOverviewView.as_view(), name='expiring-overview'),
    path('', include(router.urls)),
    path('stats/', MaintenanceStatsView.as_view(), name='maintenance-stats'),
    path('reports/vehicle-cost/', VehicleCostReportView.as_view(), name='vehicle-cost-report'),
]

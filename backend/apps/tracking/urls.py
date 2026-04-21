"""Track & Trace URL configuration."""
from django.urls import path
from . import views

urlpatterns = [
    # Session management
    path('session/', views.TrackingSessionView.as_view(), name='tracking-session'),
    
    # Location submission
    path('location/', views.LocationSubmitView.as_view(), name='tracking-location'),
    
    # Live tracking map data
    path('live/', views.LiveTrackingView.as_view(), name='tracking-live'),
    
    # Route history
    path('history/', views.RouteHistoryView.as_view(), name='tracking-history'),
    path('history/<uuid:session_id>/', views.RouteHistoryView.as_view(), name='tracking-history-detail'),
    
    # Available vehicles
    path('vehicles/', views.TrackingVehiclesView.as_view(), name='tracking-vehicles'),

    # Tachograph (FM-Track / Linqo)
    path('tachograph/', views.TachographOverviewView.as_view(), name='tachograph-overview'),
    path('tachograph/overtime/', views.TachographOvertimeWriteView.as_view(), name='tachograph-overtime-write'),
    path('tachograph/overtime/list/', views.TachographOvertimeListView.as_view(), name='tachograph-overtime-list'),
    path('tachograph/vehicles/', views.TachographVehiclesListView.as_view(), name='tachograph-vehicles'),
    path('tachograph/sync/', views.TachographManualSyncView.as_view(), name='tachograph-sync'),
    path('tachograph/archive/', views.TachographArchiveListView.as_view(), name='tachograph-archive-list'),
    path('tachograph/archive/sync/', views.TachographArchiveSyncView.as_view(), name='tachograph-archive-sync'),
    path('tachograph/comparison/', views.TachographComparisonView.as_view(), name='tachograph-comparison'),
    
    # Assigned vehicle for current user
    path('my-vehicle/', views.AssignedVehicleView.as_view(), name='tracking-my-vehicle'),

    # FM-Track vehicle positions
    path('fm-positions/', views.FMTrackPositionsView.as_view(), name='fm-track-positions'),

    # FM-Track vehicle detail with trip history
    path('fm-positions/<str:object_id>/detail/', views.VehicleDetailView.as_view(), name='fm-vehicle-detail'),
]

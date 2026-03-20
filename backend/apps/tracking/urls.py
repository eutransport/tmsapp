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
    
    # Assigned vehicle for current user
    path('my-vehicle/', views.AssignedVehicleView.as_view(), name='tracking-my-vehicle'),
]

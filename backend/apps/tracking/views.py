"""
Track & Trace API views.

Security architecture:
- All endpoints require JWT authentication
- Location submission: only authenticated drivers can submit their own location
- Live view: admin/manager can see all, drivers see only their own
- Route history: admin/manager can see all, drivers see only their own
- Rate limiting on all endpoints
- Input validation + anomaly detection
- Audit logging for session start/stop
"""
import logging
from django.utils import timezone
from django.db.models import Prefetch, Subquery, OuterRef
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdminOrManager
from .models import TrackingSession, LocationPoint
from .serializers import (
    TrackingSessionCreateSerializer,
    TrackingSessionSerializer,
    LocationPointCreateSerializer,
    LocationPointBatchSerializer,
    LocationPointSerializer,
    LiveVehicleSerializer,
)
from .security import (
    TrackingSubmitThrottle,
    TrackingReadThrottle,
    detect_teleportation,
    validate_location_bounds,
    get_client_ip,
    calculate_route_distance,
)

logger = logging.getLogger('tracking')


class TrackingSessionView(APIView):
    """
    Start/stop tracking sessions.
    
    POST: Start a new tracking session
    DELETE: Stop the current active session
    GET: Get the current user's active session
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        """Get the current user's active tracking session."""
        session = TrackingSession.objects.filter(
            user=request.user, is_active=True
        ).select_related('vehicle').first()
        
        if session:
            serializer = TrackingSessionSerializer(session)
            return Response(serializer.data)
        return Response({'active': False}, status=status.HTTP_200_OK)

    def post(self, request):
        """Start a new tracking session."""
        # End any existing active sessions for this user
        TrackingSession.objects.filter(
            user=request.user, is_active=True
        ).update(is_active=False, ended_at=timezone.now())
        
        serializer = TrackingSessionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        vehicle_id = serializer.validated_data.get('vehicle_id')
        vehicle = None
        if vehicle_id:
            from apps.fleet.models import Vehicle
            vehicle = Vehicle.objects.filter(id=vehicle_id).first()
        
        # Auto-detect vehicle from driver profile
        if not vehicle and hasattr(request.user, 'driver_profile'):
            driver = request.user.driver_profile
            if driver and driver.voertuig:
                vehicle = driver.voertuig

        session = TrackingSession.objects.create(
            user=request.user,
            vehicle=vehicle,
            user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
            ip_address=get_client_ip(request),
        )
        
        logger.info(
            f"Tracking session started: user={request.user.username}, "
            f"session={session.id}, vehicle={vehicle}"
        )
        
        result = TrackingSessionSerializer(session)
        return Response(result.data, status=status.HTTP_201_CREATED)

    def delete(self, request):
        """Stop the current user's active tracking session."""
        updated = TrackingSession.objects.filter(
            user=request.user, is_active=True
        ).update(is_active=False, ended_at=timezone.now())
        
        if updated:
            logger.info(f"Tracking session stopped: user={request.user.username}")
            return Response({'stopped': True})
        return Response(
            {'detail': 'No active session found.'},
            status=status.HTTP_404_NOT_FOUND,
        )


class LocationSubmitView(APIView):
    """
    Submit GPS location points.
    
    POST: Submit a single location point or batch of points.
    
    Security:
    - Authenticated users only
    - User must have an active tracking session
    - Coordinates validated for realistic ranges
    - Anomaly detection (teleportation check)
    - Rate limited to prevent spam
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [TrackingSubmitThrottle]

    def post(self, request):
        """Submit location point(s)."""
        session = TrackingSession.objects.filter(
            user=request.user, is_active=True
        ).first()
        
        if not session:
            return Response(
                {'detail': 'No active tracking session. Start one first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        
        # Check if it's a batch or single point
        is_batch = 'points' in request.data
        
        if is_batch:
            batch_serializer = LocationPointBatchSerializer(data=request.data)
            batch_serializer.is_valid(raise_exception=True)
            points_data = batch_serializer.validated_data['points']
        else:
            point_serializer = LocationPointCreateSerializer(data=request.data)
            point_serializer.is_valid(raise_exception=True)
            points_data = [point_serializer.validated_data]
        
        # Get the last known point for anomaly detection
        last_point = session.points.order_by('-recorded_at').first()
        
        created_points = []
        rejected_count = 0
        
        for point_data in points_data:
            lat = float(point_data['latitude'])
            lon = float(point_data['longitude'])
            
            # Security: validate location bounds
            if not validate_location_bounds(lat, lon):
                rejected_count += 1
                continue
            
            # Security: teleportation detection
            if last_point:
                is_teleport = detect_teleportation(
                    float(last_point.latitude), float(last_point.longitude),
                    last_point.recorded_at,
                    lat, lon, point_data['recorded_at'],
                )
                if is_teleport:
                    logger.warning(
                        f"Teleportation rejected: user={request.user.username}, "
                        f"session={session.id}"
                    )
                    rejected_count += 1
                    continue
            
            point = LocationPoint(
                session=session,
                latitude=point_data['latitude'],
                longitude=point_data['longitude'],
                accuracy=point_data.get('accuracy'),
                speed=point_data.get('speed'),
                heading=point_data.get('heading'),
                altitude=point_data.get('altitude'),
                recorded_at=point_data['recorded_at'],
            )
            created_points.append(point)
            last_point = point  # Use for next iteration's anomaly check
        
        # Bulk create for performance
        if created_points:
            LocationPoint.objects.bulk_create(created_points)
        
        return Response({
            'accepted': len(created_points),
            'rejected': rejected_count,
        }, status=status.HTTP_201_CREATED)


class LiveTrackingView(APIView):
    """
    Get real-time positions of all active tracking sessions.
    
    Admin/manager: see all active vehicles
    Chauffeur: see only own position
    
    Security:
    - Role-based data filtering
    - Minimal data exposure (no IP, user agent, etc.)
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        """Get all active vehicle positions."""
        user = request.user
        
        # Get active sessions with their latest point
        sessions_qs = TrackingSession.objects.filter(
            is_active=True
        ).select_related('vehicle', 'user', 'user__driver_profile')
        
        # Role-based filtering
        if user.rol == 'chauffeur':
            sessions_qs = sessions_qs.filter(user=user)
        
        results = []
        for session in sessions_qs:
            last_point = session.points.order_by('-recorded_at').first()
            if not last_point:
                continue
            
            # Get driver name
            user_name = ''
            if hasattr(session.user, 'driver_profile') and session.user.driver_profile:
                user_name = session.user.driver_profile.naam
            else:
                user_name = session.user.get_full_name() or session.user.username
            
            results.append({
                'session_id': session.id,
                'user_name': user_name,
                'vehicle_id': session.vehicle_id,
                'vehicle_kenteken': session.vehicle.kenteken if session.vehicle else None,
                'vehicle_ritnummer': session.vehicle.ritnummer if session.vehicle else None,
                'vehicle_type': session.vehicle.type_wagen if session.vehicle else None,
                'latitude': float(last_point.latitude),
                'longitude': float(last_point.longitude),
                'speed': last_point.speed,
                'heading': last_point.heading,
                'accuracy': last_point.accuracy,
                'recorded_at': last_point.recorded_at,
                'is_active': True,
            })
        
        serializer = LiveVehicleSerializer(results, many=True)
        return Response(serializer.data)


class RouteHistoryView(APIView):
    """
    Get route history for a specific session or date range.
    
    Admin/manager: access all sessions
    Chauffeur: access only own sessions
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request, session_id=None):
        """Get route history for a session."""
        user = request.user
        
        if session_id:
            try:
                session = TrackingSession.objects.select_related(
                    'vehicle', 'user', 'user__driver_profile'
                ).get(id=session_id)
            except TrackingSession.DoesNotExist:
                return Response(
                    {'detail': 'Session not found.'},
                    status=status.HTTP_404_NOT_FOUND,
                )
            
            # Security: enforce ownership for chauffeurs
            if user.rol == 'chauffeur' and session.user_id != user.id:
                return Response(
                    {'detail': 'Not authorized.'},
                    status=status.HTTP_403_FORBIDDEN,
                )
            
            points = session.points.order_by('recorded_at')
            distance = calculate_route_distance(points)
            
            return Response({
                'session': TrackingSessionSerializer(session).data,
                'points': LocationPointSerializer(points, many=True).data,
                'total_points': points.count(),
                'distance_km': distance,
            })
        
        # List sessions (most recent first)
        sessions_qs = TrackingSession.objects.select_related(
            'vehicle', 'user', 'user__driver_profile'
        ).order_by('-started_at')
        
        if user.rol == 'chauffeur':
            sessions_qs = sessions_qs.filter(user=user)
        
        # Optional filters
        vehicle_id = request.query_params.get('vehicle')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        
        if vehicle_id:
            sessions_qs = sessions_qs.filter(vehicle_id=vehicle_id)
        if date_from:
            sessions_qs = sessions_qs.filter(started_at__date__gte=date_from)
        if date_to:
            sessions_qs = sessions_qs.filter(started_at__date__lte=date_to)
        
        sessions_qs = sessions_qs[:50]  # Limit to 50 sessions
        
        serializer = TrackingSessionSerializer(sessions_qs, many=True)
        return Response(serializer.data)


class TrackingVehiclesView(APIView):
    """
    Get list of vehicles available for tracking assignment.
    Used in the vehicle monitor dropdown.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        """Get vehicles for tracking assignment."""
        try:
            from apps.fleet.models import Vehicle
            vehicles = Vehicle.objects.all().order_by('kenteken').values(
                'id', 'kenteken', 'type_wagen', 'ritnummer',
            )
            return Response(list(vehicles))
        except Exception as e:
            logger.error(f"Failed to load tracking vehicles: {e}")
            return Response([], status=status.HTTP_200_OK)


class AssignedVehicleView(APIView):
    """
    Get the vehicle assigned to the current logged-in driver.
    Returns the vehicle linked via Driver.voertuig → Driver.gekoppelde_gebruiker.
    """
    permission_classes = [IsAuthenticated]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        """Get the assigned vehicle for the current user."""
        try:
            from apps.drivers.models import Driver
            driver = Driver.objects.select_related('voertuig').filter(
                gekoppelde_gebruiker=request.user
            ).first()

            if not driver or not driver.voertuig:
                return Response({'assigned': False}, status=status.HTTP_200_OK)

            vehicle = driver.voertuig
            return Response({
                'assigned': True,
                'vehicle': {
                    'id': str(vehicle.id),
                    'kenteken': vehicle.kenteken,
                    'type_wagen': vehicle.type_wagen,
                    'ritnummer': vehicle.ritnummer,
                },
                'driver_naam': driver.naam,
            })
        except Exception as e:
            logger.error(f"Failed to load assigned vehicle: {e}")
            return Response({'assigned': False}, status=status.HTTP_200_OK)

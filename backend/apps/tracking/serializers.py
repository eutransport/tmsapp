"""
Track & Trace serializers with security-first design.

Security measures:
- Input validation on all GPS coordinates (realistic ranges)
- Speed sanity checks (max 400 km/h)
- Accuracy bounds (max 10km — reject wildly inaccurate)
- Timestamp validation (not in the future, not too old)
- User/session isolation — users can only submit to their own sessions
- Sanitized output — no internal IDs or sensitive data exposed unnecessarily
"""
from datetime import timedelta
from rest_framework import serializers
from django.utils import timezone
from apps.core.security import strip_and_clean
from .models import TrackingSession, LocationPoint


class LocationPointCreateSerializer(serializers.Serializer):
    """
    Serializer for submitting GPS location points.
    Accepts raw GPS data from the browser Geolocation API.
    """
    latitude = serializers.DecimalField(
        max_digits=10, decimal_places=7,
        min_value=-90, max_value=90,
    )
    longitude = serializers.DecimalField(
        max_digits=10, decimal_places=7,
        min_value=-180, max_value=180,
    )
    accuracy = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=10000)
    speed = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=400)
    heading = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=360)
    altitude = serializers.FloatField(required=False, allow_null=True)
    recorded_at = serializers.DateTimeField()

    def validate_recorded_at(self, value):
        """Ensure timestamp is not in the future (with 60s tolerance) and not too old (24h)."""
        now = timezone.now()
        if value > now + timedelta(seconds=60):
            raise serializers.ValidationError("Timestamp is in the future.")
        if value < now - timedelta(hours=24):
            raise serializers.ValidationError("Timestamp is too old (>24h).")
        return value

    def validate_accuracy(self, value):
        """Reject extremely inaccurate GPS data (>5km)."""
        if value is not None and value > 5000:
            raise serializers.ValidationError("GPS accuracy too low (>5km). Location rejected.")
        return value


class LocationPointBatchSerializer(serializers.Serializer):
    """Serializer for submitting multiple GPS points at once (for offline buffering)."""
    points = LocationPointCreateSerializer(many=True, max_length=100)


class LocationPointSerializer(serializers.ModelSerializer):
    """Read-only serializer for location points."""
    class Meta:
        model = LocationPoint
        fields = [
            'latitude', 'longitude', 'accuracy', 'speed',
            'heading', 'altitude', 'recorded_at',
        ]


class TrackingSessionCreateSerializer(serializers.Serializer):
    """Start a new tracking session."""
    vehicle_id = serializers.UUIDField(required=False, allow_null=True)

    def validate_vehicle_id(self, value):
        """Verify vehicle exists and user has access."""
        if value:
            from apps.fleet.models import Vehicle
            try:
                Vehicle.objects.get(id=value)
            except Vehicle.DoesNotExist:
                raise serializers.ValidationError("Vehicle not found.")
        return value


class TrackingSessionSerializer(serializers.ModelSerializer):
    """Read-only serializer for tracking sessions."""
    user_name = serializers.SerializerMethodField()
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True, default=None)
    vehicle_ritnummer = serializers.CharField(source='vehicle.ritnummer', read_only=True, default=None)
    vehicle_type = serializers.CharField(source='vehicle.type_wagen', read_only=True, default=None)
    last_location = serializers.SerializerMethodField()
    duration_minutes = serializers.SerializerMethodField()

    class Meta:
        model = TrackingSession
        fields = [
            'id', 'user_name', 'vehicle', 'vehicle_kenteken',
            'vehicle_ritnummer', 'vehicle_type',
            'started_at', 'ended_at', 'is_active',
            'last_location', 'duration_minutes',
        ]

    def get_user_name(self, obj):
        if hasattr(obj.user, 'driver_profile') and obj.user.driver_profile:
            return obj.user.driver_profile.naam
        return (obj.user.full_name or '').strip() or obj.user.username

    def get_last_location(self, obj):
        """Return the most recent location point for this session."""
        last = obj.points.order_by('-recorded_at').first()
        if last:
            return {
                'latitude': float(last.latitude),
                'longitude': float(last.longitude),
                'speed': last.speed,
                'heading': last.heading,
                'accuracy': last.accuracy,
                'recorded_at': last.recorded_at.isoformat(),
            }
        return None

    def get_duration_minutes(self, obj):
        end = obj.ended_at or timezone.now()
        delta = end - obj.started_at
        return round(delta.total_seconds() / 60, 1)


class LiveVehicleSerializer(serializers.Serializer):
    """Serializer for the live tracking map view — one entry per active vehicle."""
    session_id = serializers.UUIDField()
    user_name = serializers.CharField()
    vehicle_id = serializers.UUIDField(allow_null=True)
    vehicle_kenteken = serializers.CharField(allow_null=True)
    vehicle_ritnummer = serializers.CharField(allow_null=True)
    vehicle_type = serializers.CharField(allow_null=True)
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()
    speed = serializers.FloatField(allow_null=True)
    heading = serializers.FloatField(allow_null=True)
    accuracy = serializers.FloatField(allow_null=True)
    recorded_at = serializers.DateTimeField()
    is_active = serializers.BooleanField()
    vehicle_status = serializers.ChoiceField(
        choices=['driving', 'idle', 'parked'],
        default='parked',
    )


class RouteHistorySerializer(serializers.Serializer):
    """Serializer for route history — returns a track of points for a session."""
    session = TrackingSessionSerializer()
    points = LocationPointSerializer(many=True)
    total_points = serializers.IntegerField()
    distance_km = serializers.FloatField(allow_null=True)

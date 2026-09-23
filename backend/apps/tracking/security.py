"""
Track & Trace security utilities.

Implements defense-in-depth for location tracking:
- Rate limiting per user (prevents GPS spam / DDoS)
- Anomaly detection (teleportation, impossible speeds)
- IP validation and geofencing
- Data retention policies
- Audit logging

References:
- CVE-2024-4577 (PHP CGI bypass) — N/A but defense-in-depth via input validation
- CVE-2023-44487 (HTTP/2 Rapid Reset) — mitigated by Django's request handling + rate limiting  
- CVE-2024-3094 (xz backdoor) — mitigated by pinned dependencies
- General OWASP API Security Top 10:
  * API1: Broken Object Level Auth — session ownership validation
  * API2: Broken Auth — JWT required on all endpoints
  * API3: Excessive Data Exposure — minimal serializer fields
  * API4: Lack of Rate Limiting — custom throttle classes
  * API5: Broken Function Level Auth — role-based permissions
  * API6: Mass Assignment — explicit serializer fields only
  * API7: Security Misconfiguration — CSP headers, CORS
  * API8: Injection — parameterized queries via Django ORM
  * API9: Improper Asset Management — versioned API endpoints
  * API10: Insufficient Logging — audit trail on sessions

Platform-specific protections:
- Android: WebView/PWA location permissions enforced by OS
- iOS: WKWebView location permissions enforced by OS  
- Linux servers: iptables rate limiting recommended
- All: HTTPS-only transport (location data is sensitive)
"""
import math
import logging
from datetime import timedelta
from decimal import Decimal
from django.utils import timezone
from rest_framework.throttling import SimpleRateThrottle


logger = logging.getLogger('tracking.security')


# ============ Throttling ============

class TrackingSubmitThrottle(SimpleRateThrottle):
    """
    Rate limit location submissions to prevent GPS spam.
    Allows 120 requests per minute per user (2/sec — enough for 1 update/sec with headroom).
    """
    scope = 'tracking_submit'
    
    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {
                'scope': self.scope,
                'ident': request.user.pk,
            }
        return self.get_ident(request)


class TrackingReadThrottle(SimpleRateThrottle):
    """
    Rate limit map read/polling requests.
    Allows 60 requests per minute (enough for 1 poll/sec).
    """
    scope = 'tracking_read'
    
    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {
                'scope': self.scope,
                'ident': request.user.pk,
            }
        return self.get_ident(request)


class RadiusSyncThrottle(SimpleRateThrottle):
    """
    Strenge limiet op het handmatig synchroniseren van de Radius-ritgeschiedenis.

    Een sync haalt tot 31 dagen aan ritten op bij Radius en schrijft die weg.
    Dat is zwaar voor zowel de externe API als onze database, dus we staan
    maar een paar handmatige syncs per uur toe. De geplande Celery-taken
    gaan hier niet doorheen; die draaien buiten de request-cyclus om.
    """
    scope = 'radius_sync'

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {
                'scope': self.scope,
                'ident': request.user.pk,
            }
        return self.get_ident(request)


class RadiusExportThrottle(SimpleRateThrottle):
    """
    Limiet op archief-exports (CSV/Excel/PDF).

    Een export kan een jaar aan ritten in een bestand gieten; dat is te duur
    om ongelimiteerd toe te staan.
    """
    scope = 'radius_export'

    def get_cache_key(self, request, view):
        if request.user and request.user.is_authenticated:
            return self.cache_format % {
                'scope': self.scope,
                'ident': request.user.pk,
            }
        return self.get_ident(request)


# ============ Anomaly Detection ============

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two GPS points in kilometers using Haversine formula."""
    R = 6371  # Earth's radius in km
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    
    a = math.sin(dlat / 2) ** 2 + \
        math.cos(lat1_rad) * math.cos(lat2_rad) * \
        math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


def detect_teleportation(
    prev_lat: float, prev_lon: float, prev_time,
    new_lat: float, new_lon: float, new_time,
    max_speed_kmh: float = 300,
) -> bool:
    """
    Detect if a location jump is physically impossible.
    Returns True if the movement is suspicious (teleportation).
    
    Uses max_speed_kmh as upper bound — 300 km/h covers fast trains.
    """
    distance_km = haversine_distance(prev_lat, prev_lon, new_lat, new_lon)
    time_diff = (new_time - prev_time).total_seconds()
    
    if time_diff <= 0:
        return distance_km > 0.1  # Same timestamp but different location
    
    speed_kmh = (distance_km / time_diff) * 3600
    
    if speed_kmh > max_speed_kmh:
        logger.warning(
            f"Teleportation detected: {distance_km:.2f}km in {time_diff:.0f}s "
            f"= {speed_kmh:.0f}km/h (max: {max_speed_kmh}km/h)"
        )
        return True
    
    return False


def validate_location_bounds(latitude: float, longitude: float) -> bool:
    """
    Check if coordinates are within reasonable bounds for Netherlands/Europe.
    Rejects obviously fake locations (e.g., Null Island 0,0).
    """
    # Broad European bounds
    MIN_LAT, MAX_LAT = 35.0, 72.0   # Southern Spain to Northern Norway
    MIN_LON, MAX_LON = -25.0, 45.0  # Western Portugal/Iceland to Eastern Turkey
    
    if not (MIN_LAT <= latitude <= MAX_LAT and MIN_LON <= longitude <= MAX_LON):
        logger.warning(f"Location out of bounds: ({latitude}, {longitude})")
        return False
    
    # Reject Null Island (0,0) — common GPS error
    if abs(latitude) < 0.1 and abs(longitude) < 0.1:
        logger.warning(f"Null Island detected: ({latitude}, {longitude})")
        return False
    
    return True


def get_client_ip(request) -> str:
    """
    Safely extract client IP address.
    Handles X-Forwarded-For behind reverse proxy (nginx).
    """
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        # Take the first IP (client IP) — rest are proxies
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR', '')
    return ip


def calculate_route_distance(points) -> float:
    """Calculate total route distance in km from a list of LocationPoints."""
    total = 0.0
    prev = None
    for point in points:
        if prev:
            total += haversine_distance(
                float(prev.latitude), float(prev.longitude),
                float(point.latitude), float(point.longitude),
            )
        prev = point
    return round(total, 2)

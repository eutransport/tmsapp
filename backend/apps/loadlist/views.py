from __future__ import annotations

import logging
import re
from datetime import time as _time

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle
from rest_framework import permissions

from apps.core.permissions import HasReadWriteModulePermission

from .models import Depot, LoadList, LoadStop
from .serializers import (
    DepotSerializer,
    LoadListCreateSerializer,
    LoadListSerializer,
    LoadStopSerializer,
    LoadStopWriteSerializer,
)
from .services.extraction import extract_stops_from_image
from .services.geocoding import geocode, suggest as address_suggest
from .services.osrm import road_matrix
from .services.routing import optimize_with_windows

logger = logging.getLogger(__name__)


def _parse_time_field(value) -> _time | None:
    """Convert an 'HH:MM' string (from AI extraction) into a datetime.time."""
    if not value:
        return None
    s = str(value).strip()
    if len(s) < 4 or ':' not in s:
        return None
    try:
        h, m = s.split(':', 1)
        return _time(int(h), int(m[:2]))
    except (ValueError, TypeError):
        return None


def _time_to_minutes(value) -> int | None:
    """datetime.time -> minutes since midnight, or None."""
    if value is None:
        return None
    try:
        return value.hour * 60 + value.minute
    except AttributeError:
        return None


# --- address cleaning for geocoder ------------------------------------------
# OCR often prefixes lines with the row number ("01.", "10.", "@1."). Strip
# that before sending to Nominatim, otherwise the search fails.
_ROW_PREFIX_RE = re.compile(r'^\s*[@0-9OoIl]{1,3}[\.\)]\s*')
_POSTCODE_NL_RE = re.compile(r'\b\d{4}\s?[A-Z]{2}\b', re.IGNORECASE)
_HOUSENR_RE = re.compile(r'\b(\d{1,5}[A-Za-z]?)\b')


def _clean_street(raw: str) -> str:
    """Remove '01. ', '@1. ', '18) ' style prefixes and collapse whitespace."""
    if not raw:
        return ''
    s = _ROW_PREFIX_RE.sub('', raw).strip()
    # Also strip any embedded postcode from the "street" portion — we add it
    # back separately in the geocode query.
    s = _POSTCODE_NL_RE.sub('', s).strip(' ,')
    return re.sub(r'\s+', ' ', s)


def _build_geocode_queries(stop) -> list[str]:
    """Return a list of candidate queries, most specific first."""
    cleaned = _clean_street(stop.address_raw)
    pc = (stop.postcode or '').strip().upper()
    city = (stop.city or '').strip()
    country = (stop.country or 'Netherlands').strip() or 'Netherlands'

    queries: list[str] = []
    # 1. Full: cleaned street + postcode + city
    parts = [p for p in [cleaned, pc, city, country] if p]
    if cleaned:
        queries.append(', '.join(parts))
    # 2. Postcode + house number + city (NL: near-unique)
    house = None
    if cleaned:
        m = _HOUSENR_RE.search(cleaned)
        if m:
            house = m.group(1)
    if pc and house:
        queries.append(f'{pc} {house}, {country}')
    # 3. Postcode + city (coarse fallback)
    if pc and city:
        queries.append(f'{pc} {city}, {country}')
    # 4. Cleaned street + city
    if cleaned and city:
        queries.append(f'{cleaned}, {city}, {country}')
    # De-dupe preserving order
    seen: set[str] = set()
    out: list[str] = []
    for q in queries:
        k = q.lower()
        if k not in seen:
            seen.add(k)
            out.append(q)
    return out


class UploadThrottle(UserRateThrottle):
    """Limit uploads: OCR + LLM is expensive; guard against runaway costs."""
    scope = 'loadlist_upload'
    rate = '20/hour'


class OptimizeThrottle(UserRateThrottle):
    scope = 'loadlist_optimize'
    rate = '60/hour'


class SuggestThrottle(UserRateThrottle):
    scope = 'loadlist_suggest'
    rate = '120/hour'


class LoadListViewSet(viewsets.ModelViewSet):
    """CRUD + upload + optimize.

    Access is scoped to `request.user`. Admins can see all rows.
    """
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_loadlist'
    module_permission_write = 'manage_loadlist'
    parser_classes = [MultiPartParser, FormParser, JSONParser]
    serializer_class = LoadListSerializer

    def get_queryset(self):
        qs = LoadList.objects.all().prefetch_related('stops')
        user = self.request.user
        if user.is_superuser or getattr(user, 'rol', '') == 'admin':
            return qs
        return qs.filter(owner=user)

    def get_serializer_class(self):
        if self.action == 'create':
            return LoadListCreateSerializer
        return LoadListSerializer

    def get_throttles(self):
        if self.action == 'create':
            return [UploadThrottle()]
        if self.action in ('optimize', 'reparse'):
            return [OptimizeThrottle()]
        if self.action == 'suggest_address':
            return [SuggestThrottle()]
        return super().get_throttles()

    # -- address autocomplete ------------------------------------------------

    @action(detail=False, methods=['get'], url_path='suggest')
    def suggest_address(self, request):
        q = (request.query_params.get('q') or '').strip()
        results = address_suggest(q)
        return Response([
            {'label': s.label, 'lat': s.lat, 'lng': s.lng} for s in results
        ])

    # -- create: upload + extract -------------------------------------------

    def create(self, request, *args, **kwargs):
        serializer = LoadListCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        photo = serializer.validated_data['photo']

        # Read once — we need the bytes for extraction, and Django will
        # then save the file back to storage on the model instance.
        try:
            raw = photo.read()
        except Exception as exc:
            return Response({'detail': f'Kon bestand niet lezen: {exc}'},
                            status=status.HTTP_400_BAD_REQUEST)
        photo.seek(0)

        with transaction.atomic():
            loadlist = LoadList.objects.create(
                owner=request.user,
                name=serializer.validated_data.get('name', '') or '',
                start_address=serializer.validated_data.get('start_address', '') or '',
                start_time=serializer.validated_data.get('start_time'),
                end_time=serializer.validated_data.get('end_time'),
                photo=photo,
                status='parsing',
            )

        try:
            result = extract_stops_from_image(raw)
        except ValueError as exc:
            loadlist.status = 'error'
            loadlist.status_message = str(exc)[:500]
            loadlist.save(update_fields=['status', 'status_message', 'updated_at'])
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as exc:  # pragma: no cover — defensive
            logger.exception('LoadList extraction crashed')
            loadlist.status = 'error'
            loadlist.status_message = 'Verwerking mislukt.'
            loadlist.save(update_fields=['status', 'status_message', 'updated_at'])
            return Response({'detail': 'Verwerking mislukt.'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        with transaction.atomic():
            LoadStop.objects.bulk_create([
                LoadStop(
                    loadlist=loadlist,
                    original_sequence=i,
                    address_raw=s.address_raw,
                    postcode=s.postcode,
                    city=s.city,
                    country=s.country,
                    reference=s.reference,
                    colli=s.colli,
                    pallets=s.pallets,
                    weight_kg=s.weight_kg,
                    notes=s.notes,
                    time_window_start=_parse_time_field(getattr(s, 'time_window_start', '')),
                    time_window_end=_parse_time_field(getattr(s, 'time_window_end', '')),
                )
                for i, s in enumerate(result.stops)
            ])
            loadlist.status = 'parsed'
            loadlist.status_message = (
                f'{len(result.stops)} stops ingelezen.'
                if result.stops else
                'Geen adressen herkend. Voeg ze handmatig toe of upload een scherpere foto.'
            )
            loadlist.raw_ocr_text = result.raw_text
            loadlist.extraction_provider = result.provider
            loadlist.save(update_fields=[
                'status', 'status_message', 'raw_ocr_text',
                'extraction_provider', 'updated_at',
            ])

        out = LoadListSerializer(loadlist, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    # -- update depot / name -------------------------------------------------

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        allowed = {'name', 'start_address', 'start_time', 'end_time'}
        data = {k: v for k, v in request.data.items() if k in allowed}
        if 'name' in data:
            instance.name = (data['name'] or '').strip()[:120]
        if 'start_address' in data:
            addr = (data['start_address'] or '').strip()[:250]
            if addr != instance.start_address:
                instance.start_address = addr
                # Depot changed → cached coords no longer valid
                instance.start_lat = None
                instance.start_lng = None
        if 'start_time' in data:
            instance.start_time = _parse_time_field(data['start_time']) if data['start_time'] else None
        if 'end_time' in data:
            instance.end_time = _parse_time_field(data['end_time']) if data['end_time'] else None
        instance.save()
        return Response(LoadListSerializer(instance, context={'request': request}).data)

    # -- stop editing --------------------------------------------------------

    @action(detail=True, methods=['patch'], url_path=r'stops/(?P<stop_id>[0-9a-f-]+)')
    def update_stop(self, request, pk=None, stop_id: str = ''):
        loadlist = self.get_object()
        try:
            stop = loadlist.stops.get(id=stop_id)
        except LoadStop.DoesNotExist:
            return Response({'detail': 'Stop niet gevonden.'}, status=404)

        serializer = LoadStopWriteSerializer(stop, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        stop = serializer.save()

        # Editing the address invalidates prior geocode / optimisation.
        if any(f in serializer.validated_data for f in ('address_raw', 'postcode', 'city', 'country')):
            LoadStop.objects.filter(id=stop.id).update(
                lat=None, lng=None, geocode_confidence='', geocode_error='',
                delivery_sequence=None, load_sequence=None,
            )
            LoadList.objects.filter(id=loadlist.id).update(
                status='parsed', total_distance_m=None, total_duration_s=None,
                status_message='Adres gewijzigd — optimaliseer opnieuw.',
            )
        stop.refresh_from_db()
        return Response(LoadStopSerializer(stop).data)

    @action(detail=True, methods=['delete'], url_path=r'stops/(?P<stop_id>[0-9a-f-]+)/remove')
    def delete_stop(self, request, pk=None, stop_id: str = ''):
        loadlist = self.get_object()
        deleted, _ = loadlist.stops.filter(id=stop_id).delete()
        if not deleted:
            return Response({'detail': 'Stop niet gevonden.'}, status=404)
        return Response(status=204)

    @action(detail=True, methods=['post'], url_path='stops/add')
    def add_stop(self, request, pk=None):
        loadlist = self.get_object()
        serializer = LoadStopWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Cap at MAX_STOPS to match extraction limit.
        if loadlist.stops.count() >= 200:
            return Response({'detail': 'Maximaal 200 stops per lijst.'}, status=400)
        last = loadlist.stops.order_by('-original_sequence').first()
        next_seq = (last.original_sequence + 1) if last else 0
        stop = LoadStop.objects.create(
            loadlist=loadlist,
            original_sequence=next_seq,
            **serializer.validated_data,
        )
        return Response(LoadStopSerializer(stop).data, status=201)

    # -- append: upload additional photo, extend the same list --------------

    @action(detail=True, methods=['post'], url_path='append',
            parser_classes=[MultiPartParser, FormParser])
    def append_photo(self, request, pk=None):
        """Extract stops from another photo and append them to this list.
        Used by the wizard to allow multiple uploads per laadlijst.
        """
        loadlist = self.get_object()
        photo = request.FILES.get('photo')
        if not photo:
            return Response({'detail': 'Geen foto meegestuurd.'}, status=400)

        try:
            raw = photo.read()
        except Exception as exc:
            return Response({'detail': f'Kon bestand niet lezen: {exc}'}, status=400)

        try:
            result = extract_stops_from_image(raw)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=400)
        except Exception:
            logger.exception('LoadList append extraction crashed')
            return Response({'detail': 'Verwerking mislukt.'}, status=500)

        last = loadlist.stops.order_by('-original_sequence').first()
        next_seq = (last.original_sequence + 1) if last else 0
        current_count = loadlist.stops.count()
        available = 200 - current_count
        to_create = result.stops[:max(0, available)]

        with transaction.atomic():
            LoadStop.objects.bulk_create([
                LoadStop(
                    loadlist=loadlist,
                    original_sequence=next_seq + i,
                    address_raw=s.address_raw,
                    postcode=s.postcode,
                    city=s.city,
                    country=s.country,
                    reference=s.reference,
                    colli=s.colli,
                    pallets=s.pallets,
                    weight_kg=s.weight_kg,
                    notes=s.notes,
                    time_window_start=_parse_time_field(getattr(s, 'time_window_start', '')),
                    time_window_end=_parse_time_field(getattr(s, 'time_window_end', '')),
                )
                for i, s in enumerate(to_create)
            ])
            # New photo invalidates the current optimisation.
            loadlist.status = 'parsed'
            loadlist.status_message = (
                f'{len(to_create)} stops toegevoegd (totaal {current_count + len(to_create)}).'
            )
            loadlist.total_distance_m = None
            loadlist.total_duration_s = None
            loadlist.save(update_fields=[
                'status', 'status_message',
                'total_distance_m', 'total_duration_s', 'updated_at',
            ])

        return Response(
            LoadListSerializer(loadlist, context={'request': request}).data,
            status=200,
        )

    # -- optimize ------------------------------------------------------------

    @action(detail=True, methods=['post'])
    def optimize(self, request, pk=None):
        loadlist = self.get_object()
        if not loadlist.start_address.strip():
            return Response({'detail': 'Vul eerst een startadres in.'}, status=400)

        LoadList.objects.filter(id=loadlist.id).update(
            status='optimizing', status_message='Bezig met adressen opzoeken…'
        )

        # Geocode depot
        depot = geocode(loadlist.start_address)
        if not depot:
            LoadList.objects.filter(id=loadlist.id).update(
                status='error',
                status_message='Startadres niet gevonden. Controleer het adres.',
            )
            return Response({'detail': 'Startadres niet gevonden.'}, status=400)

        loadlist.start_lat = depot.lat
        loadlist.start_lng = depot.lng

        # Geocode stops (missing coords only)
        stops = list(loadlist.stops.all().order_by('original_sequence'))
        if not stops:
            LoadList.objects.filter(id=loadlist.id).update(
                status='error', status_message='Geen stops om te optimaliseren.'
            )
            return Response({'detail': 'Geen stops.'}, status=400)

        failed: list[str] = []
        for stop in stops:
            if stop.lat is not None and stop.lng is not None:
                continue
            gr = None
            for query in _build_geocode_queries(stop):
                gr = geocode(query, country_hint=stop.country or 'nl')
                if gr:
                    break
            if gr:
                stop.lat = gr.lat
                stop.lng = gr.lng
                stop.address_formatted = gr.formatted
                stop.geocode_confidence = gr.confidence
                stop.geocode_error = ''
            else:
                stop.geocode_error = 'Adres niet gevonden'
                failed.append(stop.address_raw[:60])

        # Persist geocode results
        for s in stops:
            s.save(update_fields=[
                'lat', 'lng', 'address_formatted',
                'geocode_confidence', 'geocode_error',
            ])

        locatable = [s for s in stops if s.lat is not None and s.lng is not None]
        if not locatable:
            LoadList.objects.filter(id=loadlist.id).update(
                status='error',
                status_message='Geen enkel adres kon worden gevonden.',
            )
            return Response({'detail': 'Geen enkel adres kon worden gevonden.'}, status=400)

        # Build a road-distance matrix so the optimiser uses real driving
        # distance (via OSRM) instead of bird's-eye — this prevents zigzag
        # in dense urban clusters like Amsterdam/Schiphol.
        depot_pt = (depot.lat, depot.lng)
        stop_pts = [(s.lat, s.lng) for s in locatable]
        dist_matrix, dur_matrix, matrix_source = road_matrix([depot_pt] + stop_pts)

        # Optimize
        delivery_order, total_m, total_s = optimize_with_windows(
            depot_pt,
            [
                (
                    (s.lat, s.lng),
                    _time_to_minutes(s.time_window_start),
                    _time_to_minutes(s.time_window_end),
                )
                for s in locatable
            ],
            distance_matrix=dist_matrix or None,
            duration_matrix=dur_matrix or None,
        )

        # Assign sequences. delivery_order returns indices into `locatable`.
        # Load order is the reverse of delivery order: first delivery goes at
        # the back of the trailer (loaded last, comes off first).
        n = len(delivery_order)
        for delivery_pos, orig_idx in enumerate(delivery_order):
            s = locatable[orig_idx]
            s.delivery_sequence = delivery_pos
            s.load_sequence = (n - 1) - delivery_pos
        # Stops that failed geocoding get no sequence.
        for s in stops:
            if s.lat is None or s.lng is None:
                s.delivery_sequence = None
                s.load_sequence = None
        for s in stops:
            s.save(update_fields=['delivery_sequence', 'load_sequence'])

        msg = f'Route berekend voor {n} stops.'
        if failed:
            msg += f' Niet gevonden: {len(failed)}.'

        # Distance/time info
        km = total_m / 1000.0
        msg += f' Afstand: {km:.1f} km.'
        service_min_per_stop = 10  # loss/opladen tijd per stop
        drive_min = int(round(total_s / 60.0))
        service_min = n * service_min_per_stop
        total_min = drive_min + service_min
        hours = total_min // 60
        mins = total_min % 60
        msg += f' Rijtijd ~{drive_min} min + {service_min} min lossen = {hours}u{mins:02d}.'

        # Check against global start_time / end_time window if configured.
        window_warning = None
        if loadlist.start_time and loadlist.end_time:
            available_min = (
                loadlist.end_time.hour * 60 + loadlist.end_time.minute
                - loadlist.start_time.hour * 60 - loadlist.start_time.minute
            )
            if available_min > 0 and total_min > available_min:
                over = total_min - available_min
                window_warning = (
                    f'Let op: route duurt {hours}u{mins:02d}, dat is '
                    f'{over} min langer dan het venster '
                    f'{loadlist.start_time.strftime("%H:%M")}–'
                    f'{loadlist.end_time.strftime("%H:%M")}.'
                )
                msg += ' ' + window_warning

        if matrix_source == 'haversine':
            msg += ' (Wegafstand niet beschikbaar; hemelsbrede schatting gebruikt.)'

        loadlist.total_distance_m = int(round(total_m))
        loadlist.status = 'optimized'
        loadlist.status_message = msg
        loadlist.save(update_fields=[
            'start_lat', 'start_lng', 'total_distance_m',
            'status', 'status_message', 'updated_at',
        ])

        # Refetch to bust the prefetch cache — otherwise the serializer would
        # return the pre-mutation stops (missing the new sequences).
        loadlist = LoadList.objects.prefetch_related('stops').get(id=loadlist.id)
        return Response(LoadListSerializer(loadlist, context={'request': request}).data)



class IsAdminOrReadOnly(permissions.BasePermission):
    """Everyone signed in can list depots; only admins/superusers may write."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in permissions.SAFE_METHODS:
            return True
        return bool(
            request.user.is_superuser
            or getattr(request.user, 'rol', '') == 'admin'
        )


class DepotViewSet(viewsets.ModelViewSet):
    """Named depots configured by admins, selectable by any user."""
    permission_classes = [IsAdminOrReadOnly]
    serializer_class = DepotSerializer
    queryset = Depot.objects.all()

    def get_queryset(self):
        qs = Depot.objects.all()
        # Non-admins only see active depots.
        user = self.request.user
        is_admin = bool(user.is_superuser or getattr(user, 'rol', '') == 'admin')
        if not is_admin:
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

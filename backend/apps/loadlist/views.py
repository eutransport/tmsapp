from __future__ import annotations

import logging

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle

from .models import LoadList, LoadStop
from .serializers import (
    LoadListCreateSerializer,
    LoadListSerializer,
    LoadStopSerializer,
    LoadStopWriteSerializer,
)
from .services.extraction import extract_stops_from_image
from .services.geocoding import geocode
from .services.routing import optimize

logger = logging.getLogger(__name__)


class UploadThrottle(UserRateThrottle):
    """Limit uploads: OCR + LLM is expensive; guard against runaway costs."""
    scope = 'loadlist_upload'
    rate = '20/hour'


class OptimizeThrottle(UserRateThrottle):
    scope = 'loadlist_optimize'
    rate = '60/hour'


class LoadListViewSet(viewsets.ModelViewSet):
    """CRUD + upload + optimize.

    Access is scoped to `request.user`. Admins can see all rows.
    """
    permission_classes = [IsAuthenticated]
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
        return super().get_throttles()

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
        allowed = {'name', 'start_address'}
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
            query_parts = [stop.address_raw]
            if stop.postcode and stop.postcode not in stop.address_raw:
                query_parts.append(stop.postcode)
            if stop.city and stop.city not in stop.address_raw:
                query_parts.append(stop.city)
            query = ', '.join(p for p in query_parts if p)
            gr = geocode(query, country_hint=stop.country)
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

        # Optimize
        delivery_order, total_m = optimize(
            (depot.lat, depot.lng),
            [(s.lat, s.lng) for s in locatable],
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

        loadlist.total_distance_m = int(round(total_m))
        loadlist.status = 'optimized'
        loadlist.status_message = msg
        loadlist.save(update_fields=[
            'start_lat', 'start_lng', 'total_distance_m',
            'status', 'status_message', 'updated_at',
        ])

        return Response(LoadListSerializer(loadlist, context={'request': request}).data)

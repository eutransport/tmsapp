"""API views voor de tolheffing-module."""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable

from django.db.models import DecimalField, Sum, Value, Q
from django.db.models.functions import Coalesce
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission
from apps.fleet.models import Vehicle
from apps.invoicing.models import Invoice, InvoiceLine

from .models import PrivateTollRegistration, TollingEvent, TollingImportBatch, normalize_plate
from .serializers import (
    PrivateTollRegistrationSerializer,
    TollingEventSerializer,
    TollingImportBatchSerializer,
)
from .services import (
    export_events_pdf,
    export_events_xlsx,
    import_csv,
    match_private_registration_to_events,
    unmatch_private_registration,
)

logger = logging.getLogger(__name__)


# --------- period helpers ---------

def _month_range(year: int, month: int) -> tuple[datetime, datetime]:
    tz = timezone.get_current_timezone()
    start = timezone.make_aware(datetime(year, month, 1), tz)
    if month == 12:
        end = timezone.make_aware(datetime(year + 1, 1, 1), tz)
    else:
        end = timezone.make_aware(datetime(year, month + 1, 1), tz)
    return start, end


def _week_range(year: int, week: int) -> tuple[datetime, datetime]:
    # ISO week: Monday 00:00 through next Monday 00:00
    tz = timezone.get_current_timezone()
    monday = date.fromisocalendar(year, week, 1)
    start = timezone.make_aware(datetime.combine(monday, datetime.min.time()), tz)
    end = start + timedelta(days=7)
    return start, end


def _shift_month(year: int, month: int, offset: int) -> tuple[int, int]:
    idx = (year * 12 + (month - 1)) + offset
    return idx // 12, (idx % 12) + 1


def _shift_week(year: int, week: int, offset: int) -> tuple[int, int]:
    monday = date.fromisocalendar(year, week, 1) + timedelta(weeks=offset)
    iso = monday.isocalendar()
    return iso[0], iso[1]


def _period_label(period: str, year: int, index: int) -> str:
    if period == 'month':
        month_name = calendar.month_name[index]
        return f"{month_name} {year}"
    return f"Week {index:02d} {year}"


def _parse_bool(value, default: bool = False) -> bool:
    if value is None or value == '':
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def _parse_cutoff_time(value):
    """Parse HH:MM (or HH:MM:SS) into a time object. Returns None if empty/invalid."""
    if not value:
        return None
    from datetime import time as _time
    txt = str(value).strip()
    for fmt in ('%H:%M', '%H:%M:%S'):
        try:
            return datetime.strptime(txt, fmt).time()
        except ValueError:
            continue
    return None


def _resolve_period(data) -> tuple[str, int, int, datetime, datetime, str]:
    """Parse period/year/index from request data (query params or body).

    Accepts:
      - period=week & year & index
      - period=month & year & (index OR month)
      - Backward-compat: year & month (period defaults to 'month')

    Raises ValueError on invalid input. Returns (period, year, index, start, end, label).
    """
    period = (data.get('period') or 'month').lower()
    if period not in ('month', 'week'):
        raise ValueError('period moet "month" of "week" zijn.')

    year_raw = data.get('year')
    if year_raw in (None, ''):
        raise ValueError('year vereist.')
    year = int(year_raw)

    index_raw = data.get('index')
    if index_raw in (None, ''):
        # Backward compat: 'month' key when period=month
        if period == 'month':
            index_raw = data.get('month')
        else:
            index_raw = data.get('week')
    if index_raw in (None, ''):
        raise ValueError('index (of month/week) vereist.')
    index = int(index_raw)

    if period == 'month':
        if not 1 <= index <= 12:
            raise ValueError('month/index moet 1-12 zijn.')
        start, end = _month_range(year, index)
    else:
        if not 1 <= index <= 53:
            raise ValueError('week/index moet 1-53 zijn.')
        start, end = _week_range(year, index)

    label = _period_label(period, year, index)
    return period, year, index, start, end, label


# --------- viewsets ---------

class TollingImportBatchViewSet(viewsets.ReadOnlyModelViewSet):
    """List upload history and upload new batches."""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'
    serializer_class = TollingImportBatchSerializer
    queryset = TollingImportBatch.objects.all()

    @action(detail=False, methods=['post'], url_path='upload')
    def upload(self, request):
        f = request.FILES.get('file')
        if not f:
            return Response({'detail': 'Geen bestand ontvangen.'}, status=400)
        if f.size > 20 * 1024 * 1024:
            return Response({'detail': 'Bestand te groot (max 20 MB).'}, status=400)
        result = import_csv(f, request.user, filename=f.name)
        data = TollingImportBatchSerializer(result.batch).data
        data['result'] = {
            'imported': result.imported,
            'duplicates': result.duplicates,
            'invalid': result.invalid,
            'total': result.total,
        }
        return Response(data, status=status.HTTP_201_CREATED)


class TollingEventViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'
    serializer_class = TollingEventSerializer
    queryset = TollingEvent.objects.all()

    def get_queryset(self):
        qs = super().get_queryset()
        plate = self.request.query_params.get('plate')
        if plate:
            qs = qs.filter(license_plate_normalized=normalize_plate(plate))
        invoiced = self.request.query_params.get('invoiced')
        if invoiced == 'true':
            qs = qs.filter(invoiced_at__isnull=False)
        elif invoiced == 'false':
            qs = qs.filter(invoiced_at__isnull=True)
        start = self.request.query_params.get('start')
        end = self.request.query_params.get('end')
        if start:
            qs = qs.filter(start_at__gte=start)
        if end:
            qs = qs.filter(start_at__lt=end)
        return qs


class TollingVehicleViewSet(viewsets.ViewSet):
    """Aggregated views per license plate."""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def list(self, request):
        """Return one row per license plate with current-month totals."""
        now = timezone.now().astimezone(timezone.get_current_timezone())
        month_start, month_end = _month_range(now.year, now.month)

        agg_qs = (
            TollingEvent.objects
            .filter(start_at__gte=month_start, start_at__lt=month_end)
            .values('license_plate_normalized')
            .annotate(
                current_month_km=Coalesce(Sum('distance_km'), Value(0), output_field=DecimalField(max_digits=14, decimal_places=3)),
                current_month_amount=Coalesce(Sum('amount'), Value(0), output_field=DecimalField(max_digits=14, decimal_places=2)),
            )
        )
        agg_map = {row['license_plate_normalized']: row for row in agg_qs}

        # Vehicles for enrichment (kenteken with dashes / ritnummer / bedrijf)
        vehicle_map: dict[str, Vehicle] = {}
        for v in Vehicle.objects.select_related('bedrijf').all():
            vehicle_map[normalize_plate(v.kenteken)] = v

        # Distinct plates with any events
        plates = TollingEvent.objects.values_list('license_plate_normalized', 'license_plate_raw').distinct()
        seen: dict[str, str] = {}
        for norm, raw in plates:
            seen.setdefault(norm, raw)

        results = []
        for norm, raw in seen.items():
            vehicle = vehicle_map.get(norm)
            monthly = agg_map.get(norm, {})
            bedrijf = getattr(vehicle, 'bedrijf', None) if vehicle else None
            results.append({
                'plate_normalized': norm,
                'plate_raw': raw,
                'plate_display': vehicle.kenteken if vehicle else raw,
                'ritnummer': vehicle.ritnummer if vehicle else None,
                'vehicle_id': str(vehicle.id) if vehicle else None,
                'bedrijf_id': str(bedrijf.id) if bedrijf else None,
                'bedrijf_naam': bedrijf.naam if bedrijf else None,
                'current_month_km': float(monthly.get('current_month_km') or 0),
                'current_month_amount': float(monthly.get('current_month_amount') or 0),
            })
        results.sort(key=lambda r: r['plate_display'])
        return Response(results)

    @action(detail=False, methods=['get'], url_path=r'(?P<plate>[^/]+)/summary')
    def summary(self, request, plate: str = ''):
        """
        Return events + totals for a plate within a period.
        Query params:
          period=week|month (default month)
          year, index  (optional — defaults to current)
          offset       (integer — shift periods relative to current)
        """
        period = request.query_params.get('period', 'month')
        offset = int(request.query_params.get('offset') or 0)
        norm = normalize_plate(plate)
        if not norm:
            return Response({'detail': 'Kenteken vereist.'}, status=400)

        now = timezone.now().astimezone(timezone.get_current_timezone())
        if period == 'week':
            iso = now.isocalendar()
            year, idx = _shift_week(iso[0], iso[1], offset)
            start, end = _week_range(year, idx)
        else:
            year, idx = _shift_month(now.year, now.month, offset)
            start, end = _month_range(year, idx)

        events = list(
            TollingEvent.objects
            .filter(license_plate_normalized=norm, start_at__gte=start, start_at__lt=end)
            .order_by('start_at')
        )
        total_km = sum((e.distance_km for e in events), Decimal('0'))
        total_amount = sum((e.amount for e in events), Decimal('0'))
        invoiced_count = sum(1 for e in events if e.invoiced_at)

        return Response({
            'plate_normalized': norm,
            'period': period,
            'year': year,
            'index': idx,
            'offset': offset,
            'start': start,
            'end': end,
            'label': _period_label(period, year, idx),
            'total_km': float(total_km),
            'total_amount': float(total_amount),
            'events_count': len(events),
            'invoiced_count': invoiced_count,
            'events': TollingEventSerializer(events, many=True).data,
        })

    @action(detail=False, methods=['get'], url_path=r'(?P<plate>[^/]+)/open-weeks')
    def open_weeks(self, request, plate: str = ''):
        """List ISO-weeks for which this plate has unbilled (non-private) events.

        Query params (optional filters):
          - exclude_weekend=true|false (default true)   → skip Sat/Sun events
          - cutoff_time=HH:MM (local time)              → skip events starting at/after this time

        Returns [{year, week, start, end, label, events_count, total_km, total_amount}]
        sorted from newest week first.
        """
        norm = normalize_plate(plate)
        if not norm:
            return Response({'detail': 'Kenteken vereist.'}, status=400)

        exclude_weekend = _parse_bool(request.query_params.get('exclude_weekend'), default=True)
        cutoff_time = _parse_cutoff_time(request.query_params.get('cutoff_time'))

        events = list(
            TollingEvent.objects
            .filter(license_plate_normalized=norm, invoiced_at__isnull=True, is_private=False)
            .values_list('start_at', 'distance_km', 'amount')
        )
        tz = timezone.get_current_timezone()
        buckets: dict[tuple[int, int], dict] = {}
        for start_at, km, amount in events:
            if not start_at:
                continue
            local = start_at.astimezone(tz) if timezone.is_aware(start_at) else start_at
            if exclude_weekend and local.isoweekday() >= 6:
                continue
            if cutoff_time is not None and local.time() >= cutoff_time:
                continue
            iso = local.isocalendar()
            key = (iso[0], iso[1])
            b = buckets.setdefault(key, {
                'events_count': 0,
                'total_km': Decimal('0'),
                'total_amount': Decimal('0'),
            })
            b['events_count'] += 1
            b['total_km'] += km or Decimal('0')
            b['total_amount'] += amount or Decimal('0')

        result = []
        for (year, week), b in sorted(buckets.items(), key=lambda kv: kv[0], reverse=True):
            start, end = _week_range(year, week)
            result.append({
                'year': year,
                'week': week,
                'start': start.date().isoformat(),
                'end': (end - timedelta(seconds=1)).date().isoformat(),
                'label': f"Week {week:02d} · {start.strftime('%d-%m')} t/m {(end - timedelta(days=1)).strftime('%d-%m-%Y')}",
                'events_count': b['events_count'],
                'total_km': float(b['total_km']),
                'total_amount': float(b['total_amount']),
            })
        return Response(result)

    @action(detail=False, methods=['get'], url_path=r'(?P<plate>[^/]+)/export')
    def export(self, request, plate: str = ''):
        # NOTE: use 'export_format' instead of 'format' — DRF reserves 'format' for content negotiation.
        fmt = (request.query_params.get('export_format') or request.query_params.get('format') or 'xlsx').lower()
        period = request.query_params.get('period', 'month')
        offset = int(request.query_params.get('offset') or 0)
        norm = normalize_plate(plate)
        now = timezone.now().astimezone(timezone.get_current_timezone())
        if period == 'week':
            iso = now.isocalendar()
            year, idx = _shift_week(iso[0], iso[1], offset)
            start, end = _week_range(year, idx)
        else:
            year, idx = _shift_month(now.year, now.month, offset)
            start, end = _month_range(year, idx)
        events = list(
            TollingEvent.objects
            .filter(license_plate_normalized=norm, start_at__gte=start, start_at__lt=end)
            .order_by('start_at')
        )
        plate_display = events[0].license_plate_raw if events else plate
        for v in Vehicle.objects.all():
            if normalize_plate(v.kenteken) == norm:
                plate_display = v.kenteken
                break

        label = _period_label(period, year, idx)
        safe_plate = ''.join(c for c in plate_display if c.isalnum() or c in '-_') or 'tolheffing'
        if fmt == 'pdf':
            data = export_events_pdf(events, plate_display, label)
            resp = HttpResponse(data, content_type='application/pdf')
            resp['Content-Disposition'] = f'attachment; filename="tolheffing_{safe_plate}_{period}_{year}_{idx}.pdf"'
            return resp
        data = export_events_xlsx(events, plate_display, label)
        resp = HttpResponse(
            data,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        resp['Content-Disposition'] = f'attachment; filename="tolheffing_{safe_plate}_{period}_{year}_{idx}.xlsx"'
        return resp

    @action(detail=False, methods=['post'], url_path=r'(?P<plate>[^/]+)/mark-uninvoiced')
    def mark_uninvoiced(self, request, plate: str = ''):
        """Remove invoiced marker for events of a plate in given period; deletes InvoiceLine if still linked.

        Body: { period='month'|'week', year, index } — legacy fallback { year, month }.
        """
        norm = normalize_plate(plate)
        try:
            _period, _year, _index, start, end, _label = _resolve_period(request.data)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)
        events = list(
            TollingEvent.objects
            .filter(license_plate_normalized=norm, start_at__gte=start, start_at__lt=end, invoiced_at__isnull=False)
        )
        line_ids = {e.invoice_line_id for e in events if e.invoice_line_id}
        for e in events:
            e.invoice_line = None
            e.invoiced_at = None
        TollingEvent.objects.bulk_update(events, ['invoice_line', 'invoiced_at'])
        # Delete invoice lines that only contained toll data (safe: only if their invoice is still concept)
        deleted = 0
        for lid in line_ids:
            try:
                line = InvoiceLine.objects.select_related('invoice').get(id=lid)
            except InvoiceLine.DoesNotExist:
                continue
            if line.invoice.status == 'concept':
                inv = line.invoice
                line.delete()
                inv.calculate_totals()
                deleted += 1
        return Response({'unmarked': len(events), 'lines_deleted': deleted})


class TollingInvoicingViewSet(viewsets.ViewSet):
    """Utilities to inject tolling totals into invoices."""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    @action(detail=False, methods=['get'], url_path='preview')
    def preview(self, request):
        """List unbilled per-vehicle totals for a given month or week.

        Query params:
          period=month|week (default 'month')
          year (required)
          index (1..12 voor maand, 1..53 voor week) — of legacy 'month'
        """
        params = request.query_params
        # Defaults: current month
        if 'year' not in params and 'index' not in params and 'month' not in params:
            now = timezone.now()
            data = {'period': 'month', 'year': now.year, 'index': now.month}
        else:
            data = params
        try:
            period, year, index, start, end, label = _resolve_period(data)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)
        # Per-plate totals + weekday/weekend split (Mon-Fri = weekday, Sat/Sun = weekend).
        # Privé-gemarkeerde events tellen NIET mee — die worden niet doorbelast.
        events_qs = TollingEvent.objects.filter(
            start_at__gte=start, start_at__lt=end, invoiced_at__isnull=True,
            is_private=False,
        ).values_list('license_plate_normalized', 'license_plate_raw', 'start_at', 'distance_km', 'amount')

        agg: dict[str, dict] = {}
        raw_map: dict[str, str] = {}
        tz = timezone.get_current_timezone()
        for norm, raw, start_at, km, amount in events_qs:
            raw_map.setdefault(norm, raw)
            local_dt = start_at.astimezone(tz) if timezone.is_aware(start_at) else start_at
            is_weekend = local_dt.isoweekday() >= 6  # 6=Sat, 7=Sun
            bucket = agg.setdefault(norm, {
                'total_km': Decimal('0'), 'total_amount': Decimal('0'), 'events_count': 0,
                'weekday_km': Decimal('0'), 'weekday_amount': Decimal('0'),
                'weekend_km': Decimal('0'), 'weekend_amount': Decimal('0'),
            })
            bucket['total_km'] += km or Decimal('0')
            bucket['total_amount'] += amount or Decimal('0')
            bucket['events_count'] += 1
            if is_weekend:
                bucket['weekend_km'] += km or Decimal('0')
                bucket['weekend_amount'] += amount or Decimal('0')
            else:
                bucket['weekday_km'] += km or Decimal('0')
                bucket['weekday_amount'] += amount or Decimal('0')

        vehicle_map: dict[str, Vehicle] = {normalize_plate(v.kenteken): v for v in Vehicle.objects.all()}
        results = []
        for norm, b in agg.items():
            v = vehicle_map.get(norm)
            results.append({
                'plate_normalized': norm,
                'plate_display': v.kenteken if v else raw_map.get(norm, norm),
                'ritnummer': v.ritnummer if v else None,
                'vehicle_id': str(v.id) if v else None,
                'total_km': float(b['total_km']),
                'total_amount': float(b['total_amount']),
                'events_count': b['events_count'],
                'weekday_km': float(b['weekday_km']),
                'weekday_amount': float(b['weekday_amount']),
                'weekend_km': float(b['weekend_km']),
                'weekend_amount': float(b['weekend_amount']),
                'period': period,
                'year': year,
                'index': index,
                'label': label,
                # Backwards-compat (frontend legacy):
                'month': index if period == 'month' else 0,
            })
        results.sort(key=lambda x: x['plate_display'])
        return Response(results)

    @action(detail=False, methods=['post'], url_path='add-to-invoice')
    def add_to_invoice(self, request):
        """Add tolling totals to an invoice as new lines.

        Body: {invoice_id, period='month'|'week', year, index, plates: [normalized, ...]}
        Legacy fallback: {year, month} → period='month'.
        For each plate a line is created:
          omschrijving = "<KENTEKEN> - <RITNUMMER> (<KM> KM)"
          aantal = 1
          prijs = totaal bedrag
        Related TollingEvent rows are marked invoiced.
        """
        invoice_id = request.data.get('invoice_id')
        try:
            invoice = Invoice.objects.get(id=invoice_id)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Factuur niet gevonden.'}, status=404)
        if invoice.status != 'concept':
            return Response({'detail': 'Alleen concept-facturen kunnen bewerkt worden.'}, status=400)

        try:
            period, year, index, start, end, period_label = _resolve_period(request.data)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)
        plates: Iterable[str] = request.data.get('plates') or []
        norm_plates = [normalize_plate(p) for p in plates if p]
        if not norm_plates:
            return Response({'detail': 'Geen kentekens opgegeven.'}, status=400)
        exclude_weekend = str(request.data.get('exclude_weekend') or '').lower() in ('1', 'true', 'yes')
        events = list(
            TollingEvent.objects
            .filter(start_at__gte=start, start_at__lt=end,
                    invoiced_at__isnull=True,
                    is_private=False,
                    license_plate_normalized__in=norm_plates)
        )
        if exclude_weekend:
            tz = timezone.get_current_timezone()
            events = [
                e for e in events
                if (e.start_at.astimezone(tz) if timezone.is_aware(e.start_at) else e.start_at).isoweekday() < 6
            ]
        by_plate: dict[str, list[TollingEvent]] = {}
        for e in events:
            by_plate.setdefault(e.license_plate_normalized, []).append(e)

        vehicle_map: dict[str, Vehicle] = {normalize_plate(v.kenteken): v for v in Vehicle.objects.all()}
        max_order = (
            InvoiceLine.objects.filter(invoice=invoice).order_by('-volgorde').values_list('volgorde', flat=True).first()
            or 0
        )
        created_lines = []
        now = timezone.now()
        for norm in norm_plates:
            evs = by_plate.get(norm) or []
            if not evs:
                continue
            v = vehicle_map.get(norm)
            plate_display = v.kenteken if v else evs[0].license_plate_raw
            ritnummer = v.ritnummer if v else ''
            total_km = sum((e.distance_km for e in evs), Decimal('0'))
            total_amount = sum((e.amount for e in evs), Decimal('0'))
            max_order += 1
            omschrijving = (
                f"{plate_display} - {ritnummer} (Totaal {int(round(total_km))} KM)"
                if ritnummer else
                f"{plate_display} (Totaal {int(round(total_km))} KM)"
            )
            line = InvoiceLine.objects.create(
                invoice=invoice,
                omschrijving=omschrijving[:500],
                aantal=Decimal('1'),
                eenheid='stuk',
                prijs_per_eenheid=total_amount.quantize(Decimal('0.01')),
                volgorde=max_order,
                extra_data={
                    'source': 'tolling',
                    'plate': plate_display,
                    'plate_normalized': norm,
                    'ritnummer': ritnummer,
                    'total_km': float(total_km),
                    'period': period,
                    'year': year,
                    'index': index,
                    'period_label': period_label,
                    # legacy:
                    'month': index if period == 'month' else None,
                    'events_count': len(evs),
                },
            )
            for e in evs:
                e.invoice_line = line
                e.invoiced_at = now
            TollingEvent.objects.bulk_update(evs, ['invoice_line', 'invoiced_at'])
            created_lines.append({
                'id': str(line.id),
                'plate': plate_display,
                'ritnummer': ritnummer,
                'total_km': float(total_km),
                'total_amount': float(total_amount),
                'events_count': len(evs),
            })

        invoice.calculate_totals()
        return Response({'lines': created_lines})

    @action(detail=False, methods=['post'], url_path='link-line')
    def link_line(self, request):
        """Link an existing InvoiceLine to all unbilled TollingEvents for a plate+period.

        Used when tolling lines are first added locally on the new-invoice form and
        the line id only becomes known after the invoice is saved.
        Body: { invoice_line_id, plate, period='month'|'week', year, index }
        Legacy fallback: { ..., year, month }.
        """
        line_id = request.data.get('invoice_line_id')
        plate = request.data.get('plate') or ''
        try:
            period, year, index, start, end, period_label = _resolve_period(request.data)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)
        norm = normalize_plate(plate)
        if not norm:
            return Response({'detail': 'plate vereist.'}, status=400)
        try:
            line = InvoiceLine.objects.get(id=line_id)
        except InvoiceLine.DoesNotExist:
            return Response({'detail': 'Factuurregel niet gevonden.'}, status=404)
        exclude_weekend = str(request.data.get('exclude_weekend') or '').lower() in ('1', 'true', 'yes')
        events = list(
            TollingEvent.objects
            .filter(license_plate_normalized=norm,
                    start_at__gte=start, start_at__lt=end,
                    invoiced_at__isnull=True,
                    is_private=False)
        )
        if exclude_weekend:
            tz = timezone.get_current_timezone()
            events = [
                e for e in events
                if (e.start_at.astimezone(tz) if timezone.is_aware(e.start_at) else e.start_at).isoweekday() < 6
            ]
        now = timezone.now()
        for e in events:
            e.invoice_line = line
            e.invoiced_at = now
        TollingEvent.objects.bulk_update(events, ['invoice_line', 'invoiced_at'])
        return Response({'linked': len(events)})

    @action(detail=False, methods=['post'], url_path='create-invoice')
    def create_invoice(self, request):
        """Create a new invoice directly from tolheffing data for a single vehicle.

        Body:
          {
            plate: normalized_plate,
            year: 2026,
            week_start: 27,
            period_weeks: 1 | 2,
            template_id: UUID,
            bedrijf_id: UUID,
            administratie_id: UUID | null,
            factuurdatum: 'YYYY-MM-DD' (optional, default today),
            vervaldatum: 'YYYY-MM-DD' (optional, default +30 days),
            btw_percentage: number (optional, default 21)
          }

        Behaviour:
          - Creates a concept Invoice with auto-generated factuurnummer.
          - Creates 1 InvoiceLine per week ("Tolheffing week X (DD-MM t/m DD-MM)").
          - Marks the related TollingEvents as invoiced (link to their week's line).
          - Only unbilled (invoice_line=NULL) and non-private events are included.

        Returns: { invoice_id, factuurnummer, totaal, lines: [...], events_marked }
        """
        from datetime import date as _date, timedelta as _td
        from apps.core.models import Administratie
        from apps.companies.models import Company
        from apps.invoicing.models import Invoice, InvoiceLine, InvoiceTemplate, InvoiceStatus, InvoiceType
        from apps.invoicing.views import InvoiceViewSet

        data = request.data
        plate = normalize_plate(data.get('plate') or '')
        if not plate:
            return Response({'detail': 'plate vereist.'}, status=400)
        try:
            year = int(data.get('year'))
            week_start = int(data.get('week_start'))
            period_weeks = int(data.get('period_weeks') or 1)
        except (TypeError, ValueError):
            return Response({'detail': 'year/week_start/period_weeks vereist (integers).'}, status=400)
        if period_weeks not in (1, 2):
            return Response({'detail': 'period_weeks moet 1 of 2 zijn.'}, status=400)
        if not 1 <= week_start <= 53:
            return Response({'detail': 'week_start moet 1-53 zijn.'}, status=400)

        template_id = data.get('template_id')
        bedrijf_id = data.get('bedrijf_id')
        administratie_id = data.get('administratie_id') or None
        if not bedrijf_id:
            return Response({'detail': 'bedrijf_id vereist.'}, status=400)
        try:
            bedrijf = Company.objects.get(id=bedrijf_id)
        except (Company.DoesNotExist, ValueError):
            return Response({'detail': 'Bedrijf niet gevonden.'}, status=404)

        template = None
        if template_id:
            try:
                template = InvoiceTemplate.objects.get(id=template_id)
            except (InvoiceTemplate.DoesNotExist, ValueError):
                return Response({'detail': 'Template niet gevonden.'}, status=404)

        administratie = None
        if administratie_id:
            try:
                administratie = Administratie.objects.get(id=administratie_id)
            except (Administratie.DoesNotExist, ValueError):
                return Response({'detail': 'Administratie niet gevonden.'}, status=404)
            user = request.user
            if not (user.is_superuser or getattr(user, 'rol', None) == 'admin'):
                if not administratie.allowed_users.filter(pk=user.pk).exists():
                    return Response(
                        {'detail': 'Geen rechten op deze administratie.'},
                        status=403,
                    )

        # Dates
        try:
            factuurdatum = (
                _date.fromisoformat(data.get('factuurdatum'))
                if data.get('factuurdatum') else _date.today()
            )
            vervaldatum = (
                _date.fromisoformat(data.get('vervaldatum'))
                if data.get('vervaldatum') else factuurdatum + _td(days=30)
            )
        except (TypeError, ValueError):
            return Response({'detail': 'factuurdatum/vervaldatum ongeldig (YYYY-MM-DD).'}, status=400)
        try:
            btw_percentage = Decimal(str(data.get('btw_percentage') or 0))
        except Exception:
            btw_percentage = Decimal('0')
        # Tolheffing wordt zonder BTW doorbelast (doorlopende post): forceer 0%
        # onafhankelijk van wat de client meestuurt.
        btw_percentage = Decimal('0')

        # Filters
        exclude_weekend = _parse_bool(data.get('exclude_weekend'), default=True)
        cutoff_time = _parse_cutoff_time(data.get('cutoff_time'))
        tz = timezone.get_current_timezone()

        def _event_included(ev) -> bool:
            if not ev.start_at:
                return False
            local = ev.start_at.astimezone(tz) if timezone.is_aware(ev.start_at) else ev.start_at
            if exclude_weekend and local.isoweekday() >= 6:
                return False
            if cutoff_time is not None and local.time() >= cutoff_time:
                return False
            return True

        # Compute weeks
        weeks: list[tuple[int, int]] = []
        y, w = year, week_start
        for _ in range(period_weeks):
            weeks.append((y, w))
            monday = date.fromisocalendar(y, w, 1) + timedelta(days=7)
            iso = monday.isocalendar()
            y, w = iso[0], iso[1]

        # Collect events per week (unbilled + non-private only, then apply filters)
        events_by_week: dict[tuple[int, int], list[TollingEvent]] = {}
        for (yr, wk) in weeks:
            start, end = _week_range(yr, wk)
            evs = list(
                TollingEvent.objects.filter(
                    license_plate_normalized=plate,
                    invoiced_at__isnull=True,
                    is_private=False,
                    start_at__gte=start,
                    start_at__lt=end,
                ).order_by('start_at')
            )
            evs = [e for e in evs if _event_included(e)]
            events_by_week[(yr, wk)] = evs
        if not any(events_by_week.values()):
            return Response(
                {'detail': 'Geen openstaande tolheffing-events gevonden voor de gekozen week(en) na toepassen van de filters.'},
                status=400,
            )

        # Vehicle info for line description
        vehicle = next(
            (v for v in Vehicle.objects.all() if normalize_plate(v.kenteken) == plate),
            None,
        )
        plate_display = vehicle.kenteken if vehicle else (
            events_by_week[weeks[0]][0].license_plate_raw if events_by_week[weeks[0]] else plate
        )
        ritnummer = vehicle.ritnummer if vehicle else ''

        # Generate invoice number using the same logic as InvoiceViewSet
        lookup_prefix, start_number = InvoiceViewSet._resolve_invoice_numbering(
            'verkoop', administratie
        )
        next_num = InvoiceViewSet._compute_next_invoice_number(lookup_prefix, start_number)
        factuurnummer = f"{lookup_prefix}-{next_num:04d}"

        invoice = Invoice.objects.create(
            factuurnummer=factuurnummer,
            type=InvoiceType.VERKOOP,
            status=InvoiceStatus.CONCEPT,
            template=template,
            bedrijf=bedrijf,
            administratie=administratie,
            factuurdatum=factuurdatum,
            vervaldatum=vervaldatum,
            btw_percentage=btw_percentage,
            created_by=request.user,
        )

        # Create one line per week; skip empty weeks
        created_lines = []
        events_marked = 0
        now = timezone.now()
        volgorde = 0
        for (yr, wk) in weeks:
            evs = events_by_week.get((yr, wk)) or []
            if not evs:
                continue
            total_km = sum((e.distance_km for e in evs), Decimal('0'))
            total_amount = sum((e.amount for e in evs), Decimal('0'))
            start, end = _week_range(yr, wk)
            last_day = end - timedelta(days=1)
            week_desc = (
                f"Tolheffing week {wk:02d}-{yr} "
                f"({start.strftime('%d-%m')} t/m {last_day.strftime('%d-%m-%Y')})"
            )
            if ritnummer:
                week_desc += f" — {plate_display} {ritnummer}"
            else:
                week_desc += f" — {plate_display}"
            volgorde += 1
            line = InvoiceLine.objects.create(
                invoice=invoice,
                omschrijving=week_desc[:500],
                aantal=Decimal('1'),
                eenheid='stuk',
                prijs_per_eenheid=total_amount.quantize(Decimal('0.01')),
                volgorde=volgorde,
                extra_data={
                    'source': 'tolling',
                    'plate': plate_display,
                    'plate_normalized': plate,
                    'ritnummer': ritnummer,
                    'total_km': float(total_km),
                    'period': 'week',
                    'year': yr,
                    'index': wk,
                    'period_label': f"Week {wk:02d} {yr}",
                    'events_count': len(evs),
                    'exclude_weekend': exclude_weekend,
                    'cutoff_time': cutoff_time.strftime('%H:%M') if cutoff_time else None,
                },
            )
            for e in evs:
                e.invoice_line = line
                e.invoiced_at = now
            TollingEvent.objects.bulk_update(evs, ['invoice_line', 'invoiced_at'])
            events_marked += len(evs)
            created_lines.append({
                'id': str(line.id),
                'week': wk,
                'year': yr,
                'omschrijving': week_desc,
                'total_km': float(total_km),
                'total_amount': float(total_amount),
                'events_count': len(evs),
            })

        invoice.calculate_totals()
        invoice.refresh_from_db()

        logger.info(
            "Tolling invoice created: %s for %s (%d weken, %d events) by %s",
            factuurnummer, bedrijf.naam, len(created_lines), events_marked, request.user.email,
        )

        return Response({
            'invoice_id': str(invoice.id),
            'factuurnummer': factuurnummer,
            'status': invoice.status,
            'subtotaal': float(invoice.subtotaal),
            'btw_bedrag': float(invoice.btw_bedrag),
            'totaal': float(invoice.totaal),
            'lines': created_lines,
            'events_marked': events_marked,
        })


class PrivateTollRegistrationViewSet(viewsets.ModelViewSet):
    """CRUD voor privé-tolregistraties door chauffeurs.

    Elke gebruiker ziet en beheert alleen zijn/haar eigen registraties.
    Bij aanmaken/wijzigen worden bestaande TollingEvents die matchen op
    kenteken + datum + tijdvenster automatisch als privé gemarkeerd.

    Query params (list):
      - period=week|month (default: geen filter)
      - year, index (bij period)
      - page, page_size (pagination, default 20)
      - plate (optioneel: filter op genormaliseerd kenteken)
    """
    serializer_class = PrivateTollRegistrationSerializer
    permission_classes = [IsAuthenticated]

    def _is_admin(self) -> bool:
        return bool(getattr(self.request.user, 'is_admin', False))

    def get_queryset(self):
        # Admins mogen registraties voor andere gebruikers zien/beheren.
        # - Bij list kan een admin via ?user_id= filteren op een specifieke chauffeur;
        #   zonder filter tonen we (net als voorheen) alleen de eigen registraties.
        # - Bij detail-acties (retrieve/update/destroy) mag een admin bij elke
        #   registratie kunnen, ongeacht eigenaar — anders leidt DELETE op een
        #   registratie van een andere chauffeur tot een 404.
        if self._is_admin():
            target_user_id = self.request.query_params.get('user_id') or self.request.data.get('user_id')
            if target_user_id:
                qs = PrivateTollRegistration.objects.filter(user_id=target_user_id)
            elif getattr(self, 'action', None) in ('retrieve', 'update', 'partial_update', 'destroy'):
                qs = PrivateTollRegistration.objects.all()
            else:
                qs = PrivateTollRegistration.objects.filter(user=self.request.user)
        else:
            qs = PrivateTollRegistration.objects.filter(user=self.request.user)
        params = self.request.query_params
        period = (params.get('period') or '').lower()
        try:
            if period == 'week':
                year = int(params.get('year'))
                index = int(params.get('index'))
                _, _, _, start, end, _ = _resolve_period({'period': 'week', 'year': year, 'index': index})
                qs = qs.filter(datum__gte=start.date(), datum__lt=end.date())
            elif period == 'month':
                year = int(params.get('year'))
                index = int(params.get('index'))
                _, _, _, start, end, _ = _resolve_period({'period': 'month', 'year': year, 'index': index})
                qs = qs.filter(datum__gte=start.date(), datum__lt=end.date())
        except (TypeError, ValueError):
            pass
        plate = params.get('plate')
        if plate:
            qs = qs.filter(license_plate_normalized=normalize_plate(plate))
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        try:
            page = max(1, int(request.query_params.get('page') or 1))
            page_size = max(1, min(200, int(request.query_params.get('page_size') or 20)))
        except ValueError:
            page, page_size = 1, 20
        total = qs.count()
        start_ix = (page - 1) * page_size
        end_ix = start_ix + page_size
        items = qs[start_ix:end_ix]
        return Response({
            'count': total,
            'page': page,
            'page_size': page_size,
            'num_pages': max(1, (total + page_size - 1) // page_size),
            'results': self.get_serializer(items, many=True).data,
        })

    def perform_create(self, serializer):
        # Admins mogen een registratie namens een andere gebruiker aanmaken via user_id.
        target_user = self.request.user
        if self._is_admin():
            uid = self.request.data.get('user_id')
            if uid:
                from django.contrib.auth import get_user_model
                User = get_user_model()
                try:
                    target_user = User.objects.get(id=uid)
                except User.DoesNotExist:
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({'user_id': 'Chauffeur niet gevonden.'})
        reg = serializer.save(user=target_user)
        try:
            match_private_registration_to_events(reg)
        except Exception as exc:  # pragma: no cover
            logger.warning("match_private_registration_to_events faalt voor %s: %s", reg.id, exc)

    def perform_update(self, serializer):
        # Verwijder bestaande matches, opnieuw matchen na save
        old_reg = self.get_object()
        try:
            unmatch_private_registration(old_reg)
        except Exception as exc:  # pragma: no cover
            logger.warning("unmatch faalt voor %s: %s", old_reg.id, exc)
        reg = serializer.save()
        try:
            match_private_registration_to_events(reg)
        except Exception as exc:  # pragma: no cover
            logger.warning("match faalt voor %s: %s", reg.id, exc)

    def perform_destroy(self, instance):
        try:
            unmatch_private_registration(instance)
        except Exception as exc:  # pragma: no cover
            logger.warning("unmatch bij delete faalt voor %s: %s", instance.id, exc)
        instance.delete()

    # ---------- Admin endpoints ----------

    @action(detail=False, methods=['get'], url_path='admin-summary')
    def admin_summary(self, request):
        """Overzicht per chauffeur voor een periode (week/maand). Alleen admins.

        Query params: period=week|month, year, index
        Response: [{ user_id, user_name, registrations_count, matched_events_count,
                     total_km, total_amount, all_invoiced, any_invoiced, first_datum, last_datum }]
        """
        if not getattr(request.user, 'is_admin', False):
            return Response({'detail': 'Alleen admins.'}, status=403)
        try:
            period, year, index, start, end, label = _resolve_period(request.query_params)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)

        regs = list(
            PrivateTollRegistration.objects
            .filter(datum__gte=start.date(), datum__lt=end.date())
            .select_related('user')
            .prefetch_related('matched_events')
            .order_by('user__achternaam', 'user__voornaam', 'datum', 'begin_tijd')
        )

        per_user: dict = {}
        for r in regs:
            uid = str(r.user_id)
            bucket = per_user.setdefault(uid, {
                'user_id': uid,
                'user_name': (getattr(r.user, 'full_name', None) or r.user.username) if r.user else 'Onbekend',
                'user_email': getattr(r.user, 'email', '') or '',
                'registrations_count': 0,
                'matched_events_count': 0,
                'total_km': Decimal('0'),
                'total_amount': Decimal('0'),
                'invoiced_count': 0,
                'first_datum': r.datum,
                'last_datum': r.datum,
            })
            bucket['registrations_count'] += 1
            if r.admin_invoiced:
                bucket['invoiced_count'] += 1
            if r.datum < bucket['first_datum']:
                bucket['first_datum'] = r.datum
            if r.datum > bucket['last_datum']:
                bucket['last_datum'] = r.datum
            for ev in r.matched_events.all():
                bucket['matched_events_count'] += 1
                bucket['total_km'] += Decimal(ev.distance_km or 0)
                bucket['total_amount'] += Decimal(ev.amount or 0)

        results = []
        for uid, b in per_user.items():
            results.append({
                'user_id': b['user_id'],
                'user_name': b['user_name'],
                'user_email': b['user_email'],
                'registrations_count': b['registrations_count'],
                'matched_events_count': b['matched_events_count'],
                'total_km': float(b['total_km']),
                'total_amount': float(b['total_amount']),
                'invoiced_count': b['invoiced_count'],
                'all_invoiced': b['invoiced_count'] > 0 and b['invoiced_count'] == b['registrations_count'],
                'any_invoiced': b['invoiced_count'] > 0,
                'first_datum': b['first_datum'].isoformat() if b['first_datum'] else None,
                'last_datum': b['last_datum'].isoformat() if b['last_datum'] else None,
            })
        results.sort(key=lambda x: x['user_name'].lower())
        return Response({
            'period': period, 'year': year, 'index': index, 'label': label,
            'start': start.date().isoformat(), 'end': end.date().isoformat(),
            'results': results,
        })

    @action(detail=False, methods=['get'], url_path='admin-detail')
    def admin_detail(self, request):
        """Detail van alle registraties van 1 chauffeur voor een periode. Alleen admins.

        Query params: period, year, index, user_id
        """
        if not getattr(request.user, 'is_admin', False):
            return Response({'detail': 'Alleen admins.'}, status=403)
        user_id = request.query_params.get('user_id')
        if not user_id:
            return Response({'detail': 'user_id vereist.'}, status=400)
        try:
            _period, _year, _index, start, end, _label = _resolve_period(request.query_params)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)
        qs = (
            PrivateTollRegistration.objects
            .filter(user_id=user_id, datum__gte=start.date(), datum__lt=end.date())
            .order_by('datum', 'begin_tijd')
        )
        return Response(self.get_serializer(qs, many=True).data)

    @action(detail=False, methods=['post'], url_path='admin-mark-invoiced')
    def admin_mark_invoiced(self, request):
        """Markeer alle privé-registraties van een chauffeur voor een periode
        als (niet-)gefactureerd. Alleen admins.

        Body: { user_id, period, year, index, invoiced: bool }
        """
        if not getattr(request.user, 'is_admin', False):
            return Response({'detail': 'Alleen admins.'}, status=403)
        user_id = request.data.get('user_id')
        if not user_id:
            return Response({'detail': 'user_id vereist.'}, status=400)
        try:
            _period, _year, _index, start, end, _label = _resolve_period(request.data)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)
        invoiced = bool(request.data.get('invoiced', True))
        qs = PrivateTollRegistration.objects.filter(
            user_id=user_id, datum__gte=start.date(), datum__lt=end.date(),
        )
        now = timezone.now()
        updated = qs.update(
            admin_invoiced=invoiced,
            admin_invoiced_at=now if invoiced else None,
            admin_invoiced_by=request.user if invoiced else None,
        )
        return Response({'updated': updated, 'invoiced': invoiced})

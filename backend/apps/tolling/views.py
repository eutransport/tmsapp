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

from .models import TollingEvent, TollingImportBatch, normalize_plate
from .serializers import TollingEventSerializer, TollingImportBatchSerializer
from .services import export_events_pdf, export_events_xlsx, import_csv

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

        # Vehicles for enrichment (kenteken with dashes / ritnummer)
        vehicle_map: dict[str, Vehicle] = {}
        for v in Vehicle.objects.all():
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
            results.append({
                'plate_normalized': norm,
                'plate_raw': raw,
                'plate_display': vehicle.kenteken if vehicle else raw,
                'ritnummer': vehicle.ritnummer if vehicle else None,
                'vehicle_id': str(vehicle.id) if vehicle else None,
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
        rows = (
            TollingEvent.objects
            .filter(start_at__gte=start, start_at__lt=end, invoiced_at__isnull=True)
            .values('license_plate_normalized')
            .annotate(
                total_km=Sum('distance_km'),
                total_amount=Sum('amount'),
                events_count=Sum(Value(1)),
            )
        )
        vehicle_map: dict[str, Vehicle] = {normalize_plate(v.kenteken): v for v in Vehicle.objects.all()}
        # Fetch any raw plate for display
        raw_map: dict[str, str] = {}
        for norm, raw in TollingEvent.objects.filter(
            start_at__gte=start, start_at__lt=end, invoiced_at__isnull=True
        ).values_list('license_plate_normalized', 'license_plate_raw'):
            raw_map.setdefault(norm, raw)

        results = []
        for r in rows:
            norm = r['license_plate_normalized']
            v = vehicle_map.get(norm)
            results.append({
                'plate_normalized': norm,
                'plate_display': v.kenteken if v else raw_map.get(norm, norm),
                'ritnummer': v.ritnummer if v else None,
                'vehicle_id': str(v.id) if v else None,
                'total_km': float(r['total_km'] or 0),
                'total_amount': float(r['total_amount'] or 0),
                'events_count': int(r['events_count'] or 0),
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
        events = list(
            TollingEvent.objects
            .filter(start_at__gte=start, start_at__lt=end,
                    invoiced_at__isnull=True,
                    license_plate_normalized__in=norm_plates)
        )
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
        events = list(
            TollingEvent.objects
            .filter(license_plate_normalized=norm,
                    start_at__gte=start, start_at__lt=end,
                    invoiced_at__isnull=True)
        )
        now = timezone.now()
        for e in events:
            e.invoice_line = line
            e.invoiced_at = now
        TollingEvent.objects.bulk_update(events, ['invoice_line', 'invoiced_at'])
        return Response({'linked': len(events)})

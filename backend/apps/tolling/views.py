"""API views voor de tolheffing-module."""
from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable

from django.db import transaction
from django.db.models import Count, DecimalField, Sum, Value, Q
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

    # Toegestane periodes voor het overzicht per kenteken.
    PERIOD_CHOICES = ('week', 'month', 'quarter', 'year', 'all')

    def _resolve_list_period(self, params):
        """Bepaal het datumbereik voor de kentekenlijst.

        Query params:
          - period = week | month | quarter | year | all (standaard: month)
          - offset = verschuiving t.o.v. nu (0 = huidige periode, -1 = vorige, 1 = volgende)

        Geeft (period, year, index, start, end) terug. Voor period='all' zijn
        start en end None (= alles tot nu toe).
        """
        period = (params.get('period') or 'month').strip().lower()
        if period not in self.PERIOD_CHOICES:
            period = 'month'
        try:
            offset = int(params.get('offset') or 0)
        except (TypeError, ValueError):
            offset = 0

        tz = timezone.get_current_timezone()
        now = timezone.now().astimezone(tz)

        if period == 'week':
            iso = now.isocalendar()
            year, index = _shift_week(iso[0], iso[1], offset)
            start, end = _week_range(year, index)
        elif period == 'month':
            year, index = _shift_month(now.year, now.month, offset)
            start, end = _month_range(year, index)
        elif period == 'quarter':
            q_idx = (now.year * 4 + (now.month - 1) // 3) + offset
            year, index = q_idx // 4, (q_idx % 4) + 1
            first_month = (index - 1) * 3 + 1
            start, _ = _month_range(year, first_month)
            last_year, last_month = _shift_month(year, first_month, 2)
            _, end = _month_range(last_year, last_month)
        elif period == 'year':
            year, index = now.year + offset, 0
            start = timezone.make_aware(datetime(year, 1, 1), tz)
            end = timezone.make_aware(datetime(year + 1, 1, 1), tz)
        else:  # all
            year, index, start, end = now.year, 0, None, None

        return period, year, index, start, end

    def list(self, request):
        """Eén regel per kenteken met de totalen van de gekozen periode."""
        period, year, index, start, end = self._resolve_list_period(request.query_params)

        agg_qs = TollingEvent.objects.all()
        if start is not None and end is not None:
            agg_qs = agg_qs.filter(start_at__gte=start, start_at__lt=end)
        agg_qs = (
            agg_qs
            .values('license_plate_normalized')
            .annotate(
                period_km=Coalesce(Sum('distance_km'), Value(0), output_field=DecimalField(max_digits=14, decimal_places=3)),
                period_amount=Coalesce(Sum('amount'), Value(0), output_field=DecimalField(max_digits=14, decimal_places=2)),
                period_events=Count('id'),
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
            totals = agg_map.get(norm, {})
            bedrijf = getattr(vehicle, 'bedrijf', None) if vehicle else None
            km = float(totals.get('period_km') or 0)
            amount = float(totals.get('period_amount') or 0)
            results.append({
                'plate_normalized': norm,
                'plate_raw': raw,
                'plate_display': vehicle.kenteken if vehicle else raw,
                'ritnummer': vehicle.ritnummer if vehicle else None,
                'vehicle_id': str(vehicle.id) if vehicle else None,
                'bedrijf_id': str(bedrijf.id) if bedrijf else None,
                'bedrijf_naam': bedrijf.naam if bedrijf else None,
                'period_km': km,
                'period_amount': amount,
                'period_events': int(totals.get('period_events') or 0),
                # Backwards-compat met oudere frontend-builds:
                'current_month_km': km,
                'current_month_amount': amount,
            })
        results.sort(key=lambda r: r['plate_display'])

        return Response({
            'period': period,
            'year': year,
            'index': index,
            'date_from': start.date().isoformat() if start else None,
            'date_to': (end - timedelta(days=1)).date().isoformat() if end else None,
            'totals': {
                'vehicles': sum(1 for r in results if r['period_events'] > 0),
                'events': sum(r['period_events'] for r in results),
                'km': round(sum(r['period_km'] for r in results), 3),
                'amount': round(sum(r['period_amount'] for r in results), 2),
            },
            'rows': results,
        })

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

    @action(detail=False, methods=['post'], url_path=r'(?P<plate>[^/]+)/email-export')
    def email_export(self, request, plate: str = ''):
        """E-mail the tolling overview (PDF or XLSX) as attachment.

        Body: {
            recipients: ["a@b.nl", ...],
            subject: str,
            body: str,
            fmt: 'pdf'|'xlsx',
            period: 'month'|'week',
            offset: int,
            email_profile_id?: str,
        }
        """
        recipients_raw = request.data.get('recipients') or []
        if isinstance(recipients_raw, str):
            recipients = [x.strip() for x in recipients_raw.replace(';', ',').split(',') if x.strip()]
        else:
            recipients = [str(x).strip() for x in recipients_raw if str(x).strip()]
        if not recipients:
            return Response({'detail': 'Geen ontvangers opgegeven.'}, status=400)

        subject = (request.data.get('subject') or '').strip()
        body = request.data.get('body') or ''
        fmt = (request.data.get('fmt') or 'pdf').lower()
        if fmt not in ('pdf', 'xlsx'):
            return Response({'detail': "Ongeldig formaat (verwacht 'pdf' of 'xlsx')."}, status=400)
        period = request.data.get('period') or 'month'
        try:
            offset = int(request.data.get('offset') or 0)
        except (TypeError, ValueError):
            offset = 0
        profile_id = request.data.get('email_profile_id') or None

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
        if not events:
            return Response({'detail': 'Geen tolgebeurtenissen in de gekozen periode.'}, status=400)

        plate_display = events[0].license_plate_raw
        for v in Vehicle.objects.all():
            if normalize_plate(v.kenteken) == norm:
                plate_display = v.kenteken
                break
        label = _period_label(period, year, idx)
        safe_plate = ''.join(c for c in plate_display if c.isalnum() or c in '-_') or 'tolheffing'
        filename = f'tolheffing_{safe_plate}_{period}_{year}_{idx}.{fmt}'

        if fmt == 'pdf':
            file_bytes = export_events_pdf(events, plate_display, label)
            mime = 'application/pdf'
        else:
            file_bytes = export_events_xlsx(events, plate_display, label)
            mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

        if not subject:
            subject = f'Tolheffing overzicht {plate_display} — {label}'
        if not body:
            body = (
                f'Beste,\n\nIn de bijlage vind je het tolheffing overzicht voor '
                f'{plate_display} ({label}).\n\nMet vriendelijke groet,'
            )

        from django.core.mail import EmailMessage, get_connection
        from apps.core.views import get_smtp_config
        try:
            smtp_host, smtp_port, smtp_username, smtp_password, smtp_use_tls, from_email, _sig, _src = \
                get_smtp_config(profile_id, request.user)
        except (ValueError, PermissionError) as exc:
            return Response({'detail': str(exc)}, status=400)
        if not smtp_host:
            return Response(
                {'detail': 'SMTP is niet geconfigureerd. Stel dit eerst in via Instellingen.'},
                status=400,
            )
        try:
            connection = get_connection(
                host=smtp_host,
                port=smtp_port,
                username=(smtp_username or '').strip(),
                password=smtp_password or '',
                use_tls=smtp_use_tls,
                fail_silently=False,
            )
            email = EmailMessage(
                subject=subject,
                body=body,
                from_email=from_email,
                to=recipients,
                connection=connection,
            )
            email.attach(filename, file_bytes, mime)
            email.send(fail_silently=False)
        except Exception as exc:
            logger.error('Fout bij verzenden tolheffing mail: %s', exc)
            return Response(
                {'detail': 'Mail kon niet worden verzonden. Controleer de mailconfiguratie.'},
                status=500,
            )

        return Response({
            'sent': True,
            'recipients': recipients,
            'filename': filename,
        })

    @action(detail=False, methods=['post'], url_path=r'(?P<plate>[^/]+)/delete-events')
    def delete_events(self, request, plate: str = ''):
        """Verwijder ALLE TollingEvents voor één kenteken.

        Gekoppelde InvoiceLine's blijven bestaan (FK is SET_NULL). Returnt
        aantallen zodat de UI kan waarschuwen als er reeds gefactureerde
        events tussen zaten.
        """
        norm = normalize_plate(plate)
        if not norm:
            return Response({'detail': 'Kenteken vereist.'}, status=400)
        qs = TollingEvent.objects.filter(license_plate_normalized=norm)
        total = qs.count()
        if total == 0:
            return Response({'deleted': 0, 'invoiced_deleted': 0, 'invoice_lines_affected': 0})
        invoiced = qs.filter(invoiced_at__isnull=False).count()
        line_ids = set(
            qs.filter(invoice_line_id__isnull=False).values_list('invoice_line_id', flat=True)
        )
        with transaction.atomic():
            qs.delete()
        logger.info(
            "Tolling delete-events: plate=%s deleted=%d invoiced=%d lines_touched=%d by=%s",
            norm, total, invoiced, len(line_ids),
            getattr(request.user, 'email', request.user),
        )
        return Response({
            'deleted': total,
            'invoiced_deleted': invoiced,
            'invoice_lines_affected': len(line_ids),
        })

    @action(detail=False, methods=['post'], url_path='delete-all')
    def delete_all(self, request):
        """Verwijder ALLE TollingEvents (alle kentekens).

        Body: { confirm: "DELETE_ALL" }  — extra guardrail tegen ongelukken.
        Gekoppelde InvoiceLine's blijven bestaan (FK is SET_NULL).
        """
        if request.data.get('confirm') != 'DELETE_ALL':
            return Response(
                {'detail': 'Ontbrekende bevestiging (confirm="DELETE_ALL").'},
                status=400,
            )
        qs = TollingEvent.objects.all()
        total = qs.count()
        if total == 0:
            return Response({'deleted': 0, 'invoiced_deleted': 0, 'invoice_lines_affected': 0})
        invoiced = qs.filter(invoiced_at__isnull=False).count()
        line_ids = set(
            qs.filter(invoice_line_id__isnull=False).values_list('invoice_line_id', flat=True)
        )
        with transaction.atomic():
            qs.delete()
        logger.warning(
            "Tolling delete-all: deleted=%d invoiced=%d lines_touched=%d by=%s",
            total, invoiced, len(line_ids),
            getattr(request.user, 'email', request.user),
        )
        return Response({
            'deleted': total,
            'invoiced_deleted': invoiced,
            'invoice_lines_affected': len(line_ids),
        })

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

    @action(detail=False, methods=['post'], url_path='match-by-hours')
    def match_by_hours(self, request):
        """Match tolling-events strikt op kenteken + tijd-range per dag.

        Bedoeld voor factuur-generatie op basis van geïmporteerde uren: alleen
        events waarvan `start_at` binnen een rit-tijdrange valt worden meegeteld.

        Body:
          {
            "ranges": [
              {"plate": "50-BXN-5", "date": "2026-07-20",
               "start_time": "06:00", "end_time": "16:30"},
              ...
            ],
            "buffer_minutes": 30            # optioneel, default 30
          }

        Response:
          {
            "matched": [
              {
                "plate_normalized": "...",
                "plate_display": "...",
                "ritnummer": "...",
                "total_km": 924.0,
                "total_amount": 185.85,
                "events_count": 12,
                "days": ["2026-07-20", ...]
              }
            ],
            "unmatched": [
              {
                "plate_display": "...",
                "plate_normalized": "...",
                "start_at": "...", "end_at": "...",
                "distance_km": 12.3, "amount": 2.45,
                "obu": "...",
                "reason": "outside_time_range" | "no_range_for_plate"
              }
            ]
          }

        Alle events zijn `invoiced_at IS NULL` en `is_private=False`.
        Kenteken input wordt genormaliseerd (upper + [A-Z0-9] only).
        Fleet-labels (bv. "E&UTRANS1") worden via Vehicle.ritnummer → kenteken
        vertaald zodat de tol-CSV (echte kentekens) matcht.
        """
        raw_ranges = request.data.get('ranges') or []
        if not isinstance(raw_ranges, list) or not raw_ranges:
            return Response({'detail': 'ranges is verplicht (lijst).'}, status=400)

        try:
            buffer_minutes = int(request.data.get('buffer_minutes', 30) or 0)
        except (TypeError, ValueError):
            buffer_minutes = 30
        if buffer_minutes < 0:
            buffer_minutes = 0
        if buffer_minutes > 240:
            buffer_minutes = 240
        buffer = timedelta(minutes=buffer_minutes)

        tz = timezone.get_current_timezone()

        # Bouw eerst een lookup: normalized_plate -> Vehicle. Zo kunnen we
        # fleet-labels als "E&UTRANS1" mappen naar het echte kenteken.
        vehicle_map: dict[str, Vehicle] = {}
        for v in Vehicle.objects.all():
            kn = normalize_plate(v.kenteken)
            if kn:
                vehicle_map[kn] = v
            rn = normalize_plate(v.ritnummer)
            if rn:
                vehicle_map.setdefault(rn, v)

        # Parse alle ranges en groepeer per (normalized) kenteken. Elk range
        # element wordt een (start_dt, end_dt) tuple.
        def _parse_time(val):
            if not val:
                return None
            s = str(val).strip()
            for fmt in ('%H:%M:%S', '%H:%M', '%H.%M'):
                try:
                    return datetime.strptime(s, fmt).time()
                except ValueError:
                    continue
            return None

        def _parse_date(val):
            if not val:
                return None
            s = str(val).strip()[:10]
            for fmt in ('%Y-%m-%d', '%d-%m-%Y', '%d/%m/%Y'):
                try:
                    return datetime.strptime(s, fmt).date()
                except ValueError:
                    continue
            return None

        ranges_by_plate: dict[str, list[tuple[datetime, datetime]]] = {}
        overall_min: datetime | None = None
        overall_max: datetime | None = None
        skipped_ranges: list[dict] = []

        for item in raw_ranges:
            if not isinstance(item, dict):
                continue
            raw_plate = item.get('plate') or ''
            norm = normalize_plate(raw_plate)
            if not norm:
                continue
            # Normaliseer naar het echte kenteken indien de input een
            # ritnummer/label is.
            veh = vehicle_map.get(norm)
            if veh:
                real_norm = normalize_plate(veh.kenteken)
                if real_norm:
                    norm = real_norm

            d = _parse_date(item.get('date'))
            if not d:
                continue
            st = _parse_time(item.get('start_time'))
            et = _parse_time(item.get('end_time'))
            # STRIKT: als een van beide tijden ontbreekt, weigeren we de range.
            # Anders zouden we de hele dag matchen wat tot foutieve facturatie
            # kan leiden. We melden dit terug zodat de gebruiker weet dat er
            # ritten zijn zonder begin/eindtijd.
            if st is None or et is None:
                skipped_ranges.append({
                    'plate': raw_plate,
                    'plate_normalized': norm,
                    'date': d.isoformat(),
                    'start_time': item.get('start_time') or None,
                    'end_time': item.get('end_time') or None,
                    'reason': 'missing_time',
                })
                continue

            start_dt = timezone.make_aware(datetime.combine(d, st), tz) - buffer
            # Nachtdienst: eind vóór start → volgende dag
            if et < st:
                end_dt = timezone.make_aware(datetime.combine(d + timedelta(days=1), et), tz) + buffer
            else:
                end_dt = timezone.make_aware(datetime.combine(d, et), tz) + buffer

            ranges_by_plate.setdefault(norm, []).append((start_dt, end_dt))
            if overall_min is None or start_dt < overall_min:
                overall_min = start_dt
            if overall_max is None or end_dt > overall_max:
                overall_max = end_dt

        if not ranges_by_plate or overall_min is None or overall_max is None:
            return Response({
                'detail': 'Geen bruikbare ranges (mogelijk missen begin/eindtijden).',
                'skipped_ranges': skipped_ranges,
            }, status=400)

        norm_plates = list(ranges_by_plate.keys())

        # Haal alle relevante events op in één query.
        events_qs = TollingEvent.objects.filter(
            license_plate_normalized__in=norm_plates,
            start_at__gte=overall_min - timedelta(days=1),
            start_at__lt=overall_max + timedelta(days=1),
            invoiced_at__isnull=True,
            is_private=False,
        ).order_by('license_plate_normalized', 'start_at')

        matched_agg: dict[str, dict] = {}
        unmatched: list[dict] = []

        for e in events_qs:
            plate_norm = e.license_plate_normalized
            ranges = ranges_by_plate.get(plate_norm)
            veh = vehicle_map.get(plate_norm)
            plate_display = veh.kenteken if veh else e.license_plate_raw
            ritnummer = veh.ritnummer if veh else ''

            start_at = e.start_at
            # Sommige DB-rijen kunnen naive zijn — dan localizen.
            if timezone.is_naive(start_at):
                start_at = timezone.make_aware(start_at, tz)
            end_at = e.end_at or start_at
            if timezone.is_naive(end_at):
                end_at = timezone.make_aware(end_at, tz)

            fits = False
            if ranges:
                # Interval-overlap check: het event overlapt met een rit-range
                # als event.start < range.end EN event.end > range.start.
                # Zo tellen ook events mee die net vóór de starttijd
                # beginnen maar hoofdzakelijk tijdens de rit lopen.
                for rs, re_ in ranges:
                    if start_at <= re_ and end_at >= rs:
                        fits = True
                        break

            if fits:
                bucket = matched_agg.setdefault(plate_norm, {
                    'plate_normalized': plate_norm,
                    'plate_display': plate_display,
                    'ritnummer': ritnummer,
                    'total_km': Decimal('0'),
                    'total_amount': Decimal('0'),
                    'events_count': 0,
                    'days': set(),
                    'event_ids': [],
                    'events': [],
                })
                bucket['total_km'] += e.distance_km or Decimal('0')
                bucket['total_amount'] += e.amount or Decimal('0')
                bucket['events_count'] += 1
                bucket['days'].add(start_at.astimezone(tz).date().isoformat())
                bucket['event_ids'].append(str(e.id))
                bucket['events'].append({
                    'id': str(e.id),
                    'start_at': start_at.isoformat(),
                    'end_at': end_at.isoformat() if e.end_at else None,
                    'distance_km': float(e.distance_km or 0),
                    'amount': float(e.amount or 0),
                    'obu': e.obu or '',
                })
            else:
                unmatched.append({
                    'id': str(e.id),
                    'plate_display': plate_display,
                    'plate_normalized': plate_norm,
                    'start_at': start_at.isoformat(),
                    'end_at': e.end_at.isoformat() if e.end_at else None,
                    'distance_km': float(e.distance_km or 0),
                    'amount': float(e.amount or 0),
                    'obu': e.obu or '',
                    'reason': 'outside_time_range' if ranges else 'no_range_for_plate',
                })

        matched = []
        for norm, b in matched_agg.items():
            matched.append({
                'plate_normalized': b['plate_normalized'],
                'plate_display': b['plate_display'],
                'ritnummer': b['ritnummer'],
                'total_km': float(b['total_km']),
                'total_amount': float(b['total_amount'].quantize(Decimal('0.01'))),
                'events_count': b['events_count'],
                'days': sorted(b['days']),
                'event_ids': b['event_ids'],
                'events': sorted(b['events'], key=lambda x: x['start_at']),
            })
        matched.sort(key=lambda x: x['plate_display'])

        return Response({
            'matched': matched,
            'unmatched': unmatched,
            'buffer_minutes': buffer_minutes,
            'skipped_ranges': skipped_ranges,
        })

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
        Nieuw: { invoice_line_id, event_ids: [uuid, ...] } → link exact deze events.
        """
        line_id = request.data.get('invoice_line_id')
        try:
            line = InvoiceLine.objects.get(id=line_id)
        except InvoiceLine.DoesNotExist:
            return Response({'detail': 'Factuurregel niet gevonden.'}, status=404)

        # Nieuw pad: directe event-lijst (van match-by-hours).
        raw_event_ids = request.data.get('event_ids')
        if isinstance(raw_event_ids, list) and raw_event_ids:
            events = list(
                TollingEvent.objects.filter(
                    id__in=raw_event_ids,
                    invoiced_at__isnull=True,
                    is_private=False,
                )
            )
            now = timezone.now()
            for e in events:
                e.invoice_line = line
                e.invoiced_at = now
            TollingEvent.objects.bulk_update(events, ['invoice_line', 'invoiced_at'])
            return Response({'linked': len(events)})

        # Legacy pad: op basis van periode.
        plate = request.data.get('plate') or ''
        try:
            period, year, index, start, end, period_label = _resolve_period(request.data)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)
        norm = normalize_plate(plate)
        if not norm:
            return Response({'detail': 'plate vereist.'}, status=400)
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
        if period_weeks < 1 or period_weeks > 4:
            return Response({'detail': 'period_weeks moet 1, 2, 3 of 4 zijn.'}, status=400)
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


    # ------------------------------------------------------------------
    # Overzicht van facturen die uit tolheffing zijn ontstaan
    # ------------------------------------------------------------------

    @staticmethod
    def _serialize_tolling_invoice(invoice, credits_by_source: dict) -> dict:
        """Maak een compacte representatie van een tolheffing-factuur."""
        plates: list = []
        weeks: list = []
        credit_of = None
        for line in invoice.lines.all():
            extra = line.extra_data or {}
            if extra.get('source') != 'tolling':
                continue
            plate = extra.get('plate')
            if plate and plate not in plates:
                plates.append(plate)
            label = extra.get('period_label')
            if label and label not in weeks:
                weeks.append(label)
            if extra.get('credit_of_invoice_id'):
                credit_of = {
                    'invoice_id': extra.get('credit_of_invoice_id'),
                    'factuurnummer': extra.get('credit_of_factuurnummer'),
                }

        credits = credits_by_source.get(str(invoice.id), [])
        return {
            'id': str(invoice.id),
            'factuurnummer': invoice.factuurnummer,
            'type': invoice.type,
            'status': invoice.status,
            'bedrijf_id': str(invoice.bedrijf_id) if invoice.bedrijf_id else None,
            'bedrijf_naam': invoice.bedrijf.naam if invoice.bedrijf_id else None,
            'administratie_id': str(invoice.administratie_id) if invoice.administratie_id else None,
            'administratie_naam': invoice.administratie.naam if invoice.administratie_id else None,
            'factuurdatum': invoice.factuurdatum.isoformat() if invoice.factuurdatum else None,
            'vervaldatum': invoice.vervaldatum.isoformat() if invoice.vervaldatum else None,
            'subtotaal': float(invoice.subtotaal or 0),
            'btw_bedrag': float(invoice.btw_bedrag or 0),
            'totaal': float(invoice.totaal or 0),
            'plates': plates,
            'weeks': weeks,
            'credit_of': credit_of,
            'credits': credits,
            'has_credit': bool(credits),
            'created_at': invoice.created_at.isoformat() if invoice.created_at else None,
        }

    @action(detail=False, methods=['get'], url_path='invoices')
    def invoices(self, request):
        """Lijst met facturen die tolheffing-regels bevatten.

        Query params:
          - plate: filter op genormaliseerd kenteken (optioneel)
          - limit: max aantal resultaten (default 100, max 500)
        """
        plate = normalize_plate(request.query_params.get('plate') or '')
        try:
            limit = min(int(request.query_params.get('limit') or 100), 500)
        except (TypeError, ValueError):
            limit = 100

        qs = Invoice.objects.filter(lines__extra_data__source='tolling')
        if plate:
            qs = qs.filter(lines__extra_data__plate_normalized=plate)
        qs = (
            qs.distinct()
            .select_related('bedrijf', 'administratie')
            .prefetch_related('lines')
            .order_by('-factuurdatum', '-created_at')[:limit]
        )
        invoices = list(qs)

        # Zoek per bron-factuur welke creditfacturen er al zijn
        source_ids = [str(inv.id) for inv in invoices]
        credits_by_source: dict = {}
        if source_ids:
            credit_qs = (
                Invoice.objects
                .filter(type='credit', lines__extra_data__credit_of_invoice_id__in=source_ids)
                .distinct()
                .prefetch_related('lines')
            )
            for credit in credit_qs:
                for line in credit.lines.all():
                    src = (line.extra_data or {}).get('credit_of_invoice_id')
                    if not src:
                        continue
                    bucket = credits_by_source.setdefault(src, [])
                    if any(c['id'] == str(credit.id) for c in bucket):
                        continue
                    bucket.append({
                        'id': str(credit.id),
                        'factuurnummer': credit.factuurnummer,
                        'status': credit.status,
                        'totaal': float(credit.totaal or 0),
                    })

        return Response([
            self._serialize_tolling_invoice(inv, credits_by_source) for inv in invoices
        ])

    @action(detail=False, methods=['post'], url_path='create-credit-invoice')
    def create_credit_invoice(self, request):
        """Maak een creditfactuur op basis van een bestaande tolheffing-factuur.

        Body:
          invoice_id   UUID van de bronfactuur (verplicht)
          factuurdatum 'YYYY-MM-DD' (optioneel, default vandaag)
          vervaldatum  'YYYY-MM-DD' (optioneel, default +30 dagen)
          force        bool (optioneel, sta een tweede creditfactuur toe)

        De creditfactuur krijgt een eigen nummer uit de credit-nummerreeks
        (bijvoorbeeld C-2026-0001), kopieert alle regels van de bronfactuur en
        laat Invoice.calculate_totals() de bedragen negatief maken. De
        gekoppelde TollingEvents blijven aan de originele factuur hangen.
        """
        from django.core.exceptions import ValidationError as DjangoValidationError
        from apps.invoicing.models import InvoiceStatus, InvoiceType
        from apps.invoicing.views import InvoiceViewSet

        data = request.data
        invoice_id = data.get('invoice_id')
        if not invoice_id:
            return Response({'detail': 'invoice_id vereist.'}, status=400)

        try:
            source = (
                Invoice.objects
                .select_related('bedrijf', 'administratie', 'template')
                .prefetch_related('lines')
                .get(id=invoice_id)
            )
        except (Invoice.DoesNotExist, ValueError, DjangoValidationError):
            return Response({'detail': 'Factuur niet gevonden.'}, status=404)

        if source.type == InvoiceType.CREDIT:
            return Response(
                {'detail': 'Deze factuur is zelf al een creditfactuur.'},
                status=400,
            )

        source_lines = list(source.lines.all().order_by('volgorde', 'created_at'))
        if not source_lines:
            return Response({'detail': 'Bronfactuur heeft geen regels.'}, status=400)

        administratie = source.administratie
        if administratie is not None:
            user = request.user
            if not (user.is_superuser or getattr(user, 'rol', None) == 'admin'):
                if not administratie.allowed_users.filter(pk=user.pk).exists():
                    return Response(
                        {'detail': 'Geen rechten op deze administratie.'},
                        status=403,
                    )

        force = _parse_bool(data.get('force'), default=False)
        if not force:
            existing = (
                Invoice.objects
                .filter(type=InvoiceType.CREDIT,
                        lines__extra_data__credit_of_invoice_id=str(source.id))
                .distinct()
                .first()
            )
            if existing is not None:
                return Response(
                    {
                        'detail': (
                            'Er bestaat al een creditfactuur ({}) voor {}. '
                            'Bevestig om er nog een te maken.'
                        ).format(existing.factuurnummer, source.factuurnummer),
                        'existing_invoice_id': str(existing.id),
                        'existing_factuurnummer': existing.factuurnummer,
                    },
                    status=409,
                )

        try:
            factuurdatum = (
                date.fromisoformat(data.get('factuurdatum'))
                if data.get('factuurdatum') else date.today()
            )
            vervaldatum = (
                date.fromisoformat(data.get('vervaldatum'))
                if data.get('vervaldatum') else factuurdatum + timedelta(days=30)
            )
        except (TypeError, ValueError):
            return Response({'detail': 'factuurdatum/vervaldatum ongeldig (YYYY-MM-DD).'}, status=400)

        # Nummer uit de credit-reeks (bijvoorbeeld C-2026-0001)
        lookup_prefix, start_number = InvoiceViewSet._resolve_invoice_numbering(
            'credit', administratie
        )
        next_num = InvoiceViewSet._compute_next_invoice_number(lookup_prefix, start_number)
        factuurnummer = '{}-{:04d}'.format(lookup_prefix, next_num)

        opmerking = 'Creditfactuur voor {}.'.format(source.factuurnummer)
        if source.opmerkingen:
            opmerking = '{}\n\n{}'.format(opmerking, source.opmerkingen)

        with transaction.atomic():
            credit = Invoice.objects.create(
                factuurnummer=factuurnummer,
                type=InvoiceType.CREDIT,
                status=InvoiceStatus.CONCEPT,
                template=source.template,
                bedrijf=source.bedrijf,
                administratie=administratie,
                factuurdatum=factuurdatum,
                vervaldatum=vervaldatum,
                btw_percentage=source.btw_percentage,
                dot_percentage=source.dot_percentage,
                week_number=source.week_number,
                week_year=source.week_year,
                chauffeur=source.chauffeur,
                opmerkingen=opmerking[:5000],
                created_by=request.user,
            )

            for idx, line in enumerate(source_lines, start=1):
                extra = dict(line.extra_data or {})
                extra['credit_of_invoice_id'] = str(source.id)
                extra['credit_of_factuurnummer'] = source.factuurnummer
                extra['credit_of_line_id'] = str(line.id)
                InvoiceLine.objects.create(
                    invoice=credit,
                    omschrijving='Credit: {}'.format(line.omschrijving)[:500],
                    aantal=line.aantal,
                    eenheid=line.eenheid,
                    prijs_per_eenheid=line.prijs_per_eenheid,
                    volgorde=idx,
                    extra_data=extra,
                )

            credit.calculate_totals()

        credit.refresh_from_db()

        logger.info(
            "Tolling credit invoice created: %s for source %s by %s",
            factuurnummer, source.factuurnummer, getattr(request.user, 'email', request.user),
        )

        return Response({
            'invoice_id': str(credit.id),
            'factuurnummer': credit.factuurnummer,
            'status': credit.status,
            'subtotaal': float(credit.subtotaal),
            'btw_bedrag': float(credit.btw_bedrag),
            'totaal': float(credit.totaal),
            'credit_of': {
                'invoice_id': str(source.id),
                'factuurnummer': source.factuurnummer,
            },
            'lines_copied': len(source_lines),
        }, status=status.HTTP_201_CREATED)


    # ------------------------------------------------------------------
    # Dachser-export (Excel)
    # ------------------------------------------------------------------

    @staticmethod
    def _dachser_parse_range(data) -> tuple[date, date]:
        """Haal de datumrange uit de request. Default = huidige maand."""
        raw_from = data.get('date_from')
        raw_to = data.get('date_to')
        if not raw_from or not raw_to:
            today = timezone.localdate()
            first = today.replace(day=1)
            last_day = calendar.monthrange(today.year, today.month)[1]
            return first, today.replace(day=last_day)
        try:
            date_from = date.fromisoformat(str(raw_from))
            date_to = date.fromisoformat(str(raw_to))
        except (TypeError, ValueError):
            raise ValueError('date_from/date_to ongeldig (YYYY-MM-DD).')
        if date_to < date_from:
            raise ValueError('date_to mag niet voor date_from liggen.')
        return date_from, date_to

    @staticmethod
    def _dachser_aggregate(date_from: date, date_to: date,
                           exclude_weekend: bool = True) -> list[dict]:
        """Tel tolheffing op per route + kenteken + dag.

        Meerdere ritten op dezelfde dag komen als losse regels onder elkaar
        te staan zodra ze een ander routenummer of kenteken hebben.
        Privé-gemarkeerde events tellen niet mee. Met `exclude_weekend`
        (default aan) worden zaterdag en zondag overgeslagen.
        """
        tz = timezone.get_current_timezone()
        start = timezone.make_aware(datetime.combine(date_from, datetime.min.time()), tz)
        end = timezone.make_aware(
            datetime.combine(date_to + timedelta(days=1), datetime.min.time()), tz
        )

        events = TollingEvent.objects.filter(
            start_at__gte=start, start_at__lt=end, is_private=False,
        ).values_list(
            'license_plate_normalized', 'license_plate_raw',
            'start_at', 'distance_km', 'amount',
        )

        vehicle_map = {
            normalize_plate(v.kenteken): v
            for v in Vehicle.objects.select_related('bedrijf').all()
        }

        agg: dict[tuple, dict] = {}
        for norm, raw, start_at, km, amount in events:
            local_dt = start_at.astimezone(tz) if timezone.is_aware(start_at) else start_at
            if exclude_weekend and local_dt.isoweekday() >= 6:
                continue

            vehicle = vehicle_map.get(norm)
            plate_display = vehicle.kenteken if vehicle else (raw or norm)
            route = (getattr(vehicle, 'ritnummer', '') or '') if vehicle else ''
            bedrijf = getattr(vehicle, 'bedrijf', None) if vehicle else None
            day = local_dt.date()

            key = (route, norm, day)
            bucket = agg.setdefault(key, {
                'route': route,
                'plate_normalized': norm,
                'license_plate': plate_display,
                'bedrijf_id': str(bedrijf.id) if bedrijf else '',
                'bedrijf_naam': bedrijf.naam if bedrijf else '',
                'date': day,
                'total_km': Decimal('0'),
                'amount': Decimal('0'),
                'events_count': 0,
            })
            bucket['total_km'] += km or Decimal('0')
            bucket['amount'] += amount or Decimal('0')
            bucket['events_count'] += 1

        rows = list(agg.values())
        rows.sort(key=lambda r: (r['date'], r['route'] or '\uffff', r['license_plate']))
        return rows

    @action(detail=False, methods=['get'], url_path='dachser-preview')
    def dachser_preview(self, request):
        """Voorbeeld van de export + de routes waarvoor een carrier nodig is.

        Query params:
          - date_from / date_to (YYYY-MM-DD, default huidige maand)
          - bedrijf: UUID van het bedrijf (optioneel filter op de routes)
          - exclude_weekend: default true
        """
        params = request.query_params
        try:
            date_from, date_to = self._dachser_parse_range(params)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)

        exclude_weekend = _parse_bool(params.get('exclude_weekend'), default=True)
        bedrijf_id = (params.get('bedrijf') or '').strip()

        all_rows = self._dachser_aggregate(date_from, date_to, exclude_weekend)

        # Bedrijvenfilter vullen op basis van ALLE regels, zodat de keuzelijst
        # blijft staan zodra er een bedrijf geselecteerd is.
        companies: dict[str, dict] = {}
        for row in all_rows:
            key = row['bedrijf_id'] or ''
            entry = companies.setdefault(key, {
                'bedrijf_id': key,
                'bedrijf_naam': row['bedrijf_naam'] or 'Zonder bedrijf',
                'routes': [],
                'rows': 0,
                'total_km': Decimal('0'),
                'total_amount': Decimal('0'),
            })
            if row['route'] and row['route'] not in entry['routes']:
                entry['routes'].append(row['route'])
            entry['rows'] += 1
            entry['total_km'] += row['total_km']
            entry['total_amount'] += row['amount']

        rows = all_rows
        if bedrijf_id:
            rows = [r for r in rows if r['bedrijf_id'] == bedrijf_id]

        routes: dict[str, dict] = {}
        for row in rows:
            key = row['route'] or ''
            entry = routes.setdefault(key, {
                'route': key,
                'label': key or 'Zonder routenummer',
                'bedrijf_id': row['bedrijf_id'],
                'bedrijf_naam': row['bedrijf_naam'],
                'plates': [],
                'rows': 0,
                'total_km': Decimal('0'),
                'total_amount': Decimal('0'),
            })
            if row['license_plate'] not in entry['plates']:
                entry['plates'].append(row['license_plate'])
            entry['rows'] += 1
            entry['total_km'] += row['total_km']
            entry['total_amount'] += row['amount']

        return Response({
            'date_from': date_from.isoformat(),
            'date_to': date_to.isoformat(),
            'exclude_weekend': exclude_weekend,
            'bedrijf_id': bedrijf_id,
            'companies': sorted(
                (
                    {
                        'bedrijf_id': v['bedrijf_id'],
                        'bedrijf_naam': v['bedrijf_naam'],
                        'routes': v['routes'],
                        'rows': v['rows'],
                        'total_km': float(v['total_km']),
                        'total_amount': float(v['total_amount']),
                    }
                    for v in companies.values()
                ),
                key=lambda x: (x['bedrijf_id'] == '', x['bedrijf_naam'].lower()),
            ),
            'rows': [
                {
                    'route': r['route'],
                    'license_plate': r['license_plate'],
                    'plate_normalized': r['plate_normalized'],
                    'bedrijf_id': r['bedrijf_id'],
                    'bedrijf_naam': r['bedrijf_naam'],
                    'date': r['date'].isoformat(),
                    'total_km': float(r['total_km']),
                    'amount': float(r['amount']),
                    'events_count': r['events_count'],
                }
                for r in rows
            ],
            'routes': sorted(
                (
                    {
                        'route': v['route'],
                        'label': v['label'],
                        'bedrijf_id': v['bedrijf_id'],
                        'bedrijf_naam': v['bedrijf_naam'],
                        'plates': v['plates'],
                        'rows': v['rows'],
                        'total_km': float(v['total_km']),
                        'total_amount': float(v['total_amount']),
                    }
                    for v in routes.values()
                ),
                key=lambda x: x['route'] or '\uffff',
            ),
            'totals': {
                'rows': len(rows),
                'total_km': float(sum((r['total_km'] for r in rows), Decimal('0'))),
                'total_amount': float(sum((r['amount'] for r in rows), Decimal('0'))),
            },
        })

    @action(detail=False, methods=['post'], url_path='dachser-export')
    def dachser_export(self, request):
        """Genereer het Excel-bestand in Dachser-opmaak.

        Body:
          {
            date_from: 'YYYY-MM-DD',
            date_to:   'YYYY-MM-DD',
            bedrijf:   '<uuid>',                             # alleen routes van dit bedrijf
            carriers:  { '<routenummer>': 'Carrier B.V.' },   # per route
            default_carrier: 'Carrier B.V.',                  # optioneel
            routes: ['<routenummer>', ...],                   # optioneel filter
            exclude_weekend: true,                            # default true
            country: 'NL'                                     # optioneel, default NL
          }
        """
        from .services import build_dachser_export_xlsx

        data = request.data
        try:
            date_from, date_to = self._dachser_parse_range(data)
        except ValueError as ex:
            return Response({'detail': str(ex)}, status=400)

        carriers = data.get('carriers') or {}
        if not isinstance(carriers, dict):
            return Response({'detail': 'carriers moet een object zijn.'}, status=400)
        default_carrier = (data.get('default_carrier') or '').strip()
        country = (data.get('country') or 'NL').strip() or 'NL'
        exclude_weekend = _parse_bool(data.get('exclude_weekend'), default=True)
        bedrijf_id = (data.get('bedrijf') or '').strip()

        selected = data.get('routes')
        selected_set = None
        if isinstance(selected, list):
            selected_set = {str(r or '') for r in selected}

        rows = self._dachser_aggregate(date_from, date_to, exclude_weekend)
        if bedrijf_id:
            rows = [r for r in rows if r['bedrijf_id'] == bedrijf_id]
        if selected_set is not None:
            rows = [r for r in rows if (r['route'] or '') in selected_set]

        if not rows:
            return Response(
                {'detail': 'Geen tolheffing gevonden voor de gekozen periode, bedrijf of routes.'},
                status=400,
            )

        export_rows = [
            {
                'route': r['route'],
                'carrier': (carriers.get(r['route'] or '') or default_carrier or '').strip(),
                'country': country,
                'license_plate': r['license_plate'],
                'total_km': float(r['total_km']),
                'amount': float(r['amount']),
                'date': r['date'],
            }
            for r in rows
        ]

        content = build_dachser_export_xlsx(export_rows)
        bedrijf_naam = rows[0]['bedrijf_naam'] if bedrijf_id else ''
        slug = ''.join(ch if ch.isalnum() else '_' for ch in bedrijf_naam).strip('_') or 'tol'
        filename = f"{slug}_{date_from.isoformat()}_{date_to.isoformat()}.xlsx"
        response = HttpResponse(
            content,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Access-Control-Expose-Headers'] = 'Content-Disposition'
        logger.info(
            "Tolheffing-export: %s regels (%s t/m %s, bedrijf=%s) door %s",
            len(export_rows), date_from, date_to, bedrijf_naam or 'alle', request.user.email,
        )
        return response


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

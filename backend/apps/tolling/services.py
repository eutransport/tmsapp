"""Service voor CSV-import en export van tolheffing-events."""
from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.utils import timezone

from .models import TollingEvent, TollingImportBatch, normalize_plate

logger = logging.getLogger(__name__)

REQUIRED_HEADERS = {'start date', 'end date', 'distance', 'amount', 'license plate'}


@dataclass
class ImportResult:
    batch: TollingImportBatch
    imported: int
    duplicates: int
    invalid: int
    total: int


def _parse_decimal(value: str) -> Decimal | None:
    if value is None:
        return None
    v = str(value).strip().replace('.', '').replace(',', '.') if _looks_european(value) else str(value).strip()
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def _looks_european(value: str) -> bool:
    """Detect European decimal notation: uses comma as decimal separator."""
    s = str(value).strip()
    if ',' in s and s.rfind(',') > s.rfind('.'):
        return True
    return False


def _parse_datetime(value: str) -> datetime | None:
    if not value:
        return None
    v = value.strip()
    # Try ISO 8601 (with Z)
    try:
        if v.endswith('Z'):
            v_iso = v[:-1] + '+00:00'
        else:
            v_iso = v
        dt = datetime.fromisoformat(v_iso)
        if dt.tzinfo is None:
            dt = timezone.make_aware(dt, timezone.utc)
        return dt
    except ValueError:
        pass
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%d-%m-%Y %H:%M:%S', '%d/%m/%Y %H:%M:%S'):
        try:
            dt = datetime.strptime(v, fmt)
            return timezone.make_aware(dt, timezone.get_current_timezone())
        except ValueError:
            continue
    return None


def _sniff_reader(raw: bytes) -> csv.DictReader:
    text = raw.decode('utf-8-sig', errors='replace')
    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t|')
    except csv.Error:
        class _D(csv.excel):
            delimiter = ','
        dialect = _D
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    return reader


def _header_map(fieldnames: list[str]) -> dict[str, str]:
    """Map arbitrary case/whitespace headers to canonical keys."""
    mapping = {}
    for name in fieldnames or []:
        key = name.strip().lower()
        mapping[key] = name
    return mapping


def import_csv(file_obj, user, filename: str = '') -> ImportResult:
    """Import a tolling CSV file. Idempotent — duplicates are skipped."""
    raw = file_obj.read()
    if isinstance(raw, str):
        raw = raw.encode('utf-8')
    reader = _sniff_reader(raw)
    header_map = _header_map(reader.fieldnames or [])

    missing = REQUIRED_HEADERS - set(header_map.keys())
    batch = TollingImportBatch.objects.create(
        uploaded_by=user if getattr(user, 'is_authenticated', False) else None,
        filename=filename or getattr(file_obj, 'name', '') or '',
    )
    if missing:
        batch.error_message = f"Ontbrekende kolommen: {', '.join(sorted(missing))}"
        batch.save(update_fields=['error_message'])
        return ImportResult(batch=batch, imported=0, duplicates=0, invalid=0, total=0)

    def col(row, key):
        return row.get(header_map[key], '') if key in header_map else ''

    imported = duplicates = invalid = total = 0
    new_events: list[TollingEvent] = []

    for row in reader:
        total += 1
        start = _parse_datetime(col(row, 'start date'))
        end = _parse_datetime(col(row, 'end date'))
        distance = _parse_decimal(col(row, 'distance'))
        amount = _parse_decimal(col(row, 'amount'))
        plate_raw = str(col(row, 'license plate') or '').strip()
        obu = str((col(row, 'obu') if 'obu' in header_map else '') or '').strip()

        if not (start and end and distance is not None and amount is not None and plate_raw):
            invalid += 1
            continue

        new_events.append(TollingEvent(
            batch=batch,
            start_at=start,
            end_at=end,
            distance_km=distance,
            amount=amount,
            license_plate_raw=plate_raw,
            license_plate_normalized=normalize_plate(plate_raw),
            obu=obu,
        ))

    # Bulk insert; on unique conflict fall back to per-row insert to count duplicates.
    if new_events:
        try:
            with transaction.atomic():
                TollingEvent.objects.bulk_create(new_events)
                imported = len(new_events)
        except IntegrityError:
            imported = 0
            for ev in new_events:
                try:
                    with transaction.atomic():
                        ev.save()
                        imported += 1
                except IntegrityError:
                    duplicates += 1

    batch.rows_total = total
    batch.rows_imported = imported
    batch.rows_duplicate = duplicates
    batch.rows_invalid = invalid
    batch.save(update_fields=['rows_total', 'rows_imported', 'rows_duplicate', 'rows_invalid'])
    return ImportResult(batch=batch, imported=imported, duplicates=duplicates, invalid=invalid, total=total)


# ---------- Exports ----------

def export_events_xlsx(events, plate_label: str, period_label: str) -> bytes:
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = 'Tolheffing'
    ws.append([f'Kenteken: {plate_label}'])
    ws.append([f'Periode: {period_label}'])
    ws.append([])
    ws.append(['Startdatum', 'Einddatum', 'Afstand (km)', 'Bedrag (€)', 'Gefactureerd'])
    total_km = Decimal('0')
    total_amount = Decimal('0')
    for e in events:
        ws.append([
            e.start_at.strftime('%Y-%m-%d %H:%M'),
            e.end_at.strftime('%Y-%m-%d %H:%M'),
            float(e.distance_km),
            float(e.amount),
            'Ja' if e.invoiced_at else 'Nee',
        ])
        total_km += Decimal(e.distance_km)
        total_amount += Decimal(e.amount)
    ws.append([])
    ws.append(['', 'Totaal', float(total_km), float(total_amount), ''])
    for col_idx, width in enumerate([20, 20, 15, 15, 15], start=1):
        ws.column_dimensions[ws.cell(row=1, column=col_idx).column_letter].width = width
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def export_events_pdf(events, plate_label: str, period_label: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )

    styles = getSampleStyleSheet()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=landscape(A4),
        leftMargin=10 * mm, rightMargin=10 * mm,
        topMargin=10 * mm, bottomMargin=10 * mm,
    )
    elems = [
        Paragraph(f'Tolheffing overzicht — kenteken {plate_label}', styles['Title']),
        Paragraph(f'Periode: {period_label}', styles['Normal']),
        Spacer(1, 6),
    ]
    data = [['Startdatum', 'Einddatum', 'Afstand (km)', 'Bedrag (€)', 'Gefactureerd']]
    total_km = Decimal('0')
    total_amount = Decimal('0')
    for e in events:
        data.append([
            e.start_at.strftime('%Y-%m-%d %H:%M'),
            e.end_at.strftime('%Y-%m-%d %H:%M'),
            f'{float(e.distance_km):.3f}',
            f'{float(e.amount):.2f}',
            'Ja' if e.invoiced_at else 'Nee',
        ])
        total_km += Decimal(e.distance_km)
        total_amount += Decimal(e.amount)
    data.append(['', 'Totaal', f'{float(total_km):.3f}', f'{float(total_amount):.2f}', ''])

    tbl = Table(data, repeatRows=1, hAlign='LEFT')
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1e3a8a')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('ALIGN', (2, 1), (3, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.25, colors.grey),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f3f4f6')),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
    ]))
    elems.append(tbl)
    doc.build(elems)
    return buf.getvalue()

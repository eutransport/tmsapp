"""PDF generator voor tolheffing-overzicht (bijlage bij factuur)."""
import io
from collections import defaultdict
from decimal import Decimal
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from apps.core.models import AppSettings


def _format_money(value) -> str:
    return f"€ {Decimal(value or 0):.2f}".replace('.', ',')


def _format_km(value) -> str:
    return f"{Decimal(value or 0):.2f}".replace('.', ',')


def generate_tolling_events_pdf(events: Iterable, invoice=None) -> bytes:
    """Genereer een PDF-overzicht van tolheffing-events.

    `events` is een iterable van `TollingEvent` instances. Als `invoice` is opgegeven,
    wordt het factuurnummer in de titel getoond.
    """
    events = list(events)
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=15 * mm,
        leftMargin=15 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'TollingTitle',
        parent=styles['Heading1'],
        fontSize=16,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#1f2937'),
        spaceAfter=6,
    )
    subtitle_style = ParagraphStyle(
        'TollingSubtitle',
        parent=styles['Normal'],
        fontSize=10,
        alignment=TA_CENTER,
        textColor=colors.HexColor('#4b5563'),
        spaceAfter=12,
    )
    section_style = ParagraphStyle(
        'TollingSection',
        parent=styles['Heading2'],
        fontSize=12,
        textColor=colors.HexColor('#1f2937'),
        spaceBefore=10,
        spaceAfter=4,
    )

    story = []

    settings_obj = AppSettings.get_settings()
    company_name = getattr(settings_obj, 'company_name', '') or ''
    title_text = 'Tolheffing overzicht'
    story.append(Paragraph(title_text, title_style))

    subtitle_parts = []
    if invoice is not None:
        subtitle_parts.append(f"Bijlage bij factuur {invoice.factuurnummer}")
        if getattr(invoice, 'bedrijf', None):
            subtitle_parts.append(str(invoice.bedrijf))
    if company_name:
        subtitle_parts.append(company_name)
    if subtitle_parts:
        story.append(Paragraph(' &mdash; '.join(subtitle_parts), subtitle_style))

    if not events:
        story.append(Paragraph('Geen tolheffing-events gekoppeld aan deze factuur.', styles['Normal']))
        doc.build(story)
        return buffer.getvalue()

    # Group events per plate (raw label if available, else normalized)
    grouped = defaultdict(list)
    for ev in events:
        key = ev.license_plate_raw or ev.license_plate_normalized or 'onbekend'
        grouped[key].append(ev)

    grand_km = Decimal('0')
    grand_amount = Decimal('0')
    grand_weekday_km = Decimal('0')
    grand_weekday_amount = Decimal('0')
    grand_weekend_km = Decimal('0')
    grand_weekend_amount = Decimal('0')
    grand_private_km = Decimal('0')
    grand_private_amount = Decimal('0')

    def _is_weekend(ev) -> bool:
        return bool(ev.start_at and ev.start_at.isoweekday() >= 6)

    def _is_private(ev) -> bool:
        return bool(getattr(ev, 'is_private', False))

    for plate in sorted(grouped.keys()):
        plate_events = sorted(grouped[plate], key=lambda e: e.start_at)
        billed_events = [e for e in plate_events if not _is_private(e)]
        private_events = [e for e in plate_events if _is_private(e)]
        total_km = sum((Decimal(e.distance_km or 0) for e in billed_events), Decimal('0'))
        total_amount = sum((Decimal(e.amount or 0) for e in billed_events), Decimal('0'))
        weekday_km = sum((Decimal(e.distance_km or 0) for e in billed_events if not _is_weekend(e)), Decimal('0'))
        weekday_amount = sum((Decimal(e.amount or 0) for e in billed_events if not _is_weekend(e)), Decimal('0'))
        weekend_km = total_km - weekday_km
        weekend_amount = total_amount - weekday_amount
        private_km = sum((Decimal(e.distance_km or 0) for e in private_events), Decimal('0'))
        private_amount = sum((Decimal(e.amount or 0) for e in private_events), Decimal('0'))
        grand_km += total_km
        grand_amount += total_amount
        grand_weekday_km += weekday_km
        grand_weekday_amount += weekday_amount
        grand_weekend_km += weekend_km
        grand_weekend_amount += weekend_amount
        grand_private_km += private_km
        grand_private_amount += private_amount

        header_text = f"Kenteken: {plate} &nbsp;&nbsp; ({len(billed_events)} events, {_format_km(total_km)} km, {_format_money(total_amount)})"
        story.append(Paragraph(header_text, section_style))

        data = [['Datum', 'Type', 'Start', 'Eind', 'Afstand (km)', 'Bedrag']]
        weekend_row_indices: list[int] = []
        private_row_indices: list[int] = []
        for idx, ev in enumerate(plate_events, start=1):
            start = ev.start_at
            end = ev.end_at
            private = _is_private(ev)
            weekend = _is_weekend(ev)
            if private:
                type_label = 'privé'
                private_row_indices.append(idx)
            elif weekend:
                type_label = 'weekend'
                weekend_row_indices.append(idx)
            else:
                type_label = 'doordeweeks'
            data.append([
                start.strftime('%d-%m-%Y') if start else '',
                type_label,
                start.strftime('%H:%M') if start else '',
                end.strftime('%H:%M') if end else '',
                _format_km(ev.distance_km),
                _format_money(ev.amount),
            ])
        # Subtotal rows: weekday (billed), weekend (billed), privé (not billed), totaal (billed)
        show_private_subtotal = bool(private_events)
        data.append(['', '', '', 'Totaal doordeweeks', _format_km(weekday_km), _format_money(weekday_amount)])
        data.append(['', '', '', 'Totaal weekend', _format_km(weekend_km), _format_money(weekend_amount)])
        if show_private_subtotal:
            data.append(['', '', '', 'Privé (niet gefactureerd)', _format_km(private_km), _format_money(private_amount)])
        data.append(['', '', '', 'Totaal gefactureerd', _format_km(total_km), _format_money(total_amount)])

        table = Table(
            data,
            colWidths=[24 * mm, 24 * mm, 18 * mm, 18 * mm, 40 * mm, 32 * mm],
            repeatRows=1,
        )
        subtotal_rows = 4 if show_private_subtotal else 3
        style_cmds = [
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1f2937')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (4, 0), (-1, -1), 'RIGHT'),
            ('ALIGN', (0, 0), (3, -1), 'LEFT'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1 - subtotal_rows), [colors.white, colors.HexColor('#f9fafb')]),
            # Subtotal rows tinting
            ('BACKGROUND', (0, -subtotal_rows), (-1, -subtotal_rows), colors.HexColor('#eff6ff')),   # weekday
            ('BACKGROUND', (0, -subtotal_rows + 1), (-1, -subtotal_rows + 1), colors.HexColor('#fef3c7')),  # weekend
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f3f4f6')),  # grand billed
            ('FONTNAME', (0, -subtotal_rows), (-1, -1), 'Helvetica-Bold'),
            ('LINEABOVE', (0, -subtotal_rows), (-1, -subtotal_rows), 0.5, colors.HexColor('#d1d5db')),
            ('GRID', (0, 0), (-1, -1 - subtotal_rows), 0.25, colors.HexColor('#e5e7eb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]
        if show_private_subtotal:
            # Privé subtotal row (index -2 when private subtotal present)
            style_cmds.append(('BACKGROUND', (0, -2), (-1, -2), colors.HexColor('#ede9fe')))
            style_cmds.append(('TEXTCOLOR', (0, -2), (-1, -2), colors.HexColor('#5b21b6')))
        # Tint weekend event rows lightly (amber)
        for ri in weekend_row_indices:
            style_cmds.append(('BACKGROUND', (0, ri), (-1, ri), colors.HexColor('#fef9c3')))
        # Tint privé event rows (purple) — takes precedence over weekend
        for ri in private_row_indices:
            style_cmds.append(('BACKGROUND', (0, ri), (-1, ri), colors.HexColor('#ede9fe')))
            style_cmds.append(('TEXTCOLOR', (0, ri), (-1, ri), colors.HexColor('#5b21b6')))
        table.setStyle(TableStyle(style_cmds))
        story.append(table)
        story.append(Spacer(1, 4 * mm))

    # Grand totals per-plate zijn al zichtbaar in de tabel(len) hierboven; extra
    # samenvatting onderaan is redundant en daarom bewust weggelaten.

    doc.build(story)
    return buffer.getvalue()


def get_tolling_events_for_invoice(invoice):
    """Retourneer TollingEvents die aan factuurregels van deze factuur zijn gekoppeld,
    aangevuld met privé-events (is_private=True) voor dezelfde kenteken(s) in dezelfde ISO-week(en).

    Privé-events worden niet doorbelast, maar wel meegestuurd in de bijlage-PDF
    zodat de opdrachtgever ziet dat ze bekend zijn en bewust niet zijn gefactureerd.
    """
    from .models import TollingEvent
    billed = list(
        TollingEvent.objects.filter(invoice_line__invoice=invoice)
        .order_by('license_plate_raw', 'start_at')
    )
    if not billed:
        return billed
    # Bepaal (plate_normalized, iso_year, iso_week) combinaties van gefactureerde events
    plate_weeks: set[tuple[str, int, int]] = set()
    plates: set[str] = set()
    for ev in billed:
        if not ev.start_at:
            continue
        iso_year, iso_week, _ = ev.start_at.isocalendar()
        plate_weeks.add((ev.license_plate_normalized, iso_year, iso_week))
        plates.add(ev.license_plate_normalized)
    if not plate_weeks:
        return billed
    # Haal alle privé-events op voor betrokken kentekens en filter in Python op ISO-week
    private_qs = TollingEvent.objects.filter(
        is_private=True,
        license_plate_normalized__in=plates,
    ).order_by('license_plate_raw', 'start_at')
    private_extra = []
    for ev in private_qs:
        if not ev.start_at:
            continue
        iso_year, iso_week, _ = ev.start_at.isocalendar()
        if (ev.license_plate_normalized, iso_year, iso_week) in plate_weeks:
            private_extra.append(ev)
    combined = billed + private_extra
    combined.sort(key=lambda e: (e.license_plate_raw or '', e.start_at))
    return combined


def build_tolling_pdf_filename(events) -> str:
    """Bestandsnaam op basis van de meest voorkomende ISO-week binnen `events`.

    Vorm: `tolheffing-week-<weeknummer>.pdf` (weeknummer altijd 2 cijfers).
    Als er meerdere weken in zitten, wordt de week met het hoogste aantal events gekozen.
    Fallback bij lege input: `tolheffing.pdf`.
    """
    from collections import Counter

    counter: Counter = Counter()
    for ev in events:
        start = getattr(ev, 'start_at', None)
        if start is None:
            continue
        iso_year, iso_week, _ = start.isocalendar()
        counter[(iso_year, iso_week)] += 1

    if not counter:
        return 'tolheffing.pdf'

    (_year, week), _count = counter.most_common(1)[0]
    return f"tolheffing-week-{week:02d}.pdf"

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

    for plate in sorted(grouped.keys()):
        plate_events = sorted(grouped[plate], key=lambda e: e.start_at)
        total_km = sum((Decimal(e.distance_km or 0) for e in plate_events), Decimal('0'))
        total_amount = sum((Decimal(e.amount or 0) for e in plate_events), Decimal('0'))
        grand_km += total_km
        grand_amount += total_amount

        header_text = f"Kenteken: {plate} &nbsp;&nbsp; ({len(plate_events)} events, {_format_km(total_km)} km, {_format_money(total_amount)})"
        story.append(Paragraph(header_text, section_style))

        data = [['Datum', 'Start', 'Eind', 'OBU', 'Afstand (km)', 'Bedrag']]
        for ev in plate_events:
            start = ev.start_at
            end = ev.end_at
            data.append([
                start.strftime('%d-%m-%Y') if start else '',
                start.strftime('%H:%M') if start else '',
                end.strftime('%H:%M') if end else '',
                ev.obu or '',
                _format_km(ev.distance_km),
                _format_money(ev.amount),
            ])
        data.append(['', '', '', 'Totaal', _format_km(total_km), _format_money(total_amount)])

        table = Table(
            data,
            colWidths=[22 * mm, 15 * mm, 15 * mm, 40 * mm, 30 * mm, 30 * mm],
            repeatRows=1,
        )
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1f2937')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('ALIGN', (4, 0), (-1, -1), 'RIGHT'),
            ('ALIGN', (0, 0), (2, -1), 'LEFT'),
            ('ALIGN', (3, 0), (3, -1), 'LEFT'),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#f9fafb')]),
            ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#f3f4f6')),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('LINEABOVE', (0, -1), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
            ('GRID', (0, 0), (-1, -2), 0.25, colors.HexColor('#e5e7eb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(table)
        story.append(Spacer(1, 4 * mm))

    total_style = ParagraphStyle(
        'TollingGrandTotal',
        parent=styles['Normal'],
        fontSize=11,
        alignment=TA_RIGHT,
        textColor=colors.HexColor('#1f2937'),
        spaceBefore=6,
    )
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(
        f"<b>Totaal alle kentekens:</b> {_format_km(grand_km)} km &nbsp;&nbsp; "
        f"<b>{_format_money(grand_amount)}</b>",
        total_style,
    ))

    doc.build(story)
    return buffer.getvalue()


def get_tolling_events_for_invoice(invoice):
    """Retourneer TollingEvents die aan factuurregels van deze factuur zijn gekoppeld."""
    from .models import TollingEvent
    return TollingEvent.objects.filter(
        invoice_line__invoice=invoice
    ).order_by('license_plate_raw', 'start_at')


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

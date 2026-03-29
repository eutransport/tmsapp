"""
PDF generator for report requests.
Uses ReportLab to produce formatted PDF documents.
"""
import io
from datetime import datetime
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle


def generate_pdf(title: str, columns: list, rows: list) -> bytes:
    """
    Generate a PDF report and return its contents as bytes.

    Args:
        title: Report title.
        columns: List of column header strings.
        rows: List of row lists.

    Returns:
        bytes: PDF file content.
    """
    buf = io.BytesIO()

    # Use landscape for wide tables
    page_size = landscape(A4) if len(columns) > 6 else A4
    doc = SimpleDocTemplate(
        buf,
        pagesize=page_size,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm,
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(
        name='ReportTitle',
        parent=styles['Heading1'],
        fontSize=16,
        spaceAfter=6,
        textColor=colors.HexColor('#1F2937'),
        alignment=TA_CENTER,
    ))
    styles.add(ParagraphStyle(
        name='ReportMeta',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#6B7280'),
        alignment=TA_CENTER,
        spaceAfter=12,
    ))
    styles.add(ParagraphStyle(
        name='CellText',
        parent=styles['Normal'],
        fontSize=8,
        textColor=colors.HexColor('#1F2937'),
    ))

    story = []

    # Title
    story.append(Paragraph(title, styles['ReportTitle']))
    story.append(Paragraph(
        f"Gegenereerd op {datetime.now().strftime('%d-%m-%Y %H:%M')}",
        styles['ReportMeta'],
    ))

    if not rows:
        story.append(Paragraph("Geen gegevens gevonden.", styles['Normal']))
    else:
        # Build table data
        header_row = [Paragraph(f"<b>{col}</b>", styles['CellText']) for col in columns]
        table_data = [header_row]
        for row in rows:
            table_data.append([
                Paragraph(str(val) if val is not None else '', styles['CellText'])
                for val in row
            ])

        # Compute column widths
        page_width = page_size[0] - 30 * mm
        col_count = len(columns)
        col_width = page_width / col_count

        tbl = Table(table_data, colWidths=[col_width] * col_count, repeatRows=1)
        tbl.setStyle(TableStyle([
            # Header
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1F2937')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
            ('VALIGN', (0, 0), (-1, 0), 'MIDDLE'),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 6),
            ('TOPPADDING', (0, 0), (-1, 0), 6),

            # Alternate row background
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F9FAFB')]),

            # Grid
            ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#D1D5DB')),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 8),
            ('VALIGN', (0, 1), (-1, -1), 'TOP'),
            ('TOPPADDING', (0, 1), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 4),
            ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(tbl)

    # Footer with page number via a custom canvas
    def _footer(canvas, doc):
        canvas.saveState()
        canvas.setFont('Helvetica', 8)
        canvas.setFillColor(colors.HexColor('#6B7280'))
        canvas.drawCentredString(
            page_size[0] / 2,
            10 * mm,
            f"Pagina {doc.page}  |  {title}",
        )
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()

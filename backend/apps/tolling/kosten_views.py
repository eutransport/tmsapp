"""Tolkosten per kenteken voor een week of maand, zonder losse passages.

Telt alle tolregels in de periode mee, ook die al gefactureerd of in een
afgesloten periode gearchiveerd zijn: het gaat om wat de wagen gekost heeft.
"""
from __future__ import annotations

import io
from decimal import Decimal

from django.db.models import Count, Sum
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from .buitenland_views import _periode
from .models import TollingEvent
from .services import build_vehicle_lookup


def kosten_per_kenteken(params) -> tuple[list[dict], str]:
    start, einde, label = _periode(params)
    groepen = (TollingEvent.objects
               .filter(start_at__gte=start, start_at__lt=einde)
               .values('license_plate_normalized')
               .annotate(passages=Count('id'), km=Sum('distance_km'), bedrag=Sum('amount')))
    vloot = build_vehicle_lookup()
    rijen = []
    for groep in groepen:
        norm = groep['license_plate_normalized'] or ''
        wagen = vloot.get(norm)
        rijen.append({
            'kenteken': (wagen.kenteken if wagen is not None and wagen.kenteken else norm) or 'Onbekend',
            'passages': groep['passages'],
            'km': groep['km'] or Decimal('0'),
            'bedrag': groep['bedrag'] or Decimal('0'),
        })
    rijen.sort(key=lambda r: r['kenteken'])
    return rijen, label


def naar_xlsx(rijen: list[dict], label: str) -> bytes:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = 'Kosten per kenteken'
    ws.append([f'Tolkosten per kenteken — {label}'])
    ws['A1'].font = Font(bold=True, size=12)
    ws.append([])
    koppen = ['Kenteken', 'Passages', 'Afstand (km)', 'Totaal (EUR)']
    ws.append(koppen)
    kopregel = ws.max_row
    vul = PatternFill(start_color='1F2937', end_color='1F2937', fill_type='solid')
    for kolom in range(1, len(koppen) + 1):
        cel = ws.cell(row=kopregel, column=kolom)
        cel.font = Font(bold=True, color='FFFFFF')
        cel.fill = vul
        cel.alignment = Alignment(horizontal='center')

    for rij in rijen:
        ws.append([rij['kenteken'], rij['passages'], float(rij['km']), float(rij['bedrag'])])
        ws.cell(row=ws.max_row, column=3).number_format = '#,##0.0'
        ws.cell(row=ws.max_row, column=4).number_format = '€ #,##0.00'

    ws.append(['Totaal', sum(r['passages'] for r in rijen),
               float(sum((r['km'] for r in rijen), Decimal('0'))),
               float(sum((r['bedrag'] for r in rijen), Decimal('0')))])
    totaal = ws.max_row
    for kolom in range(1, len(koppen) + 1):
        ws.cell(row=totaal, column=kolom).font = Font(bold=True)
        ws.cell(row=totaal, column=kolom).fill = PatternFill(
            start_color='DBEAFE', end_color='DBEAFE', fill_type='solid')
    ws.cell(row=totaal, column=3).number_format = '#,##0.0'
    ws.cell(row=totaal, column=4).number_format = '€ #,##0.00'

    for letter, breedte in zip('ABCD', (16, 11, 14, 16)):
        ws.column_dimensions[letter].width = breedte

    stroom = io.BytesIO()
    wb.save(stroom)
    return stroom.getvalue()


def naar_pdf(rijen: list[dict], label: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    def euro(bedrag) -> str:
        tekst = f'{float(bedrag):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
        return f'€ {tekst}'

    styles = getSampleStyleSheet()
    stroom = io.BytesIO()
    doc = SimpleDocTemplate(stroom, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm,
                            title=f'Tolkosten per kenteken {label}')
    data = [['Kenteken', 'Passages', 'Afstand (km)', 'Totaal']]
    for rij in rijen:
        data.append([rij['kenteken'], str(rij['passages']),
                     f"{float(rij['km']):,.0f}".replace(',', '.'), euro(rij['bedrag'])])
    data.append(['Totaal', str(sum(r['passages'] for r in rijen)),
                 f"{float(sum((r['km'] for r in rijen), Decimal('0'))):,.0f}".replace(',', '.'),
                 euro(sum((r['bedrag'] for r in rijen), Decimal('0')))])

    tabel = Table(data, colWidths=[55 * mm, 30 * mm, 40 * mm, 45 * mm], repeatRows=1)
    tabel.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1F2937')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#DBEAFE')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#F3F4F6')]),
        ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
        ('GRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#D1D5DB')),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    doc.build([
        Paragraph('Tolkosten per kenteken', styles['Title']),
        Paragraph(f'Periode: {label}', styles['Normal']),
        Spacer(1, 8),
        tabel,
    ])
    return stroom.getvalue()


class TolKostenViewSet(viewsets.ViewSet):
    """Totaal aan tolheffing per kenteken voor een gekozen week of maand."""

    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def list(self, request):
        try:
            rijen, label = kosten_per_kenteken(request.query_params)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'periode': label,
            'rijen': [{**r, 'km': float(r['km']), 'bedrag': float(r['bedrag'])} for r in rijen],
            'totaal': float(sum((r['bedrag'] for r in rijen), Decimal('0'))),
        })

    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        try:
            rijen, label = kosten_per_kenteken(request.query_params)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        bestand = ''.join(c if c.isalnum() or c in '-_' else '_'
                          for c in f'tolkosten_per_kenteken_{label}'.lower())
        # 'export_format' i.p.v. 'format': DRF gebruikt 'format' zelf.
        if (request.query_params.get('export_format') or '').lower() == 'pdf':
            antwoord = HttpResponse(naar_pdf(rijen, label), content_type='application/pdf')
            antwoord['Content-Disposition'] = f'attachment; filename="{bestand}.pdf"'
            return antwoord
        antwoord = HttpResponse(
            naar_xlsx(rijen, label),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        antwoord['Content-Disposition'] = f'attachment; filename="{bestand}.xlsx"'
        return antwoord

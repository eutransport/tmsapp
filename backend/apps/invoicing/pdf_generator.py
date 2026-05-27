"""PDF generator service voor facturen - gebruikt template layout."""
import io
import os
import requests
from datetime import date
from decimal import Decimal
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, Frame, PageTemplate
from reportlab.lib.enums import TA_RIGHT, TA_CENTER, TA_LEFT
from django.conf import settings as django_settings

from apps.core.models import AppSettings


class InvoicePDFGenerator:
    """Genereer PDF facturen op basis van template layout."""
    
    def __init__(self, invoice):
        self.invoice = invoice
        self.template = invoice.template
        self.template_layout = invoice.template.layout or {}
        self.app_settings = AppSettings.get_settings()
        self.styles = getSampleStyleSheet()
        self._create_custom_styles()
        
        # Get template sections
        self.header = self.template_layout.get('header', {})
        self.subheader = self.template_layout.get('subheader', {})
        self.columns = self.template_layout.get('columns', [])
        self.footer_section = self.template_layout.get('footer', {})
        self.defaults = self.template_layout.get('defaults', {})
        self.totals_config = self.template_layout.get('totals', {})
        self.table_style = self.template_layout.get('tableStyle', {
            'headerBackground': '#1f2937',
            'headerTextColor': '#ffffff',
            'headerFont': 'Helvetica',
            'evenRowBackground': '#ffffff',
            'oddRowBackground': '#f9fafb',
            'rowTextColor': '#1f2937',
            'rowFont': 'Helvetica',
        })
    
    def _create_custom_styles(self):
        """Maak custom paragraph styles."""
        self.styles.add(ParagraphStyle(
            name='InvoiceTitle',
            parent=self.styles['Heading1'],
            fontSize=18,
            spaceAfter=5,
            textColor=colors.HexColor('#1f2937'),
            alignment=TA_CENTER
        ))
        self.styles.add(ParagraphStyle(
            name='CompanyName',
            parent=self.styles['Normal'],
            fontSize=14,
            fontName='Helvetica-Bold',
            textColor=colors.HexColor('#1f2937')
        ))
        self.styles.add(ParagraphStyle(
            name='SmallText',
            parent=self.styles['Normal'],
            fontSize=9,
            textColor=colors.HexColor('#4b5563')
        ))
        self.styles.add(ParagraphStyle(
            name='RightAlign',
            parent=self.styles['Normal'],
            alignment=TA_RIGHT,
            fontSize=10
        ))
        self.styles.add(ParagraphStyle(
            name='RightAlignSmall',
            parent=self.styles['Normal'],
            alignment=TA_RIGHT,
            fontSize=9
        ))
        self.styles.add(ParagraphStyle(
            name='CenterAlign',
            parent=self.styles['Normal'],
            alignment=TA_CENTER,
            fontSize=10
        ))
        self.styles.add(ParagraphStyle(
            name='StatusLabel',
            parent=self.styles['Normal'],
            fontSize=12,
            fontName='Helvetica-Bold',
            textColor=colors.HexColor('#f59e0b'),
            alignment=TA_CENTER
        ))
    
    def _get_field_content(self, field, position='left'):
        """Get content from a template field, replacing variables."""
        if not field:
            return None
        
        field_type = field.get('type', 'text')
        content = field.get('content', '')
        style = field.get('style', {})
        
        if field_type == 'image':
            # Try to load image with custom size
            image_url = field.get('imageUrl') or content
            image_width = field.get('imageWidth')  # in pixels
            image_height = field.get('imageHeight')  # in pixels
            if image_url:
                return self._load_image(image_url, image_width, image_height)
            return None
        
        elif field_type == 'variable':
            # Replace variable with actual value
            value = self._replace_variable(content)
            return self._apply_text_style(str(value), style)
        
        elif field_type == 'text':
            return self._apply_text_style(content, style)
        
        elif field_type == 'amount':
            return self._apply_text_style(content, style)
        
        elif field_type == 'date':
            return self._apply_text_style(content, style)
        
        return content
    
    def _replace_variable(self, var_name):
        """Replace a variable name with actual value."""
        var_map = {
            'factuurnummer': self.invoice.factuurnummer,
            'factuurdatum': self.invoice.factuurdatum.strftime('%d-%m-%Y'),
            'vervaldatum': self.invoice.vervaldatum.strftime('%d-%m-%Y'),
            'klant.naam': self.invoice.bedrijf.naam,
            'klant.adres': self.invoice.bedrijf.adres or '',
            'bedrijf.naam': self.app_settings.company_name or '',
            'bedrijf.adres': self.app_settings.company_address or '',
            'bedrijf.kvk': self.app_settings.company_kvk or '',
            'bedrijf.btw': self.app_settings.company_btw or '',
        }
        return var_map.get(var_name, f'{{{var_name}}}')
    
    def _apply_text_style(self, text, style):
        """Apply template style to text and return styled HTML for Paragraph."""
        if not text:
            return ''
        
        color = style.get('color', '#000000')
        bold = style.get('bold', False)
        italic = style.get('italic', False)
        font_size = style.get('fontSize', 12)
        font_family = style.get('fontFamily', 'Arial')
        
        # Map common font names to reportlab fonts
        font_map = {
            'Arial': 'Helvetica',
            'Helvetica': 'Helvetica',
            'Times New Roman': 'Times-Roman',
            'Georgia': 'Times-Roman',
            'Verdana': 'Helvetica',
            'Courier New': 'Courier',
        }
        reportlab_font = font_map.get(font_family, 'Helvetica')
        if bold:
            reportlab_font = reportlab_font + '-Bold'
        if italic:
            if '-Bold' in reportlab_font:
                reportlab_font = reportlab_font.replace('-Bold', '-BoldOblique')
            else:
                reportlab_font = reportlab_font + '-Oblique'
        
        # Convert newlines to <br/> for multiline text
        text_with_breaks = str(text).replace('\n', '<br/>')
        
        # Build styled text for Paragraph
        styled_text = f'<font name="{reportlab_font}" size="{font_size}" color="{color}">{text_with_breaks}</font>'
        return styled_text
    
    def _load_image(self, image_url, width_px=None, height_px=None):
        """Load image from URL or local path with optional size in pixels."""
        try:
            img = None
            if image_url.startswith('http'):
                # Download from URL
                response = requests.get(image_url, timeout=5)
                if response.status_code == 200:
                    img_data = io.BytesIO(response.content)
                    img = Image(img_data)
            else:
                # Local file - check media folder
                if image_url.startswith('/media/'):
                    local_path = os.path.join(django_settings.MEDIA_ROOT, image_url.replace('/media/', ''))
                else:
                    local_path = image_url
                
                if os.path.exists(local_path):
                    img = Image(local_path)
            
            if img:
                # Apply custom size if specified (convert pixels to points: 1px = 0.75pt)
                if width_px and height_px:
                    # Both specified
                    img.drawWidth = width_px * 0.75
                    img.drawHeight = height_px * 0.75
                elif width_px:
                    # Only width specified, keep aspect ratio
                    aspect = img.drawHeight / img.drawWidth
                    img.drawWidth = width_px * 0.75
                    img.drawHeight = img.drawWidth * aspect
                elif height_px:
                    # Only height specified, keep aspect ratio
                    aspect = img.drawWidth / img.drawHeight
                    img.drawHeight = height_px * 0.75
                    img.drawWidth = img.drawHeight * aspect
                else:
                    # No size specified, use default max width
                    aspect = img.drawHeight / img.drawWidth
                    img.drawWidth = min(img.drawWidth, 4*cm)
                    img.drawHeight = img.drawWidth * aspect
                return img
        except Exception as e:
            print(f"Could not load image {image_url}: {e}")
        return None
    
    def _draw_page_footer(self, canvas, doc):
        """Draw footer at the bottom of every page using template layout."""
        canvas.saveState()
        
        # Footer position
        page_width = A4[0]
        left_margin = 2*cm
        right_margin = 2*cm
        
        # Get raw field data for footer (not styled, we'll handle styling ourselves)
        left_field = self.footer_section.get('left')
        center_field = self.footer_section.get('center')
        right_field = self.footer_section.get('right')
        
        # Calculate footer height based on max lines
        def get_lines(field):
            if not field or field.get('type') == 'image':
                return []
            content = field.get('content', '')
            if field.get('type') == 'variable':
                content = self._replace_variable(content)
            return [line.strip() for line in str(content).split('\n') if line.strip()]
        
        left_lines = get_lines(left_field)
        center_lines = get_lines(center_field)
        right_lines = get_lines(right_field)
        
        max_lines = max(len(left_lines), len(center_lines), len(right_lines), 1)
        line_height = 10  # points
        footer_height = max_lines * line_height + 20
        
        # Draw line above footer
        footer_top_y = footer_height + 0.3*cm
        canvas.setStrokeColor(colors.HexColor('#e5e7eb'))
        canvas.setLineWidth(0.5)
        canvas.line(left_margin, footer_top_y, page_width - right_margin, footer_top_y)
        
        # Helper to draw multiline text
        def draw_multiline(lines, x, align='left', field=None):
            if not lines:
                return
            
            style = field.get('style', {}) if field else {}
            font_size = style.get('fontSize', 8)
            color = style.get('color', '#4b5563')
            bold = style.get('bold', False)
            italic = style.get('italic', False)
            
            # Map font
            font_family = style.get('fontFamily', 'Helvetica')
            font_map = {
                'Arial': 'Helvetica',
                'Helvetica': 'Helvetica',
                'Times New Roman': 'Times-Roman',
                'Georgia': 'Times-Roman',
                'Verdana': 'Helvetica',
                'Courier New': 'Courier',
            }
            font_name = font_map.get(font_family, 'Helvetica')
            if bold:
                font_name = font_name + '-Bold'
            if italic:
                if '-Bold' in font_name:
                    font_name = font_name.replace('-Bold', '-BoldOblique')
                else:
                    font_name = font_name + '-Oblique'
            
            canvas.setFont(font_name, font_size)
            try:
                canvas.setFillColor(colors.HexColor(color))
            except:
                canvas.setFillColor(colors.HexColor('#4b5563'))
            
            # Draw from top to bottom
            y = footer_top_y - 15  # Start below the line
            col_width = (page_width - left_margin - right_margin) / 3
            
            for line in lines:
                if align == 'left':
                    canvas.drawString(x, y, line)
                elif align == 'center':
                    text_width = canvas.stringWidth(line, font_name, font_size)
                    canvas.drawString(x + (col_width - text_width) / 2, y, line)
                elif align == 'right':
                    text_width = canvas.stringWidth(line, font_name, font_size)
                    canvas.drawString(x + col_width - text_width, y, line)
                y -= line_height
        
        # Column positions
        col_width = (page_width - left_margin - right_margin) / 3
        left_x = left_margin
        center_x = left_margin + col_width
        right_x = left_margin + 2 * col_width
        
        # Draw each column
        draw_multiline(left_lines, left_x, 'left', left_field)
        draw_multiline(center_lines, center_x, 'center', center_field)
        draw_multiline(right_lines, right_x, 'right', right_field)
        
        canvas.restoreState()
    
    def generate(self):
        """Genereer de PDF en return als bytes."""
        buffer = io.BytesIO()
        
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=2*cm,
            leftMargin=2*cm,
            topMargin=1.5*cm,
            bottomMargin=3.5*cm  # More space for footer
        )
        
        elements = []
        
        # Status banner voor concept facturen
        if self.invoice.status == 'concept':
            elements.append(Paragraph("⚠ CONCEPT FACTUUR", self.styles['StatusLabel']))
            elements.append(Spacer(1, 5*mm))
        
        # Header section (3 columns: left, center, right)
        elements.extend(self._build_template_header())
        
        # Subheader section
        elements.extend(self._build_template_subheader())
        
        # Klant info
        elements.extend(self._build_customer_info())
        
        # Factuurregels tabel
        elements.extend(self._build_lines_table())
        
        # Totalen
        elements.extend(self._build_totals())
        
        # Payment request (not in page footer, but in content)
        elements.extend(self._build_payment_info())
        
        # Build PDF with page footer callback
        doc.build(elements, onFirstPage=self._draw_page_footer, onLaterPages=self._draw_page_footer)
        
        buffer.seek(0)
        return buffer.getvalue()
    
    def _build_payment_info(self):
        """Build payment information section."""
        elements = []
        
        # Betaalinformatie from app settings
        footer_text = []
        if self.app_settings.company_iban:
            footer_text.append(f"<b>IBAN:</b> {self.app_settings.company_iban}")
        if self.app_settings.company_kvk:
            footer_text.append(f"<b>KVK:</b> {self.app_settings.company_kvk}")
        if self.app_settings.company_btw:
            footer_text.append(f"<b>BTW:</b> {self.app_settings.company_btw}")
        
        if footer_text:
            elements.append(Paragraph(" | ".join(footer_text), self.styles['SmallText']))
            elements.append(Spacer(1, 3*mm))
        
        # Opmerkingen
        if self.invoice.opmerkingen:
            elements.append(Paragraph("<b>Opmerkingen:</b>", self.styles['Normal']))
            elements.append(Paragraph(self.invoice.opmerkingen, self.styles['SmallText']))
            elements.append(Spacer(1, 3*mm))
        
        # Betaalverzoek - use custom text from settings or default
        payment_text = self.app_settings.invoice_payment_text or (
            'Wij verzoeken u vriendelijk het totaalbedrag vóór de vervaldatum over te maken '
            'op bovenstaand IBAN onder vermelding van het factuurnummer.'
        )
        
        # Replace variables in payment text
        payment_text = payment_text.replace('{bedrag}', f'€ {self.invoice.totaal:.2f}')
        payment_text = payment_text.replace('{vervaldatum}', self.invoice.vervaldatum.strftime('%d-%m-%Y'))
        payment_text = payment_text.replace('{factuurnummer}', self.invoice.factuurnummer)
        
        elements.append(Paragraph(payment_text, self.styles['SmallText']))
        
        return elements
    
    def _build_template_header(self):
        """Bouw de header op basis van template layout."""
        elements = []
        
        left_content = self._get_field_content(self.header.get('left'))
        center_content = self._get_field_content(self.header.get('center'))
        right_content = self._get_field_content(self.header.get('right'))
        
        # Build cells
        left_cell = []
        center_cell = []
        right_cell = []
        
        # Left: usually logo
        if left_content:
            if isinstance(left_content, Image):
                left_cell.append(left_content)
            else:
                left_cell.append(Paragraph(str(left_content), self.styles['Normal']))
        
        # Center: usually "FACTUUR" title
        if center_content:
            if isinstance(center_content, Image):
                center_cell.append(center_content)
            else:
                center_cell.append(Paragraph(str(center_content), self.styles['Normal']))
        
        # Right: factuurnummer, datum (right aligned)
        if right_content:
            if isinstance(right_content, Image):
                right_cell.append(right_content)
            else:
                right_cell.append(Paragraph(str(right_content), self.styles['RightAlign']))
        
        # Add invoice number and date to right
        right_cell.append(Paragraph(f"<b>Factuurnummer:</b> {self.invoice.factuurnummer}", self.styles['RightAlignSmall']))
        right_cell.append(Paragraph(f"<b>Datum:</b> {self.invoice.factuurdatum.strftime('%d-%m-%Y')}", self.styles['RightAlignSmall']))
        right_cell.append(Paragraph(f"<b>Vervaldatum:</b> {self.invoice.vervaldatum.strftime('%d-%m-%Y')}", self.styles['RightAlignSmall']))
        
        # Create 3-column header table
        header_table = Table([
            [left_cell, center_cell, right_cell]
        ], colWidths=[5.5*cm, 6*cm, 5.5*cm])
        
        header_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'CENTER'),
            ('ALIGN', (2, 0), (2, 0), 'RIGHT'),
        ]))
        
        elements.append(header_table)
        elements.append(Spacer(1, 8*mm))
        
        return elements
    
    def _build_template_subheader(self):
        """Bouw de subheader op basis van template layout."""
        elements = []
        
        left_content = self._get_field_content(self.subheader.get('left'))
        center_content = self._get_field_content(self.subheader.get('center'))
        right_content = self._get_field_content(self.subheader.get('right'))
        
        # Only add if there's content
        has_content = any([left_content, center_content, right_content])
        if not has_content:
            return elements
        
        # Handle multiline text (split by newlines from template)
        left_cell = []
        center_cell = []
        right_cell = []
        
        if left_content and not isinstance(left_content, Image):
            left_cell.append(Paragraph(str(left_content), self.styles['Normal']))
        elif left_content:
            left_cell.append(left_content)
        
        if center_content and not isinstance(center_content, Image):
            center_cell.append(Paragraph(str(center_content), self.styles['CenterAlign']))
        elif center_content:
            center_cell.append(center_content)
        
        if right_content and not isinstance(right_content, Image):
            right_cell.append(Paragraph(str(right_content), self.styles['RightAlign']))
        elif right_content:
            right_cell.append(right_content)
        
        subheader_table = Table([
            [left_cell, center_cell, right_cell]
        ], colWidths=[5.5*cm, 6*cm, 5.5*cm])
        
        subheader_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (0, 0), (0, 0), 'LEFT'),
            ('ALIGN', (1, 0), (1, 0), 'CENTER'),
            ('ALIGN', (2, 0), (2, 0), 'RIGHT'),
        ]))
        
        elements.append(subheader_table)
        elements.append(Spacer(1, 5*mm))
        
        return elements
    
    def _build_customer_info(self):
        """Bouw de klant informatie sectie - alleen als er geen subheader velden zijn."""
        elements = []
        
        # Check if subheader already contains any content - if so, skip customer info
        # because the customer info should be defined in the template subheader
        subheader_has_content = False
        for pos in ['left', 'center', 'right']:
            field = self.subheader.get(pos)
            if field and (field.get('content') or field.get('imageUrl')):
                subheader_has_content = True
                break
        
        # If subheader has any content, skip this section (customer info comes from template)
        if subheader_has_content:
            return elements
        
        # Only show customer info if template has no subheader defined
        bedrijf = self.invoice.bedrijf
        
        elements.append(Paragraph(bedrijf.naam, self.styles['CompanyName']))
        
        if bedrijf.adres:
            elements.append(Paragraph(bedrijf.adres, self.styles['Normal']))
        if bedrijf.postcode or bedrijf.stad:
            elements.append(Paragraph(f"{bedrijf.postcode} {bedrijf.stad}".strip(), self.styles['Normal']))
        if bedrijf.kvk:
            elements.append(Paragraph(f"KVK: {bedrijf.kvk}", self.styles['SmallText']))
        
        elements.append(Spacer(1, 8*mm))
        
        return elements
    
    def _build_lines_table(self):
        """Bouw de factuurregels tabel op basis van template columns."""
        elements = []
        
        # Use template columns or default
        if self.columns:
            headers = [col.get('naam', col.get('id', '')) for col in self.columns]
            col_widths = [col.get('breedte', 25) for col in self.columns]
        else:
            headers = ['Omschrijving', 'Aantal', 'Prijs', 'Totaal']
            col_widths = [40, 20, 20, 20]
        
        # Normalize widths to sum to 17cm (page width minus margins)
        total_width = sum(col_widths)
        page_width = 17*cm
        col_widths = [(w / total_width) * page_width for w in col_widths]
        
        # Tabel data
        data = [headers]
        
        for line in self.invoice.lines.order_by('volgorde', 'created_at'):
            # Info-only regels (bv. werktijden): alleen omschrijving tonen, rest leeg
            is_info_line = bool(line.extra_data and line.extra_data.get('info_line'))
            row = []
            for col in (self.columns or [{'id': 'omschrijving'}, {'id': 'aantal'}, {'id': 'prijs'}, {'id': 'totaal'}]):
                col_id = col.get('id', '')
                col_type = col.get('type', 'text')
                
                if col_id == 'omschrijving' or col_type == 'text':
                    row.append(Paragraph(line.omschrijving, self.styles['Normal']))
                elif is_info_line:
                    row.append('')
                elif col_id == 'aantal' or col_type == 'aantal':
                    val = line.aantal
                    row.append(f"{val:.2f}".rstrip('0').rstrip('.') if val else '0')
                elif col_id == 'prijs' or col_type == 'prijs':
                    row.append(f"€ {line.prijs_per_eenheid:.2f}")
                elif col_type == 'berekend' or col_id == 'totaal':
                    row.append(f"€ {line.totaal:.2f}")
                else:
                    row.append('')
            data.append(row)
        
        # Als er geen regels zijn
        if len(data) == 1:
            data.append([Paragraph('Geen factuurregels', self.styles['Normal'])] + [''] * (len(headers) - 1))
        
        # Maak tabel
        table = Table(data, colWidths=col_widths)
        
        # Get table style from template
        header_bg = colors.HexColor(self.table_style.get('headerBackground', '#1f2937'))
        header_text = colors.HexColor(self.table_style.get('headerTextColor', '#ffffff'))
        header_font = self.table_style.get('headerFont', 'Helvetica')
        even_bg = colors.HexColor(self.table_style.get('evenRowBackground', '#ffffff'))
        odd_bg = colors.HexColor(self.table_style.get('oddRowBackground', '#f9fafb'))
        row_text = colors.HexColor(self.table_style.get('rowTextColor', '#1f2937'))
        row_font = self.table_style.get('rowFont', 'Helvetica')
        
        # Map font names
        font_map = {
            'Arial': 'Helvetica',
            'Helvetica': 'Helvetica',
            'Times New Roman': 'Times-Roman',
            'Georgia': 'Times-Roman',
            'Verdana': 'Helvetica',
            'Courier New': 'Courier',
        }
        header_font = font_map.get(header_font, 'Helvetica')
        row_font = font_map.get(row_font, 'Helvetica')
        
        table.setStyle(TableStyle([
            # Header style
            ('BACKGROUND', (0, 0), (-1, 0), header_bg),
            ('TEXTCOLOR', (0, 0), (-1, 0), header_text),
            ('FONTNAME', (0, 0), (-1, 0), header_font + '-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 10),
            ('TOPPADDING', (0, 0), (-1, 0), 10),
            
            # Data rows
            ('TEXTCOLOR', (0, 1), (-1, -1), row_text),
            ('FONTNAME', (0, 1), (-1, -1), row_font),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
            
            # Alignment - numbers right, text left
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            
            # Grid
            ('LINEBELOW', (0, 0), (-1, 0), 1, header_bg),
            ('LINEBELOW', (0, 1), (-1, -2), 0.5, colors.HexColor('#e5e7eb')),
            ('LINEBELOW', (0, -1), (-1, -1), 1, header_bg),
            
            # Alternating row colors
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [odd_bg, even_bg]),
        ]))
        
        elements.append(table)
        elements.append(Spacer(1, 8*mm))
        
        return elements
    
    def _build_totals(self):
        """Bouw de totalen sectie."""
        elements = []
        
        btw_pct = self.totals_config.get('btwPercentage', self.invoice.btw_percentage) or 21
        
        totals_data = []
        
        if self.totals_config.get('showSubtotaal', True):
            totals_data.append(['Subtotaal (excl. BTW):', f"€ {self.invoice.subtotaal:.2f}"])
        
        if self.totals_config.get('showBtw', True):
            totals_data.append([f'BTW ({btw_pct}%):', f"€ {self.invoice.btw_bedrag:.2f}"])
        
        if self.totals_config.get('showTotaal', True):
            totals_data.append(['Totaal (incl. BTW):', f"€ {self.invoice.totaal:.2f}"])
        
        if not totals_data:
            return elements
        
        totals_table = Table(totals_data, colWidths=[12*cm, 5*cm])
        
        totals_table.setStyle(TableStyle([
            ('ALIGN', (0, 0), (0, -1), 'RIGHT'),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 10),
            ('FONTSIZE', (0, -1), (-1, -1), 11),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LINEABOVE', (0, -1), (-1, -1), 1, colors.HexColor('#1f2937')),
        ]))
        
        elements.append(totals_table)
        elements.append(Spacer(1, 15*mm))
        
        return elements


def generate_invoice_pdf(invoice):
    """Helper functie om PDF te genereren voor een factuur."""
    generator = InvoicePDFGenerator(invoice)
    return generator.generate()

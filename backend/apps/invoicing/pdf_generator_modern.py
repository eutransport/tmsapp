"""Modern (strakke) PDF factuur layout.

Gebruikt wanneer `InvoiceTemplate.layout['layoutStyle'] == 'modern'`. Config
zit onder `layout['modern']`:

    {
      "layoutStyle": "modern",
      "modern": {
        "preset": "prime",
        "accentColor": "#7c3aed",
        "logoMode": "logo-left-text-right",  # of "logo-only"/"text-only"/"logo-top-text-bottom"
        "companyNameOverride": "",           # leeg = AppSettings.company_name
        "typeLabels": {
          "verkoop": "FACTUUR",
          "credit":  "CREDITFACTUUR",
          "inkoop":  "INKOOPFACTUUR"
        }
      }
    }
"""
from __future__ import annotations

import io
import os
import re
from decimal import Decimal
from xml.sax.saxutils import escape as xml_escape

from django.conf import settings as django_settings
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    Image,
    SimpleDocTemplate,
    Spacer,
    TableStyle,
)

from apps.core.models import AppSettings
# Paragraph en Table lopen via deze varianten, zodat tekens die het
# ingebouwde lettertype niet kent geen zwart blokje worden in de PDF.
from apps.core.pdf_tekst import (
    VeiligeParagraph as Paragraph,
    VeiligeTable as Table,
)


DEFAULT_TYPE_LABELS = {
    'verkoop': 'FACTUUR',
    'credit': 'CREDITFACTUUR',
    'inkoop': 'INKOOPFACTUUR',
}

# Preset accent colors — komen 1-op-1 overeen met de 10 templates in de UI.
PRESET_ACCENTS = {
    'nexora':    '#ea580c',  # oranje
    'movento':   '#2563eb',  # blauw
    'rapido':    '#d4a017',  # goud
    'greenway':  '#65a30d',  # groen
    'northline': '#111827',  # zwart
    'flextrans': '#0d9488',  # teal
    'boxway':    '#1e3a8a',  # donkerblauw
    'speedo':    '#dc2626',  # rood
    'prime':     '#7c3aed',  # paars
    'elevate':   '#c19a3b',  # goud op donker
}


def _hex(color: str, fallback: str = '#111827') -> colors.Color:
    try:
        return colors.HexColor(color)
    except Exception:
        return colors.HexColor(fallback)


class ModernInvoicePDFGenerator:
    """Strakke, moderne A4 factuur (1 kolom, accentkleur, dun lijntje)."""

    def __init__(self, invoice):
        self.invoice = invoice
        self.template = invoice.template
        layout = (invoice.template.layout if invoice.template else None) or {}
        self.modern = layout.get('modern') or {}
        self.app_settings = AppSettings.get_settings()

        preset = self.modern.get('preset') or 'prime'
        self.accent_hex = (
            self.modern.get('accentColor')
            or PRESET_ACCENTS.get(preset, '#7c3aed')
        )
        self.accent = _hex(self.accent_hex, '#7c3aed')
        self.logo_mode = self.modern.get('logoMode') or 'logo-left-text-right'
        # Layout variant: classic (default) | band | stacked | minimal
        self.variant = self.modern.get('variant') or 'classic'

        raw_labels = self.modern.get('typeLabels') or {}
        self.type_labels = {**DEFAULT_TYPE_LABELS, **raw_labels}

        self.styles = getSampleStyleSheet()
        self._create_custom_styles()

    # ---- styles ----------------------------------------------------------
    def _create_custom_styles(self):
        self.styles.add(ParagraphStyle(
            name='ModTitle',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=28,
            leading=32,
            textColor=self.accent,
            alignment=TA_RIGHT,
        ))
        # Variant-specifiek: band = wit op accent, groot en rechts
        self.styles.add(ParagraphStyle(
            name='ModTitleBand',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=26,
            leading=30,
            textColor=colors.white,
            alignment=TA_RIGHT,
        ))
        # Variant stacked: enorm groot en gecentreerd in accentkleur
        self.styles.add(ParagraphStyle(
            name='ModTitleStacked',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=32,
            leading=36,
            textColor=self.accent,
            alignment=TA_CENTER,
        ))
        # Variant minimal: klein, gray, uppercase, wide tracking (fake via caps)
        self.styles.add(ParagraphStyle(
            name='ModTitleMinimal',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=11,
            leading=13,
            textColor=colors.HexColor('#374151'),
            alignment=TA_RIGHT,
        ))
        self.styles.add(ParagraphStyle(
            name='ModCompanyName',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=16,
            leading=18,
            textColor=colors.HexColor('#111827'),
        ))
        # Voor wit-op-accent (band variant)
        self.styles.add(ParagraphStyle(
            name='ModCompanyNameWhite',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=16,
            leading=18,
            textColor=colors.white,
        ))
        # Voor stacked variant, gecentreerd onder de titel
        self.styles.add(ParagraphStyle(
            name='ModCompanyNameCenter',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=13,
            leading=15,
            textColor=colors.HexColor('#374151'),
            alignment=TA_CENTER,
        ))
        self.styles.add(ParagraphStyle(
            name='ModCompanyNameSmall',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=12,
            leading=14,
            textColor=colors.HexColor('#111827'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModLabel',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=9,
            leading=11,
            textColor=colors.HexColor('#6b7280'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModLabelRight',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=9,
            leading=11,
            alignment=TA_RIGHT,
            textColor=colors.HexColor('#6b7280'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModBody',
            parent=self.styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=13,
            textColor=colors.HexColor('#1f2937'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModBodyRight',
            parent=self.styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=13,
            alignment=TA_RIGHT,
            textColor=colors.HexColor('#1f2937'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModMeta',
            parent=self.styles['Normal'],
            fontName='Helvetica',
            fontSize=9,
            leading=12,
            textColor=colors.HexColor('#4b5563'),
        ))
        # Compacte info-strip stijlen (adres + bankgegevens boven aan pagina)
        self.styles.add(ParagraphStyle(
            name='ModStrip',
            parent=self.styles['Normal'],
            fontName='Helvetica',
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor('#374151'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModStripWhite',
            parent=self.styles['Normal'],
            fontName='Helvetica',
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor('#e5e7eb'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModStripLabel',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor('#6b7280'),
        ))
        self.styles.add(ParagraphStyle(
            name='ModStripLabelWhite',
            parent=self.styles['Normal'],
            fontName='Helvetica-Bold',
            fontSize=8.5,
            leading=11,
            textColor=colors.HexColor('#d1d5db'),
        ))
        # "Bedankt voor uw vertrouwen" tekst
        self.styles.add(ParagraphStyle(
            name='ModThankYou',
            parent=self.styles['Normal'],
            fontName='Helvetica-Oblique',
            fontSize=22,
            leading=26,
            textColor=self.accent,
            alignment=TA_RIGHT,
        ))
        self.styles.add(ParagraphStyle(
            name='ModThankYouSub',
            parent=self.styles['Normal'],
            fontName='Helvetica',
            fontSize=10,
            leading=12,
            textColor=colors.HexColor('#6b7280'),
            alignment=TA_RIGHT,
        ))

    # ---- helpers ---------------------------------------------------------
    def _load_logo(self, max_w_pt: float, max_h_pt: float):
        """Return a reportlab Image scaled to fit the given box (in points).

        Regel:
        - Als de factuur aan een Administratie is gekoppeld, gebruiken we
          UITSLUITEND het logo van die administratie. Geen logo op de admin?
          Dan komt er ook géén logo op de factuur (geen stille terugval op
          AppSettings). Zo blijft het gedrag voorspelbaar: leeg = leeg.
        - Alleen als er geen administratie gekoppeld is, valt Modern terug
          op AppSettings.logo (bestaand gedrag voor oude facturen).
        Legacy PDF-template blijft ongewijzigd.
        """
        admin = getattr(self.invoice, 'administratie', None)
        if admin is not None:
            candidates = [getattr(admin, 'logo', None)]
        else:
            candidates = [getattr(self.app_settings, 'logo', None)]
        path = None
        for logo_field in candidates:
            try:
                if logo_field and getattr(logo_field, 'path', None) and os.path.exists(logo_field.path):
                    path = logo_field.path
                    break
            except Exception:
                continue
        if not path:
            return None
        try:
            img = Image(path)
            aspect = img.drawHeight / img.drawWidth if img.drawWidth else 1
            w = max_w_pt
            h = w * aspect
            if h > max_h_pt:
                h = max_h_pt
                w = h / aspect if aspect else max_w_pt
            img.drawWidth = w
            img.drawHeight = h
            return img
        except Exception:
            return None

    def _bedrijf(self, name: str) -> str:
        """Zelfde admin-first / AppSettings-fallback helper als de legacy
        generator. Gebruikt voor bedrijfsnaam / adres / contact / IBAN etc.
        """
        admin = getattr(self.invoice, 'administratie', None)
        mapping = {
            'naam':            ('naam',            'company_name'),
            'address':         ('adres_regel',     'company_address'),
            'postcode_plaats': ('postcode_plaats', None),
            'phone':           ('telefoon',        'company_phone'),
            'email':           ('email',           'company_email'),
            'iban':            ('iban',            'company_iban'),
            'kvk':             ('kvk',             'company_kvk'),
            'btw':             ('btw',             'company_btw'),
        }
        admin_attr, settings_attr = mapping.get(name, (None, None))
        if admin is not None and admin_attr:
            val = getattr(admin, admin_attr, '') or ''
            val = str(val).strip()
            if val:
                return val
        if settings_attr:
            val = getattr(self.app_settings, settings_attr, '') or ''
            return str(val).strip()
        return ''

    def _company_name(self) -> str:
        """Bedrijfsnaam-regel:
        - Als er een administratie gekoppeld is → gebruik ALTIJD admin.naam.
          De template-'companyNameOverride' wordt dan genegeerd, zodat het
          kiezen van een andere administratie meteen de juiste naam op de
          PDF geeft (geen 'stale' override uit het template).
        - Zonder administratie: gebruik companyNameOverride als gezet,
          anders AppSettings.company_name.
        """
        admin = getattr(self.invoice, 'administratie', None)
        if admin is not None:
            naam = (admin.naam or '').strip()
            if naam:
                return naam
            # admin zonder naam is theoretisch onmogelijk (verplicht veld),
            # maar val voor de zekerheid terug op AppSettings.
            return (self.app_settings.company_name or '').strip()
        override = (self.modern.get('companyNameOverride') or '').strip()
        if override:
            return override
        return (self.app_settings.company_name or '').strip()

    def _invoice_type_label(self) -> str:
        return self.type_labels.get(self.invoice.type, self.type_labels['verkoop'])

    def _thank_you_text(self) -> str:
        raw = self.modern.get('thankYouText')
        if raw is None:
            return ''
        return (raw or '').strip()

    # ---- sections --------------------------------------------------------
    def _build_top_info_bar(self):
        """Compacte strip boven aan de eerste pagina met bedrijfsadres links
        en IBAN/KVK/BTW rechts. Minimal variant slaat dit over."""
        if self.variant == 'minimal':
            return []

        is_dark = self.variant == 'band'
        text_style = self.styles['ModStripWhite'] if is_dark else self.styles['ModStrip']
        label_style = self.styles['ModStripLabelWhite'] if is_dark else self.styles['ModStripLabel']

        # ---- Left: bedrijfsnaam + adres ----
        name = self._company_name()
        # Als een administratie is gekoppeld met adres-velden: gebruik die als
        # gestructureerde adres-regels. Anders val terug op de vrij-tekst
        # company_address uit AppSettings.
        admin = getattr(self.invoice, 'administratie', None)
        addr_lines = []
        if admin is not None:
            adres_regel = (admin.adres_regel or '').strip()
            pc_plaats = (admin.postcode_plaats or '').strip()
            land = (admin.land or '').strip()
            if adres_regel:
                addr_lines.append(adres_regel)
            if pc_plaats:
                addr_lines.append(pc_plaats)
            if land:
                addr_lines.append(land)
        if not addr_lines:
            addr_raw = (self.app_settings.company_address or '').strip()
            addr_lines = [l.strip() for l in addr_raw.splitlines() if l.strip()]

        left_flow = []
        if name:
            # bedrijfsnaam in bold
            name_style = ParagraphStyle(
                'ModStripName', parent=text_style,
                fontName='Helvetica-Bold', fontSize=9.5, leading=12,
                textColor=colors.white if is_dark else colors.HexColor('#111827'),
            )
            left_flow.append(Paragraph(xml_escape(name), name_style))
        for line in addr_lines:
            left_flow.append(Paragraph(xml_escape(line), text_style))
        contact_bits = []
        phone = self._bedrijf('phone')
        email = self._bedrijf('email')
        if phone:
            contact_bits.append(phone)
        if email:
            contact_bits.append(email)
        if contact_bits:
            left_flow.append(Paragraph(xml_escape(' · '.join(contact_bits)), text_style))

        # ---- Right: IBAN / KVK / BTW als key-value rijtjes ----
        pay_rows = []
        iban = self._bedrijf('iban')
        kvk = self._bedrijf('kvk')
        btw = self._bedrijf('btw')
        if iban:
            pay_rows.append(('IBAN', iban))
        if kvk:
            pay_rows.append(('KVK', kvk))
        if btw:
            pay_rows.append(('BTW', btw))

        if pay_rows:
            # Right-aligned styles voor de sleutel/waarde-cellen
            label_style_r = ParagraphStyle(
                'ModStripLabelRight', parent=label_style, alignment=2,  # 2 = TA_RIGHT
            )
            text_style_r = ParagraphStyle(
                'ModStripTextRight', parent=text_style, alignment=2,
            )
            data = []
            for label, value in pay_rows:
                data.append([
                    Paragraph(label, label_style_r),
                    Paragraph(f'<b>{value}</b>', text_style_r),
                ])
            # Rechter tabel: label-kolom smal, waarde-kolom breder, beide
            # rechts uitgelijnd binnen de strip.
            inner_right = Table(
                data,
                colWidths=[1.2 * cm, 5.2 * cm],
                hAlign='RIGHT',
                style=TableStyle([
                    ('LEFTPADDING', (0, 0), (-1, -1), 0),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                    ('TOPPADDING', (0, 0), (-1, -1), 0),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
                    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('ALIGN', (0, 0), (-1, -1), 'RIGHT'),
                ]),
            )
            right_flow = [inner_right]
        else:
            right_flow = []

        # ---- Assemble strip ----
        strip = Table(
            [[left_flow, right_flow]],
            colWidths=[10 * cm, 7 * cm],
        )
        strip_style = [
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 12 if is_dark else 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 12 if is_dark else 0),
            ('TOPPADDING', (0, 0), (-1, -1), 10 if is_dark else 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 10 if is_dark else 6),
            # Rechter kolom-inhoud rechts uitlijnen
            ('ALIGN', (1, 0), (1, 0), 'RIGHT'),
        ]
        if is_dark:
            strip_style.append(('BACKGROUND', (0, 0), (-1, -1), self.accent))
        else:
            # dun accent-lijntje onder de strip
            strip_style.append(('LINEBELOW', (0, 0), (-1, -1), 1.2, self.accent))
        strip.setStyle(TableStyle(strip_style))

        return [strip, Spacer(1, 6 * mm)]

    def _build_thank_you(self):
        """Grote schuine 'Bedankt' tekst rechts, met kleine sub-tekst."""
        txt = self._thank_you_text()
        if not txt:
            return []
        elements = [Spacer(1, 6 * mm)]
        elements.append(Paragraph(txt, self.styles['ModThankYou']))
        elements.append(Paragraph('voor uw vertrouwen', self.styles['ModThankYouSub']))
        return elements
    def _build_top_header(self):
        """Header per layout-variant: classic | band | stacked | minimal."""
        if self.variant == 'band':
            return self._header_band()
        if self.variant == 'stacked':
            return self._header_stacked()
        if self.variant == 'minimal':
            return self._header_minimal()
        return self._header_classic()

    # ---- header variants -------------------------------------------------
    def _logo_flags(self):
        want_logo = self.logo_mode in ('logo-only', 'logo-left-text-right', 'logo-top-text-bottom')
        want_text = self.logo_mode in ('text-only', 'logo-left-text-right', 'logo-top-text-bottom')
        return want_logo, want_text

    def _build_logo_name_cell(self, name_style, want_logo, want_text, logo_max_w=4.2 * cm, logo_max_h=1.8 * cm):
        """Bouw de logo/naam-cel op basis van logo_mode. Retourneert een lijst met flowables."""
        name = self._company_name()
        logo = self._load_logo(max_w_pt=logo_max_w, max_h_pt=logo_max_h) if want_logo else None
        # Fallback: geen logo → toon naam op logo-plek
        if want_logo and logo is None:
            want_text = True

        cell = []
        if logo and want_text and self.logo_mode == 'logo-top-text-bottom':
            cell.append(logo)
            cell.append(Spacer(1, 3))
            if name:
                cell.append(Paragraph(name, name_style))
        elif logo and want_text and self.logo_mode == 'logo-left-text-right':
            name_cell = [Paragraph(name, name_style)] if name else ['']
            inner = Table([[logo, name_cell]], colWidths=[logo_max_w + 4, None])
            inner.setStyle(TableStyle([
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('LEFTPADDING', (0, 0), (-1, -1), 0),
                ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ]))
            cell.append(inner)
        elif logo:
            cell.append(logo)
        elif name:
            cell.append(Paragraph(name, name_style))
        return cell

    def _header_classic(self):
        want_logo, want_text = self._logo_flags()
        left_cell = self._build_logo_name_cell(
            self.styles['ModCompanyName'], want_logo, want_text,
            logo_max_w=6.0 * cm, logo_max_h=2.6 * cm,
        )
        right_cell = [Paragraph(self._invoice_type_label(), self.styles['ModTitle'])]
        header = Table([[left_cell, right_cell]], colWidths=[10 * cm, 7 * cm])
        header.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        return [header, Spacer(1, 6 * mm)]

    def _header_band(self):
        """Nordic-look: de dark accent-strip staat al boven; deze rij is een
        clean witte header met logo links en grote FACTUUR-titel rechts (in
        accent-kleur), zoals bij Altura/Nordic uit de mockups."""
        want_logo, want_text = self._logo_flags()
        left_cell = self._build_logo_name_cell(
            self.styles['ModCompanyName'], want_logo, want_text,
            logo_max_w=6.0 * cm, logo_max_h=2.6 * cm,
        )
        right_cell = [Paragraph(self._invoice_type_label(), self.styles['ModTitle'])]
        header = Table([[left_cell, right_cell]], colWidths=[10 * cm, 7 * cm])
        header.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        return [header, Spacer(1, 6 * mm)]

    def _header_stacked(self):
        """Gecentreerd: eerst de titel groot, dan de logo/naam eronder."""
        want_logo, want_text = self._logo_flags()
        elements = []
        elements.append(Paragraph(self._invoice_type_label(), self.styles['ModTitleStacked']))
        elements.append(Spacer(1, 4 * mm))
        # Logo/naam gecentreerd in een 1-cel tabel
        content_cell = self._build_logo_name_cell(
            self.styles['ModCompanyNameCenter'], want_logo, want_text,
            logo_max_w=5.5 * cm, logo_max_h=2.4 * cm,
        )
        wrapper = Table([[content_cell]], colWidths=[17 * cm])
        wrapper.setStyle(TableStyle([
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(wrapper)
        # Dun lijntje in accent onder de header
        divider = Table([['']], colWidths=[17 * cm], rowHeights=[1])
        divider.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 1.2, self.accent),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        elements.append(Spacer(1, 3 * mm))
        elements.append(divider)
        elements.append(Spacer(1, 5 * mm))
        return elements

    def _header_minimal(self):
        """Klein, sober: kleine titel rechts, kleine logo/naam links, dunne lijn."""
        want_logo, want_text = self._logo_flags()
        left_cell = self._build_logo_name_cell(
            self.styles['ModCompanyName'], want_logo, want_text,
            logo_max_w=4.8 * cm, logo_max_h=1.8 * cm,
        )
        title_text = self._invoice_type_label().upper()
        right_cell = [Paragraph(title_text, self.styles['ModTitleMinimal'])]
        header = Table([[left_cell, right_cell]], colWidths=[13 * cm, 4 * cm])
        header.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'BOTTOM'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('LINEBELOW', (0, 0), (-1, -1), 0.6, colors.HexColor('#9ca3af')),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ]))
        return [header, Spacer(1, 6 * mm)]

    def _build_address_block(self):
        """Two columns: 'Gefactureerd aan' left, 'Bedrijfsgegevens' right."""
        klant = self.invoice.bedrijf
        left_lines = []
        left_lines.append(('Gefactureerd aan', 'label'))
        if klant.naam:
            left_lines.append((f'<b>{klant.naam}</b>', 'body'))
        if getattr(klant, 'adres', ''):
            left_lines.append((klant.adres, 'body'))
        pc_stad = ' '.join(x for x in [(klant.postcode or '').strip(), (klant.stad or '').strip()] if x)
        if pc_stad:
            left_lines.append((pc_stad, 'body'))
        if getattr(klant, 'land', ''):
            left_lines.append((klant.land, 'body'))
        if getattr(klant, 'kvk', ''):
            left_lines.append((f'KVK: {klant.kvk}', 'meta'))

        right_lines = []
        right_lines.append(('Factuurgegevens', 'label'))
        right_lines.append((f'Factuurnummer: <b>{self.invoice.factuurnummer}</b>', 'body'))
        right_lines.append((f'Factuurdatum: {self.invoice.factuurdatum.strftime("%d-%m-%Y")}', 'body'))
        right_lines.append((f'Vervaldatum: {self.invoice.vervaldatum.strftime("%d-%m-%Y")}', 'body'))

        def _to_flow(lines, align='left'):
            out = []
            for text, kind in lines:
                if kind == 'label':
                    style_name = 'ModLabelRight' if align == 'right' else 'ModLabel'
                    out.append(Paragraph(text.upper(), self.styles[style_name]))
                elif kind == 'meta':
                    out.append(Paragraph(text, self.styles['ModMeta']))
                else:
                    style_name = 'ModBodyRight' if align == 'right' else 'ModBody'
                    out.append(Paragraph(text, self.styles[style_name]))
            return out

        tbl = Table(
            [[_to_flow(left_lines, 'left'), _to_flow(right_lines, 'right')]],
            colWidths=[10.5 * cm, 6.5 * cm],
        )
        tbl.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))

        # dun lijntje eronder
        divider = Table([['']], colWidths=[17 * cm], rowHeights=[1])
        divider.setStyle(TableStyle([
            ('LINEBELOW', (0, 0), (-1, -1), 0.6, colors.HexColor('#e5e7eb')),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ]))
        return [tbl, Spacer(1, 3 * mm), divider, Spacer(1, 5 * mm)]

    def _build_lines_table(self):
        headers = ['Omschrijving', 'Aantal', 'Prijs', 'Totaal']
        col_widths = [9.5 * cm, 2.2 * cm, 2.6 * cm, 2.7 * cm]

        data = [headers]
        for line in self.invoice.lines.order_by('volgorde', 'created_at'):
            is_info = bool(line.extra_data and line.extra_data.get('info_line'))
            omschrijving = Paragraph(line.omschrijving or '', self.styles['ModBody'])
            if is_info:
                data.append([omschrijving, '', '', ''])
                continue
            aantal_val = line.aantal
            aantal = f'{aantal_val:.2f}'.rstrip('0').rstrip('.') if aantal_val else '0'
            prijs = f'€ {line.prijs_per_eenheid:.2f}'
            totaal = f'€ {line.totaal:.2f}'
            data.append([omschrijving, aantal, prijs, totaal])

        if len(data) == 1:
            data.append([Paragraph('Geen factuurregels', self.styles['ModBody']), '', '', ''])

        tbl = Table(data, colWidths=col_widths, repeatRows=1)
        is_minimal = self.variant == 'minimal'
        header_bg = colors.white if is_minimal else self.accent
        header_fg = self.accent if is_minimal else colors.white
        style = [
            # header
            ('BACKGROUND', (0, 0), (-1, 0), header_bg),
            ('TEXTCOLOR', (0, 0), (-1, 0), header_fg),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 9),
            ('TOPPADDING', (0, 0), (-1, 0), 8),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('LEFTPADDING', (0, 0), (-1, 0), 8),
            ('RIGHTPADDING', (0, 0), (-1, 0), 8),
            # body
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#1f2937')),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
            ('LEFTPADDING', (0, 1), (-1, -1), 8),
            ('RIGHTPADDING', (0, 1), (-1, -1), 8),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('LINEBELOW', (0, 1), (-1, -1), 0.4, colors.HexColor('#e5e7eb')),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]
        if is_minimal:
            # dunne accent-lijn onder de header i.p.v. gevulde balk
            style.append(('LINEBELOW', (0, 0), (-1, 0), 1.5, self.accent))
        tbl.setStyle(TableStyle(style))
        return [tbl, Spacer(1, 4 * mm)]

    def _extract_km_totals(self):
        """Bereken totaal geregistreerde km (rit-regels) en totaal tolheffing-km
        uit de factuur-regels o.b.v. hun omschrijving. Returns (totaal, tol) floats."""
        totaal_km = 0.0
        tolheffing_km = 0.0
        rit_re = re.compile(r'\(\s*(\d+(?:[.,]\d+)?)\s*km\s*\)\s*$', re.IGNORECASE)
        tol_re = re.compile(r'Totaal\s+(\d+(?:[.,]\d+)?)\s*km', re.IGNORECASE)
        try:
            lines = list(self.invoice.lines.all())
        except Exception:
            lines = []
        for line in lines:
            omschr = (line.omschrijving or '')
            if not omschr:
                continue
            low = omschr.lower()
            if low.startswith('tolheffing'):
                m = tol_re.search(omschr)
                if m:
                    try:
                        tolheffing_km += float(m.group(1).replace(',', '.'))
                    except ValueError:
                        pass
            elif low.startswith('rit'):
                m = rit_re.search(omschr)
                if m:
                    try:
                        totaal_km += float(m.group(1).replace(',', '.'))
                    except ValueError:
                        pass
        return totaal_km, tolheffing_km

    def _build_km_summary(self):
        """Kleine km-samenvatting boven de totalen. Alleen als er zowel rit-km
        als tolheffing-km op de factuur staan."""
        totaal_km, tolheffing_km = self._extract_km_totals()
        if totaal_km <= 0 or tolheffing_km <= 0:
            return []
        pct = (tolheffing_km / totaal_km) * 100.0
        def fmt(n):
            return f"{n:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')
        rows = [
            ['Totaal geregistreerde km', f"{fmt(totaal_km)} km"],
            ['Totaal tolheffing km', f"{fmt(tolheffing_km)} km"],
            ['Tolheffing / geregistreerd', f"{fmt(pct)} %"],
        ]
        tbl = Table(rows, colWidths=[3.6 * cm, 3.4 * cm], hAlign='RIGHT')
        tbl.setStyle(TableStyle([
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 8.5),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#6b7280')),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
            ('TOPPADDING', (0, 0), (-1, -1), 2),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        return [tbl, Spacer(1, 3 * mm)]

    def _build_totals(self):
        totals_cfg = ((self.template.layout if self.template else {}) or {}).get('totals') or {}
        show_sub = totals_cfg.get('showSubtotaal', True)
        show_btw = totals_cfg.get('showBtw', True)
        show_tot = totals_cfg.get('showTotaal', True)

        cfg_pct = totals_cfg.get('btwPercentage')
        if cfg_pct is not None:
            btw_pct = cfg_pct
        elif self.invoice.btw_percentage is not None:
            btw_pct = self.invoice.btw_percentage
        else:
            btw_pct = 21

        rows = []
        if show_sub:
            rows.append(['SUBTOTAAL', f'€ {self.invoice.subtotaal:.2f}'])
        if show_btw:
            rows.append([f'BTW ({btw_pct}%)', f'€ {self.invoice.btw_bedrag:.2f}'])
        if show_tot:
            rows.append(['TOTAAL', f'€ {self.invoice.totaal:.2f}'])

        if not rows:
            return []

        tbl = Table(rows, colWidths=[3.6 * cm, 3.4 * cm], hAlign='RIGHT')
        style = [
            ('FONTNAME', (0, 0), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('TEXTCOLOR', (0, 0), (-1, -1), colors.HexColor('#4b5563')),
            ('ALIGN', (0, 0), (0, -1), 'LEFT'),
            ('ALIGN', (1, 0), (-1, -1), 'RIGHT'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]
        # accent voor TOTAAL rij
        if show_tot:
            if self.variant == 'minimal':
                # geen fill: alleen accentkleur tekst + dikke lijn erboven
                style += [
                    ('LINEABOVE', (0, -1), (-1, -1), 1.5, self.accent),
                    ('TEXTCOLOR', (0, -1), (-1, -1), self.accent),
                    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, -1), (-1, -1), 11),
                    ('TOPPADDING', (0, -1), (-1, -1), 8),
                    ('BOTTOMPADDING', (0, -1), (-1, -1), 8),
                ]
            else:
                style += [
                    ('BACKGROUND', (0, -1), (-1, -1), self.accent),
                    ('TEXTCOLOR', (0, -1), (-1, -1), colors.white),
                    ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
                    ('FONTSIZE', (0, -1), (-1, -1), 11),
                    ('TOPPADDING', (0, -1), (-1, -1), 8),
                    ('BOTTOMPADDING', (0, -1), (-1, -1), 8),
                ]
        tbl.setStyle(TableStyle(style))
        return [tbl, Spacer(1, 8 * mm)]

    def _build_payment_and_notes(self):
        out = []
        if self.invoice.opmerkingen:
            out.append(Paragraph('<b>Opmerkingen</b>', self.styles['ModBody']))
            out.append(Paragraph(self.invoice.opmerkingen, self.styles['ModMeta']))
            out.append(Spacer(1, 4 * mm))

        # Betaalgegevens (IBAN/KVK/BTW) staan al in de bovenste info-strip
        # bij alle varianten behalve 'minimal' — daar tonen we ze hier onderaan.
        if self.variant == 'minimal':
            pay_rows = []
            iban = self._bedrijf('iban')
            kvk = self._bedrijf('kvk')
            btw = self._bedrijf('btw')
            if iban:
                pay_rows.append(('IBAN', iban))
            if kvk:
                pay_rows.append(('KVK', kvk))
            if btw:
                pay_rows.append(('BTW', btw))

            if pay_rows:
                cells = []
                for label, value in pay_rows:
                    cells.append(Paragraph(
                        f'<font color="#6b7280">{label}</font>&nbsp;&nbsp;'
                        f'<font color="#111827"><b>{value}</b></font>',
                        self.styles['ModBody'],
                    ))
                while len(cells) < 3:
                    cells.append('')
                pay_tbl = Table([cells], colWidths=[5.7 * cm, 5.7 * cm, 5.6 * cm])
                pay_tbl.setStyle(TableStyle([
                    ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f9fafb')),
                    ('BOX', (0, 0), (-1, -1), 0.4, colors.HexColor('#e5e7eb')),
                    ('LEFTPADDING', (0, 0), (-1, -1), 10),
                    ('RIGHTPADDING', (0, 0), (-1, -1), 10),
                    ('TOPPADDING', (0, 0), (-1, -1), 8),
                    ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
                    ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ]))
                out.append(pay_tbl)
                out.append(Spacer(1, 4 * mm))

        payment_text = self.app_settings.invoice_payment_text or (
            'Wij verzoeken u vriendelijk het totaalbedrag vóór de vervaldatum '
            'over te maken op onderstaand IBAN onder vermelding van het factuurnummer.'
        )
        payment_text = (
            payment_text
            .replace('{bedrag}', f'€ {self.invoice.totaal:.2f}')
            .replace('{vervaldatum}', self.invoice.vervaldatum.strftime('%d-%m-%Y'))
            .replace('{factuurnummer}', self.invoice.factuurnummer)
        )
        out.append(Paragraph(payment_text, self.styles['ModMeta']))
        return out

    def _draw_footer(self, canvas, doc):
        """Sobere footer: paginanummer + factuurnummer. De bedrijfs- en
        bankgegevens staan al in de top info-strip van pagina 1."""
        canvas.saveState()
        page_w = A4[0]
        left = 2 * cm
        right = page_w - 2 * cm
        y_line = 1.8 * cm

        canvas.setStrokeColor(colors.HexColor('#e5e7eb'))
        canvas.setLineWidth(0.4)
        canvas.line(left, y_line, right, y_line)

        canvas.setFillColor(colors.HexColor('#6b7280'))
        canvas.setFont('Helvetica', 8)
        canvas.drawString(left, y_line - 12, f'Factuur {self.invoice.factuurnummer}')
        canvas.drawRightString(right, y_line - 12, f'Pagina {doc.page}')

        canvas.restoreState()

    # ---- entry -----------------------------------------------------------
    def generate(self) -> bytes:
        buf = io.BytesIO()
        doc = SimpleDocTemplate(
            buf,
            pagesize=A4,
            leftMargin=2 * cm,
            rightMargin=2 * cm,
            topMargin=1.2 * cm,
            bottomMargin=2.4 * cm,
        )
        elements = []
        if self.invoice.status == 'concept':
            elements.append(Paragraph(
                '<font color="#f59e0b"><b>⚠ CONCEPT FACTUUR</b></font>',
                self.styles['ModBody'],
            ))
            elements.append(Spacer(1, 3 * mm))
        elements += self._build_top_info_bar()
        elements += self._build_top_header()
        elements += self._build_address_block()
        elements += self._build_lines_table()
        elements += self._build_km_summary()
        elements += self._build_totals()
        elements += self._build_payment_and_notes()
        elements += self._build_thank_you()

        doc.build(
            elements,
            onFirstPage=self._draw_footer,
            onLaterPages=self._draw_footer,
        )
        return buf.getvalue()

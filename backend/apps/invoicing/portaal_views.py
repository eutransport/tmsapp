"""Facturen in het opdrachtgeversportaal.

Een opdrachtgever ziet uitsluitend verkoop- en creditfacturen die op naam van
zijn eigen bedrijf staan en die daadwerkelijk zijn verstuurd. Inkoopfacturen en
concepten blijven buiten beeld; dat is hier hard vastgelegd en niet via
queryparameters te beinvloeden.
"""
from __future__ import annotations

import logging
from datetime import date

from django.db.models import Sum
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsOpdrachtgever
from apps.tolling.models import TollingEvent

from .models import Invoice, InvoiceStatus, InvoiceType

logger = logging.getLogger(__name__)

ZICHTBARE_TYPES = (InvoiceType.VERKOOP, InvoiceType.CREDIT)
ZICHTBARE_STATUSSEN = (InvoiceStatus.VERZONDEN, InvoiceStatus.BETAALD)


def zichtbare_facturen(bedrijf_id):
    """De enige plek waar bepaald wordt wat een opdrachtgever mag zien."""
    if not bedrijf_id:
        return Invoice.objects.none()
    return Invoice.objects.filter(
        bedrijf_id=bedrijf_id,
        type__in=ZICHTBARE_TYPES,
        status__in=ZICHTBARE_STATUSSEN,
    )


def _regel(factuur: Invoice, vandaag: date, met_tol: set) -> dict:
    credit = factuur.type == InvoiceType.CREDIT
    openstaand = factuur.status != InvoiceStatus.BETAALD and not credit
    dagen = (factuur.vervaldatum - vandaag).days if factuur.vervaldatum else None
    return {
        'id': str(factuur.id),
        'factuurnummer': factuur.factuurnummer,
        'factuurdatum': factuur.factuurdatum,
        'vervaldatum': factuur.vervaldatum,
        'totaal': str(factuur.totaal),
        'credit': credit,
        'betaald': factuur.status == InvoiceStatus.BETAALD,
        'te_laat': bool(openstaand and dagen is not None and dagen < 0),
        'dagen_tot_vervaldatum': dagen,
        'heeft_tol': factuur.id in met_tol,
    }


class PortaalFacturenView(APIView):
    """GET /api/portaal/facturen/ — factuurregels van het eigen bedrijf."""

    permission_classes = [IsAuthenticated, IsOpdrachtgever]

    def get(self, request):
        vandaag = timezone.localdate()
        qs = zichtbare_facturen(request.user.opdrachtgever_bedrijf_id)

        filter_ = (request.query_params.get('filter') or '').strip()
        if filter_ == 'open':
            qs = qs.filter(status=InvoiceStatus.VERZONDEN, type=InvoiceType.VERKOOP)
        elif filter_ == 'te_laat':
            qs = qs.filter(
                status=InvoiceStatus.VERZONDEN,
                type=InvoiceType.VERKOOP,
                vervaldatum__lt=vandaag,
            )
        elif filter_ == 'betaald':
            qs = qs.filter(status=InvoiceStatus.BETAALD)

        zoek = (request.query_params.get('zoek') or '').strip()[:50]
        if zoek:
            qs = qs.filter(factuurnummer__icontains=zoek)

        jaar = (request.query_params.get('jaar') or '').strip()
        if jaar.isdigit():
            qs = qs.filter(factuurdatum__year=int(jaar))

        qs = qs.order_by('-factuurdatum', '-factuurnummer')
        totaal_aantal = qs.count()

        try:
            grootte = min(max(int(request.query_params.get('page_size', 25)), 1), 100)
        except ValueError:
            grootte = 25
        try:
            pagina = max(int(request.query_params.get('page', 1)), 1)
        except ValueError:
            pagina = 1
        start = (pagina - 1) * grootte

        pagina_facturen = list(qs[start:start + grootte])
        met_tol = set(
            TollingEvent.objects.filter(
                invoice_line__invoice__in=pagina_facturen
            ).values_list('invoice_line__invoice_id', flat=True)
        )
        rijen = [_regel(f, vandaag, met_tol) for f in pagina_facturen]
        return Response({'count': totaal_aantal, 'results': rijen})


class PortaalFactuurSamenvattingView(APIView):
    """GET /api/portaal/facturen/samenvatting/ — tellers voor het dashboard."""

    permission_classes = [IsAuthenticated, IsOpdrachtgever]

    def get(self, request):
        vandaag = timezone.localdate()
        qs = zichtbare_facturen(request.user.opdrachtgever_bedrijf_id)
        # Creditnota's zijn geen openstaande vordering en blijven buiten de tellers.
        open_qs = qs.filter(status=InvoiceStatus.VERZONDEN, type=InvoiceType.VERKOOP)

        eerstvolgende = (
            open_qs.filter(vervaldatum__gte=vandaag)
            .order_by('vervaldatum')
            .values('factuurnummer', 'vervaldatum', 'totaal')
            .first()
        )
        if eerstvolgende:
            eerstvolgende['totaal'] = str(eerstvolgende['totaal'])

        return Response({
            'open_aantal': open_qs.count(),
            'open_bedrag': str(open_qs.aggregate(s=Sum('totaal'))['s'] or 0),
            'te_laat_aantal': open_qs.filter(vervaldatum__lt=vandaag).count(),
            'te_laat_bedrag': str(
                open_qs.filter(vervaldatum__lt=vandaag).aggregate(s=Sum('totaal'))['s'] or 0
            ),
            'eerstvolgende': eerstvolgende,
        })


class PortaalFactuurPdfView(APIView):
    """GET /api/portaal/facturen/<id>/pdf/ — de factuur als PDF.

    De meeste facturen hebben geen opgeslagen bestand; die worden op aanvraag
    opgebouwd uit dezelfde generator als de interne download.
    """

    permission_classes = [IsAuthenticated, IsOpdrachtgever]

    def get(self, request, factuur_id):
        factuur = zichtbare_facturen(
            request.user.opdrachtgever_bedrijf_id
        ).filter(pk=factuur_id).first()
        if factuur is None:
            return Response({'detail': 'Factuur niet gevonden.'}, status=404)

        bestandsnaam = f"factuur-{factuur.factuurnummer.replace('/', '-')}.pdf"

        if factuur.pdf_file:
            try:
                factuur.pdf_file.open('rb')
                inhoud = factuur.pdf_file.read()
                factuur.pdf_file.close()
            except OSError:
                inhoud = None
        else:
            inhoud = None

        if inhoud is None:
            from .pdf_generator import generate_invoice_pdf
            try:
                inhoud = generate_invoice_pdf(factuur)
            except Exception:
                logger.exception('PDF voor factuur %s kon niet worden gemaakt', factuur.id)
                return Response({'detail': 'De factuur kon niet worden opgebouwd.'}, status=500)

        antwoord = HttpResponse(inhoud, content_type='application/pdf')
        antwoord['Content-Disposition'] = f'attachment; filename="{bestandsnaam}"'
        antwoord['X-Frame-Options'] = 'SAMEORIGIN'
        return antwoord


class PortaalFactuurTolView(APIView):
    """GET /api/portaal/facturen/<id>/tol/ — de tolspecificatie bij deze factuur.

    Hetzelfde overzicht dat als bijlage bij de factuurmail gaat.
    """

    permission_classes = [IsAuthenticated, IsOpdrachtgever]

    def get(self, request, factuur_id):
        factuur = zichtbare_facturen(
            request.user.opdrachtgever_bedrijf_id
        ).filter(pk=factuur_id).first()
        if factuur is None:
            return Response({'detail': 'Factuur niet gevonden.'}, status=404)

        from apps.tolling.pdf_generator import (
            build_tolling_pdf_filename,
            generate_tolling_events_pdf,
            get_tolling_events_for_invoice,
        )

        try:
            events = list(get_tolling_events_for_invoice(factuur))
        except Exception:
            logger.exception('Tolspecificatie van factuur %s kon niet worden geladen', factuur.id)
            events = []

        if not events:
            return Response({'detail': 'Bij deze factuur hoort geen tolheffing.'}, status=404)

        try:
            inhoud = generate_tolling_events_pdf(events, invoice=factuur)
            bestandsnaam = build_tolling_pdf_filename(events) or 'tolheffing.pdf'
        except Exception:
            logger.exception('Tolspecificatie van factuur %s kon niet worden gemaakt', factuur.id)
            return Response({'detail': 'De tolspecificatie kon niet worden opgebouwd.'}, status=500)

        antwoord = HttpResponse(inhoud, content_type='application/pdf')
        antwoord['Content-Disposition'] = f'attachment; filename="{bestandsnaam}"'
        antwoord['X-Frame-Options'] = 'SAMEORIGIN'
        return antwoord

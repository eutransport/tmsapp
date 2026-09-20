"""API voor het selectie-overzicht bij het maken van een tolheffing-factuur.

Bewust los van `views.py`: het maken van de factuur blijft precies zoals het
was. Deze endpoints laten alleen zien wat er buiten de factuur valt, en
kunnen achteraf de gekozen randregels aan de zojuist gemaakte factuur
toevoegen.
"""
from __future__ import annotations

import logging
from datetime import time

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission
from apps.invoicing.models import Invoice, InvoiceStatus

from . import factuur_detail
from .models import TollingEvent

logger = logging.getLogger(__name__)


def _bool(waarde, standaard: bool = False) -> bool:
    if waarde is None or waarde == '':
        return standaard
    return str(waarde).strip().lower() in ('1', 'true', 'yes', 'ja', 'on')


def _tijd(waarde) -> time | None:
    """"HH:MM" naar een tijd; leeg of onleesbaar levert niets op."""
    tekst = str(waarde or '').strip()
    if not tekst:
        return None
    try:
        uur, _, minuut = tekst.partition(':')
        return time(int(uur), int(minuut or 0))
    except ValueError:
        return None


def _geheel(waarde, standaard: int) -> int:
    try:
        return int(waarde)
    except (TypeError, ValueError):
        return standaard


class TollingFactuurDetailViewSet(viewsets.ViewSet):
    """Wat komt er wel en niet op de tolheffing-factuur."""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    @action(detail=False, methods=['get'], url_path='selectie')
    def selectie(self, request):
        """Overzicht van meegenomen en niet-meegenomen tolregels.

        Query: plate, year, week_start, period_weeks, bedrijf_id,
        exclude_weekend, cutoff_time, marge_minuten. Verandert niets.
        """
        p = request.query_params
        plate = (p.get('plate') or '').strip()
        if not plate:
            return Response({'detail': 'plate vereist.'}, status=400)
        jaar = _geheel(p.get('year'), 0)
        week_start = _geheel(p.get('week_start'), 0)
        if not jaar or not 1 <= week_start <= 53:
            return Response({'detail': 'year/week_start vereist.'}, status=400)
        periode = max(1, min(4, _geheel(p.get('period_weeks'), 1)))
        data = factuur_detail.selectie_overzicht(
            plate=plate,
            jaar=jaar,
            week_start=week_start,
            period_weeks=periode,
            bedrijf_id=p.get('bedrijf_id') or None,
            exclude_weekend=_bool(p.get('exclude_weekend'), True),
            cutoff_time=_tijd(p.get('cutoff_time')),
            marge_minuten=_geheel(p.get('marge_minuten'), factuur_detail.MARGE_MINUTEN),
        )
        return Response(data)

    @action(detail=False, methods=['post'], url_path='tijd-status')
    def tijd_status(self, request):
        """Bepaal per tolregel of hij binnen de rittijd of in de marge valt.

        Body: { event_ids: [...], marge_minuten }. Leest alleen; handig om
        na een strikte match te zien welke regels net voor of na de gereden
        tijd liggen.
        """
        ids = request.data.get('event_ids') or []
        if not isinstance(ids, list):
            return Response({'detail': 'event_ids moet een lijst zijn.'}, status=400)
        marge = _geheel(request.data.get('marge_minuten'), factuur_detail.MARGE_MINUTEN)
        if not ids:
            return Response({'marge_minuten': marge, 'statussen': {}})
        events = list(TollingEvent.objects.filter(id__in=ids[:2000]))
        statussen = factuur_detail.tijdstatus(events, marge_minuten=marge)
        return Response({
            'marge_minuten': marge,
            'statussen': {str(sleutel): waarde for sleutel, waarde in statussen.items()},
        })

    @action(detail=False, methods=['post'], url_path='voeg-marge-toe')
    def voeg_marge_toe(self, request):
        """Zet gekozen randregels alsnog op een concept-factuur.

        Body: { invoice_id, event_ids: [...], marge_minuten }
        """
        invoice_id = request.data.get('invoice_id')
        try:
            invoice = Invoice.objects.get(id=invoice_id)
        except (Invoice.DoesNotExist, ValueError, TypeError):
            return Response({'detail': 'Factuur niet gevonden.'}, status=404)
        if invoice.status != InvoiceStatus.CONCEPT:
            return Response(
                {'detail': 'Alleen bij een concept-factuur kunnen regels worden bijgeplaatst.'},
                status=400,
            )
        resultaat = factuur_detail.voeg_marge_events_toe(
            invoice,
            request.data.get('event_ids') or [],
            user=request.user,
            marge_minuten=_geheel(request.data.get('marge_minuten'),
                                  factuur_detail.MARGE_MINUTEN),
        )
        return Response(resultaat)

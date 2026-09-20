"""API voor het herkoppelen ("sync") van tolregels aan factuurregels.

Bewust los van `views.py`: de import en de facturatie blijven ongewijzigd.
Deze endpoints lezen de bestaande factuurregels en zetten open tolregels
terug op gefactureerd.
"""
from __future__ import annotations

import logging
from datetime import date

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission
from apps.invoicing.models import InvoiceLine

from . import reconcile

logger = logging.getLogger(__name__)


def _datum(waarde) -> date | None:
    if not waarde:
        return None
    try:
        return date.fromisoformat(str(waarde))
    except ValueError:
        return None


def _bool(waarde, standaard: bool = False) -> bool:
    if waarde is None:
        return standaard
    return str(waarde).strip().lower() in ('1', 'true', 'yes', 'ja', 'on')


class TollingSyncViewSet(viewsets.ViewSet):
    """Herkoppelen van tolregels na een her-import."""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    @action(detail=False, methods=['get'], url_path='preview')
    def preview(self, request):
        """Voorstel per factuurregel; verandert niets.

        Query: date_from, date_to (factuurdatum), bedrijf_id.
        """
        data = reconcile.analyseer(
            datum_vanaf=_datum(request.query_params.get('date_from')),
            datum_tot=_datum(request.query_params.get('date_to')),
            bedrijf_id=request.query_params.get('bedrijf_id') or None,
        )
        return Response(data)

    @action(detail=False, methods=['post'], url_path='apply')
    def apply(self, request):
        """Koppel de bevestigde voorstellen.

        Body: { items: [{ line_id, event_ids: [...] }, ...] }
        """
        items = request.data.get('items')
        if not isinstance(items, list) or not items:
            return Response({'detail': 'Geen regels opgegeven.'}, status=400)

        resultaten = []
        totaal = 0
        for item in items:
            line_id = (item or {}).get('line_id')
            event_ids = (item or {}).get('event_ids') or []
            if not line_id or not isinstance(event_ids, list) or not event_ids:
                continue
            try:
                line = InvoiceLine.objects.select_related('invoice').get(id=line_id)
            except (InvoiceLine.DoesNotExist, ValueError, TypeError):
                resultaten.append({'line_id': str(line_id), 'gekoppeld': 0,
                                   'detail': 'Factuurregel niet gevonden.'})
                continue
            if not reconcile.is_tolregel(line):
                resultaten.append({'line_id': str(line_id), 'gekoppeld': 0,
                                   'detail': 'Dit is geen tolheffing-regel.'})
                continue
            aantal = reconcile.koppel(line, event_ids, user=request.user)
            totaal += aantal
            resultaten.append({
                'line_id': str(line.id),
                'factuurnummer': line.invoice.factuurnummer,
                'gekoppeld': aantal,
                'detail': '' if aantal else 'Geen open tolregels meer in deze selectie.',
            })
        return Response({'gekoppeld': totaal, 'regels': resultaten})

    @action(detail=False, methods=['get'], url_path='search')
    def search(self, request):
        """Handmatig zoeken: open tolregels van een kenteken in een periode.

        Query: plate, date_from, date_to, exclude_weekend, cutoff_hour.
        """
        plate = request.query_params.get('plate') or ''
        van = _datum(request.query_params.get('date_from'))
        tot = _datum(request.query_params.get('date_to'))
        if not plate or not van or not tot:
            return Response(
                {'detail': 'plate, date_from en date_to zijn vereist.'}, status=400)
        if tot < van:
            return Response({'detail': 'date_to ligt voor date_from.'}, status=400)
        afkapuur = request.query_params.get('cutoff_hour')
        try:
            afkapuur = int(afkapuur) if afkapuur not in (None, '') else None
        except ValueError:
            afkapuur = None
        data = reconcile.zoek_handmatig(
            plate, van, tot,
            excl_weekend=_bool(request.query_params.get('exclude_weekend')),
            afkapuur=afkapuur,
        )
        return Response(data)

    @action(detail=False, methods=['post'], url_path='unlink')
    def unlink(self, request):
        """Zet de tolregels van een factuurregel terug op open."""
        line_id = request.data.get('line_id')
        try:
            line = InvoiceLine.objects.select_related('invoice').get(id=line_id)
        except (InvoiceLine.DoesNotExist, ValueError, TypeError):
            return Response({'detail': 'Factuurregel niet gevonden.'}, status=404)
        aantal = reconcile.ontkoppel(line, user=request.user)
        return Response({'ontkoppeld': aantal})

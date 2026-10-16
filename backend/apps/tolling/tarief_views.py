"""Officiele toltarieven: status tonen en een gemelde wijziging afhandelen."""
from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from .models import TariefBron
from .tarief_bronnen import controleer_bronnen, zorg_voor_bronnen


def _als_dict(bron: TariefBron) -> dict:
    return {
        'id': str(bron.id),
        'land': bron.land,
        'naam': bron.naam,
        'url': bron.url,
        'aantal_regels': len(bron.tariefregels or []),
        'laatst_gecontroleerd': bron.laatst_gecontroleerd,
        'laatst_gewijzigd': bron.laatst_gewijzigd,
        'openstaand': bron.openstaand,
        'fout': bron.fout,
    }


class TariefBronViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def list(self, request):
        zorg_voor_bronnen()
        bronnen = [_als_dict(b) for b in TariefBron.objects.all()]
        return Response({
            'bronnen': bronnen,
            'openstaand': sum(1 for b in bronnen if b['openstaand']),
        })

    @action(detail=False, methods=['post'], url_path='controleren')
    def controleren(self, request):
        uitkomst = controleer_bronnen()
        uitkomst['bronnen'] = [_als_dict(b) for b in TariefBron.objects.all()]
        return Response(uitkomst)

    @action(detail=True, methods=['post'], url_path='afgehandeld')
    def afgehandeld(self, request, pk=None):
        bron = TariefBron.objects.get(pk=pk)
        bron.bevestigd_op = timezone.now()
        bron.bevestigd_door = request.user if request.user.is_authenticated else None
        bron.save(update_fields=['bevestigd_op', 'bevestigd_door'])
        return Response(_als_dict(bron))

    @action(detail=True, methods=['get'], url_path='regels')
    def regels(self, request, pk=None):
        bron = TariefBron.objects.get(pk=pk)
        return Response({'naam': bron.naam, 'url': bron.url,
                         'regels': bron.tariefregels or []})

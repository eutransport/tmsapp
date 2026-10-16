"""Tolstations: het land per stationsnaam bekijken en bevestigen."""
from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from .land_bepaling import LANDNAMEN
from .models import TolStation


def _als_dict(station: TolStation) -> dict:
    return {
        'id': str(station.id),
        'naam': station.naam,
        'land': station.land,
        'voorstel': station.voorstel,
        'landnaam': LANDNAMEN.get(station.land or station.voorstel, ''),
        'openstaand': station.openstaand,
        'aantal_regels': station.aantal_regels,
        'laatst_gezien': station.laatst_gezien,
    }


class TolStationViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def list(self, request):
        stations = TolStation.objects.all()
        if str(request.query_params.get('openstaand', '')).lower() in ('1', 'true'):
            stations = stations.filter(bevestigd_op__isnull=True)
        regels = [_als_dict(s) for s in stations]
        return Response({
            'stations': regels,
            'openstaand': TolStation.objects.filter(bevestigd_op__isnull=True).count(),
            'landen': [{'code': c, 'naam': n} for c, n in sorted(LANDNAMEN.items())],
        })

    @action(detail=True, methods=['post'], url_path='bevestig')
    def bevestig(self, request, pk=None):
        land = str(request.data.get('land') or '').strip().upper()
        if land not in LANDNAMEN:
            return Response({'detail': 'Kies een geldig land.'}, status=400)
        try:
            station = TolStation.objects.get(pk=pk)
        except TolStation.DoesNotExist:
            return Response({'detail': 'Station niet gevonden.'}, status=404)
        station.land = land
        station.bevestigd_op = timezone.now()
        station.bevestigd_door = request.user if request.user.is_authenticated else None
        station.save(update_fields=['land', 'bevestigd_op', 'bevestigd_door'])
        return Response(_als_dict(station))

    @action(detail=False, methods=['post'], url_path='voorstellen-overnemen')
    def voorstellen_overnemen(self, request):
        """Bevestig in een keer alle stations waarvoor een voorstel bestaat."""
        nu = timezone.now()
        gebruiker = request.user if request.user.is_authenticated else None
        stations = list(TolStation.objects.filter(bevestigd_op__isnull=True)
                        .exclude(voorstel=''))
        for station in stations:
            station.land = station.voorstel
            station.bevestigd_op = nu
            station.bevestigd_door = gebruiker
        TolStation.objects.bulk_update(stations, ['land', 'bevestigd_op', 'bevestigd_door'])
        return Response({
            'bevestigd': len(stations),
            'openstaand': TolStation.objects.filter(bevestigd_op__isnull=True).count(),
        })

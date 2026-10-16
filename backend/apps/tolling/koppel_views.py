"""Tolregels opnieuw tegen de planning leggen over een zelfgekozen periode.

De periode komt altijd van de gebruiker mee. Er staat hier bewust geen vaste
startdatum in code: op een verse installatie moet de eerste maand net zo goed
werken als over een jaar.
"""
from __future__ import annotations

import datetime

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from .planning_koppeling import controleer_periode


def _datum(waarde, veld):
    if not waarde:
        return None
    try:
        return datetime.date.fromisoformat(str(waarde)[:10])
    except ValueError:
        raise ValueError(f'{veld} is geen geldige datum (jjjj-mm-dd).')


def _rij(rij):
    uit = dict(rij)
    uit['datum'] = rij['datum'].isoformat() if rij.get('datum') else None
    uit['bedrag'] = float(rij.get('bedrag') or 0)
    return uit


class TolKoppelingViewSet(viewsets.ViewSet):
    """Controleer en herstel de koppeling tussen tolregels en de planning."""

    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def list(self, request):
        """Geef de standaardperiode: vanaf de eerste van de huidige maand."""
        vandaag = timezone.localdate()
        return Response({
            'standaard_vanaf': vandaag.replace(day=1).isoformat(),
            'vandaag': vandaag.isoformat(),
        })

    @action(detail=False, methods=['post'])
    def controleer(self, request):
        try:
            vanaf = _datum(request.data.get('vanaf'), 'vanaf')
            tot = _datum(request.data.get('tot'), 'tot')
        except ValueError as exc:
            return Response({'detail': str(exc)},
                            status=status.HTTP_400_BAD_REQUEST)

        if vanaf is None:
            return Response({'detail': 'Kies een startdatum.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if tot is not None and tot < vanaf:
            return Response({'detail': 'De einddatum ligt voor de startdatum.'},
                            status=status.HTTP_400_BAD_REQUEST)

        toepassen = bool(request.data.get('toepassen'))
        with transaction.atomic():
            uitkomst = controleer_periode(vanaf, tot, toepassen=toepassen)

        uitkomst['vanaf'] = vanaf.isoformat()
        uitkomst['tot'] = tot.isoformat() if tot else None
        uitkomst['toepassen'] = toepassen
        uitkomst['wijzigingen'] = [_rij(r) for r in uitkomst['wijzigingen']]
        uitkomst['verweesd'] = [_rij(r) for r in uitkomst['verweesd']]
        return Response(uitkomst)

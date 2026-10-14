"""API voor het maken en terugzetten van tol-backups.

Bewust los van `views.py`.
"""
from __future__ import annotations

import logging

from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle

from apps.core.permissions import HasReadWriteModulePermission

from . import backup_service
from .models import TolBackup, TolBackupWeek

logger = logging.getLogger(__name__)


def _week_dict(week: TolBackupWeek) -> dict:
    return {
        'id': str(week.id),
        'jaar': week.jaar,
        'weeknummer': week.weeknummer,
        'van_datum': week.van_datum.isoformat(),
        'tot_datum': week.tot_datum.isoformat(),
        'aantal_regels': week.aantal_regels,
        'totaal_bedrag': str(week.totaal_bedrag),
        'teruggezet_op': week.teruggezet_op.isoformat() if week.teruggezet_op else None,
    }


def _backup_dict(backup: TolBackup) -> dict:
    return {
        'id': str(backup.id),
        'omschrijving': backup.omschrijving,
        'van_datum': backup.van_datum.isoformat(),
        'tot_datum': backup.tot_datum.isoformat(),
        'aantal_regels': backup.aantal_regels,
        'totaal_bedrag': str(backup.totaal_bedrag),
        'gemaakt_op': backup.gemaakt_op.isoformat(),
        'gemaakt_door': (backup.gemaakt_door.full_name or backup.gemaakt_door.email)
        if backup.gemaakt_door_id else '',
        'weken': [_week_dict(w) for w in backup.weken.all()],
    }


class TolBackupViewSet(viewsets.ViewSet):
    """Momentopname maken voor een import en per week terugzetten."""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'
    throttle_scope = 'tolling_backup'

    def get_throttles(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return []
        return [ScopedRateThrottle()]

    def list(self, request):
        backups = TolBackup.objects.prefetch_related('weken').all()
        return Response({
            'weken_per_backup': backup_service.WEKEN_IN_BACKUP,
            'maximaal_bewaard': backup_service.MAX_BACKUPS,
            'backups': [_backup_dict(b) for b in backups],
        })

    def create(self, request):
        backup = backup_service.maak_backup(
            user=request.user,
            omschrijving=str(request.data.get('omschrijving') or ''),
        )
        backup = TolBackup.objects.prefetch_related('weken').get(pk=backup.pk)
        logger.info('Tolbackup %s gemaakt door %s (%s regels)',
                    backup.id, request.user, backup.aantal_regels)
        return Response(_backup_dict(backup), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='week/(?P<week_id>[^/.]+)/verschil')
    def verschil(self, request, pk=None, week_id=None):
        """Toont wat er zou veranderen; verandert niets."""
        week = get_object_or_404(TolBackupWeek, pk=week_id, backup_id=pk)
        return Response(backup_service.verschil_week(week))

    @action(detail=True, methods=['post'], url_path='week/(?P<week_id>[^/.]+)/terugzetten')
    def terugzetten(self, request, pk=None, week_id=None):
        week = get_object_or_404(TolBackupWeek, pk=week_id, backup_id=pk)
        resultaat = backup_service.zet_week_terug(week, user=request.user)
        logger.warning('Tolweek %s-%s teruggezet uit backup %s door %s: %s',
                       week.weeknummer, week.jaar, pk, request.user, resultaat)
        return Response(resultaat)

    def destroy(self, request, pk=None):
        backup = get_object_or_404(TolBackup, pk=pk)
        backup.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

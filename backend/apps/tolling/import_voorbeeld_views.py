"""Voorbeeld van een tolimport: tonen wat er binnenkomt, zonder op te slaan."""
from __future__ import annotations

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from .services import voorbeeld_import

MAX_BESTAND = 20 * 1024 * 1024


class TolImportVoorbeeldViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'
    parser_classes = [MultiPartParser, FormParser]

    @action(detail=False, methods=['post'], url_path='bekijk')
    def bekijk(self, request):
        bestand = request.FILES.get('file')
        if not bestand:
            return Response({'detail': 'Geen bestand meegestuurd.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if bestand.size > MAX_BESTAND:
            return Response({'detail': 'Bestand is groter dan 20 MB.'},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(voorbeeld_import(bestand, filename=bestand.name))

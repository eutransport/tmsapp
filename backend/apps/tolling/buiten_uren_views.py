"""API voor het administratieve overzicht 'tolheffing buiten de gewerkte uren'.

Los van `views.py` en van de facturatie: dit endpoint leest alleen.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from uuid import UUID

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from . import buiten_uren

logger = logging.getLogger(__name__)

# Een ruimere periode dan dit levert een trage query en een onleesbaar scherm.
MAX_DAGEN = 400


class OngeldigeInvoer(ValueError):
    """De meegegeven parameter is niet te lezen."""


def _datum(waarde, standaard: date) -> date:
    tekst = str(waarde or '').strip()[:10]
    if not tekst:
        return standaard
    for opmaak in ('%Y-%m-%d', '%d-%m-%Y'):
        try:
            return datetime.strptime(tekst, opmaak).date()
        except ValueError:
            continue
    raise OngeldigeInvoer(f'"{tekst}" is geen geldige datum (jjjj-mm-dd of dd-mm-jjjj).')


def _uuid(waarde):
    tekst = str(waarde or '').strip()
    if not tekst:
        return None
    try:
        return str(UUID(tekst))
    except (ValueError, AttributeError, TypeError):
        raise OngeldigeInvoer(f'"{tekst}" is geen geldig bedrijf.') from None


def _bool(waarde, standaard: bool = False) -> bool:
    if waarde is None or waarde == '':
        return standaard
    return str(waarde).strip().lower() in ('1', 'true', 'yes', 'ja', 'on')


def _geheel(waarde, standaard: int) -> int:
    try:
        return int(waarde)
    except (TypeError, ValueError):
        return standaard


class TollingBuitenUrenViewSet(viewsets.ViewSet):
    """Welke tolheffing valt buiten de geregistreerde rittijden?"""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    @action(detail=False, methods=['get'], url_path='overzicht')
    def overzicht(self, request):
        """Gegroepeerd per bedrijf en per wagen.

        Parameters (alle optioneel):
          date_from, date_to  YYYY-MM-DD, standaard de afgelopen maand
          bedrijf_id          alleen dit bedrijf
          plate               alleen dit kenteken
          marge_minuten       marge rond de rittijd, standaard 15
          alleen_open         'true' = nog niet gefactureerde regels
          toon_marge          'true' = randregels ook in de lijst
          alleen_definitief   'true' = uren in concept niet meetellen
        """
        vandaag = date.today()
        try:
            datum_tot = _datum(request.query_params.get('date_to'), vandaag)
            datum_van = _datum(
                request.query_params.get('date_from'), datum_tot - timedelta(days=30),
            )
            bedrijf_id = _uuid(request.query_params.get('bedrijf_id'))
        except OngeldigeInvoer as fout:
            return Response({'detail': str(fout)}, status=400)
        if datum_van > datum_tot:
            datum_van, datum_tot = datum_tot, datum_van
        if (datum_tot - datum_van).days > MAX_DAGEN:
            return Response(
                {'detail': f'Kies een periode van maximaal {MAX_DAGEN} dagen.'},
                status=400,
            )

        marge = _geheel(request.query_params.get('marge_minuten'), 15)
        marge = max(0, min(marge, 240))

        data = buiten_uren.overzicht(
            datum_van,
            datum_tot,
            bedrijf_id=bedrijf_id,
            kenteken=request.query_params.get('plate') or '',
            marge_minuten=marge,
            alleen_open=_bool(request.query_params.get('alleen_open')),
            alleen_buiten=not _bool(request.query_params.get('toon_marge')),
            alleen_definitief=_bool(request.query_params.get('alleen_definitief')),
        )
        return Response(data)

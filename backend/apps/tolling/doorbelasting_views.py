"""API voor het overzicht 'tol betaald versus tol doorbelast'.

Leest alleen; los van `views.py` zodat de facturatie hier niet aan raakt.
"""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from . import doorbelasting

# Een ruimere periode wordt traag en levert een onleesbare maandkolom op.
MAX_DAGEN = 800


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


class TolDoorbelastingViewSet(viewsets.ViewSet):
    """Komt de betaalde tolheffing overeen met wat we doorbelastten?"""
    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    @action(detail=False, methods=['get'], url_path='overzicht')
    def overzicht(self, request):
        """Per wagen betaald, doorbelast en het verschil.

        Parameters (alle optioneel):
          date_from, date_to  YYYY-MM-DD, standaard het lopende jaar
          bedrijf_id          alleen deze opdrachtgever
        """
        vandaag = date.today()
        try:
            datum_tot = _datum(request.query_params.get('date_to'), vandaag)
            datum_van = _datum(
                request.query_params.get('date_from'), date(datum_tot.year, 1, 1),
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

        return Response(doorbelasting.overzicht(datum_van, datum_tot, bedrijf_id))

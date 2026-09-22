"""API voor de tolafrekeningen van de opdrachtgever."""
from __future__ import annotations

import logging
from datetime import datetime

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import HasReadWriteModulePermission

from . import afrekening_analyse as analyse
from . import afrekening_service as service
from .afrekening_parser import MAX_BESTAND_BYTES, AfrekeningFout
from .models import TolAfrekening

logger = logging.getLogger(__name__)


def _tijd(waarde, standaard):
    """Lees een 'HH:MM' uit het verzoek; bij twijfel de standaardwaarde."""
    if not waarde:
        return standaard
    try:
        return datetime.strptime(str(waarde).strip(), '%H:%M').time()
    except ValueError:
        raise AfrekeningFout(f'Ongeldige tijd: {waarde}. Gebruik het formaat 06:00.')


def _regel_ids(verzoek) -> list[str]:
    ruw = verzoek.data.get('regels') or []
    if isinstance(ruw, str):
        ruw = [deel for deel in ruw.split(',') if deel.strip()]
    if not isinstance(ruw, list):
        raise AfrekeningFout('Ongeldige selectie van regels.')
    return [str(item).strip() for item in ruw if str(item).strip()]


class TolAfrekeningViewSet(viewsets.ViewSet):
    """Uploaden en vergelijken van de afrekening van de opdrachtgever."""

    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def _haal_op(self, pk) -> TolAfrekening | None:
        return (
            TolAfrekening.objects
            .select_related('bedrijf', 'geuploaded_door')
            .filter(pk=pk)
            .first()
        )

    def list(self, request):
        rijen = (
            TolAfrekening.objects
            .select_related('bedrijf', 'geuploaded_door')
            .prefetch_related('regels')
        )
        resultaat = []
        for afrekening in rijen:
            regels = list(afrekening.regels.all())
            resultaat.append({
                'id': str(afrekening.id),
                'bestandsnaam': afrekening.bestandsnaam,
                'bonnummer': afrekening.bonnummer,
                'klantnummer': afrekening.klantnummer,
                'factuurdatum': afrekening.factuurdatum,
                'periode_van': afrekening.periode_van,
                'periode_tot': afrekening.periode_tot,
                'bedrijf_naam': afrekening.bedrijf.naam if afrekening.bedrijf_id else '',
                'totaal_netto': float(afrekening.totaal_netto or 0),
                'totaal_maut': float(afrekening.totaal_maut or 0),
                'voertuigen': len(regels),
                'ongekoppeld': sum(1 for r in regels if r.koppeling != 'gekoppeld'),
                'waarschuwingen': len(afrekening.waarschuwingen or []),
                'werktijd_van': afrekening.werktijd_van.strftime('%H:%M'),
                'werktijd_tot': afrekening.werktijd_tot.strftime('%H:%M'),
                'geuploaded_door': (
                    (afrekening.geuploaded_door.full_name or '').strip()
                    or afrekening.geuploaded_door.email
                ) if afrekening.geuploaded_door_id else '',
                'created_at': afrekening.created_at,
            })
        return Response(resultaat)

    def retrieve(self, request, pk=None):
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        return Response(analyse.analyseer(afrekening))

    def create(self, request):
        bestand = request.FILES.get('bestand')
        if bestand is None:
            return Response({'detail': 'Kies een PDF-bestand om te uploaden.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if bestand.size > MAX_BESTAND_BYTES:
            return Response(
                {'detail': f'Het bestand is te groot (maximaal '
                           f'{MAX_BESTAND_BYTES // (1024 * 1024)} MB).'},
                status=status.HTTP_400_BAD_REQUEST)

        try:
            werktijd_van = _tijd(request.data.get('werktijd_van'), None)
            werktijd_tot = _tijd(request.data.get('werktijd_tot'), None)
            afrekening = service.importeer(
                inhoud=bestand.read(),
                bestandsnaam=bestand.name,
                gebruiker=request.user,
                werktijd_van=werktijd_van,
                werktijd_tot=werktijd_tot,
            )
        except service.AfrekeningBestaatAl as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_409_CONFLICT)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('Inlezen van tolafrekening mislukt')
            return Response(
                {'detail': 'Het bestand kon niet worden gelezen. '
                           'Controleer of het de juiste afrekening is.'},
                status=status.HTTP_400_BAD_REQUEST)

        return Response(analyse.analyseer(afrekening), status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        bon = afrekening.bonnummer
        bestand = afrekening.bestand
        afrekening.delete()
        if bestand:
            bestand.delete(save=False)
        logger.info('Tolafrekening %s verwijderd door %s', bon, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='werktijden')
    def werktijden(self, request, pk=None):
        """Pas het werkdagvenster aan en herbereken de analyse."""
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        try:
            van = _tijd(request.data.get('werktijd_van'), afrekening.werktijd_van)
            tot = _tijd(request.data.get('werktijd_tot'), afrekening.werktijd_tot)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        if van == tot:
            return Response({'detail': 'Begin- en eindtijd mogen niet gelijk zijn.'},
                            status=status.HTTP_400_BAD_REQUEST)
        afrekening.werktijd_van = van
        afrekening.werktijd_tot = tot
        afrekening.save(update_fields=['werktijd_van', 'werktijd_tot', 'updated_at'])
        return Response(analyse.analyseer(afrekening))

    @action(detail=True, methods=['post'], url_path='markeer-gefactureerd')
    def markeer_gefactureerd(self, request, pk=None):
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        try:
            ids = _regel_ids(request)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        uitkomst = service.markeer_gefactureerd(afrekening, ids)
        uitkomst['analyse'] = analyse.analyseer(afrekening)
        return Response(uitkomst)

    @action(detail=True, methods=['post'], url_path='markering-ongedaan')
    def markering_ongedaan(self, request, pk=None):
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        try:
            ids = _regel_ids(request)
        except AfrekeningFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        uitkomst = service.maak_markering_ongedaan(afrekening, ids)
        uitkomst['analyse'] = analyse.analyseer(afrekening)
        return Response(uitkomst)

    @action(detail=True, methods=['get'], url_path='passages')
    def passages(self, request, pk=None):
        """De onderliggende tolpassages van een voertuigregel."""
        afrekening = self._haal_op(pk)
        if afrekening is None:
            return Response({'detail': 'Afrekening niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        regel = afrekening.regels.filter(pk=request.query_params.get('regel')).first()
        if regel is None:
            return Response({'detail': 'Regel niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)

        rijen = analyse.events_van_regel(
            regel, afrekening.periode_van, afrekening.periode_tot,
        ).order_by('start_at')
        velden = ('id', 'start_at', 'amount', 'distance_km', 'license_plate_raw',
                  'is_private', 'invoiced_at')
        return Response({
            'regel': {
                'id': str(regel.id),
                'voertuig_label': regel.voertuig_label,
                'ritnummer': regel.ritnummer,
                'kenteken': regel.kenteken,
            },
            'passages': [
                {
                    'id': str(rij[0]),
                    'start_at': rij[1],
                    'bedrag': float(rij[2] or 0),
                    'km': float(rij[3] or 0),
                    'kenteken': rij[4],
                    'prive': rij[5],
                    'gefactureerd': rij[6] is not None,
                    'tijdvak': analyse.tijdvak(
                        rij[1], afrekening.werktijd_van, afrekening.werktijd_tot),
                }
                for rij in rijen.values_list(*velden)
            ],
        })

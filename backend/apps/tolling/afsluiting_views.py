"""Endpoints voor het afsluiten van een tolperiode.

Afsluiten raakt de hele tolheffing in één keer, dus er zit een extra drempel
voor: naast het aanvinken van de bevestiging moet de beheerder zich opnieuw
bewijzen. Met 2FA is dat de code uit de authenticator, zonder 2FA het eigen
wachtwoord. Die controle is bewust los van het inloggen: wie zijn scherm open
laat staan kan hier niet zomaar een jaar administratie mee wegzetten.
"""
from __future__ import annotations

import logging
from datetime import date

import pyotp
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.views import (check_rate_limit, get_client_ip,
                                 increment_rate_limit)
from apps.core.permissions import HasReadWriteModulePermission

from . import afsluiting_service
from .models import TolAfsluiting

logger = logging.getLogger(__name__)

MAX_POGINGEN = 5
BLOKKADE_SECONDEN = 300


class BevestigingFout(Exception):
    """De bevestiging klopt niet; de actie gaat niet door."""


def _datum(waarde) -> date:
    try:
        gelezen = date.fromisoformat(str(waarde).strip()[:10])
    except (TypeError, ValueError):
        raise afsluiting_service.AfsluitingFout('Ongeldige datum.')
    return gelezen


def _bevestig(request) -> None:
    """Checkbox plus 2FA-code of wachtwoord, met een rem op raden."""
    if not request.data.get('bevestigd'):
        raise BevestigingFout('Zet eerst het vinkje dat je het zeker weet.')

    gebruiker = request.user
    sleutel = f'tol_afsluiting:{get_client_ip(request)}:{gebruiker.pk}'
    geblokkeerd, resterend = check_rate_limit(
        request, sleutel, max_attempts=MAX_POGINGEN,
        lockout_seconds=BLOKKADE_SECONDEN)
    if geblokkeerd:
        raise BevestigingFout(
            f'Te veel mislukte pogingen. Probeer het over '
            f'{max(1, resterend // 60)} minuten opnieuw.')

    if gebruiker.mfa_enabled and gebruiker.mfa_secret:
        code = str(request.data.get('code') or '').strip()
        # Eén tijdvak speling, anders mislukt een code die net omslaat.
        if not code or not pyotp.TOTP(gebruiker.mfa_secret).verify(code, valid_window=1):
            increment_rate_limit(request, sleutel, BLOKKADE_SECONDEN)
            raise BevestigingFout('De code uit de authenticator klopt niet.')
        return

    wachtwoord = str(request.data.get('wachtwoord') or '')
    if not wachtwoord or not gebruiker.check_password(wachtwoord):
        increment_rate_limit(request, sleutel, BLOKKADE_SECONDEN)
        raise BevestigingFout('Het wachtwoord klopt niet.')


class TolAfsluitingViewSet(viewsets.ViewSet):
    """Periodes afsluiten, terugkijken en zo nodig terugdraaien."""

    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def list(self, request):
        return Response({
            'afsluitingen': afsluiting_service.overzicht(),
            'tweefactor': bool(request.user.mfa_enabled and request.user.mfa_secret),
        })

    @action(detail=False, methods=['get'], url_path='voorbeeld')
    def voorbeeld(self, request):
        """Wat zou er met deze datum worden afgesloten? Verandert niets."""
        try:
            tot = _datum(request.query_params.get('tot_datum'))
        except afsluiting_service.AfsluitingFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(afsluiting_service.voorbeeld(tot))

    @action(detail=False, methods=['post'], url_path='afsluiten')
    def afsluiten(self, request):
        try:
            _bevestig(request)
            tot = _datum(request.data.get('tot_datum'))
            afsluiting = afsluiting_service.afsluiten(
                tot,
                gebruiker=request.user,
                omschrijving=str(request.data.get('omschrijving') or ''),
                openstaand_meenemen=bool(request.data.get('openstaand_meenemen')),
            )
        except BevestigingFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_403_FORBIDDEN)
        except afsluiting_service.AfsluitingFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)

        logger.warning('Tolperiode afgesloten t/m %s door %s',
                       afsluiting.tot_datum, getattr(request.user, 'email', request.user))
        return Response({
            'id': str(afsluiting.pk),
            'tot_datum': afsluiting.tot_datum.isoformat(),
            'samenvatting': afsluiting.samenvatting,
            'afsluitingen': afsluiting_service.overzicht(),
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='terugdraaien')
    def terugdraaien(self, request, pk=None):
        if not getattr(request.user, 'is_admin', False) and not request.user.is_superuser:
            return Response({'detail': 'Alleen een beheerder kan dit terugdraaien.'},
                            status=status.HTTP_403_FORBIDDEN)
        afsluiting = TolAfsluiting.objects.filter(pk=pk).first()
        if afsluiting is None:
            return Response({'detail': 'Afsluiting niet gevonden.'},
                            status=status.HTTP_404_NOT_FOUND)
        try:
            _bevestig(request)
            uitkomst = afsluiting_service.terugdraaien(afsluiting, gebruiker=request.user)
        except BevestigingFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_403_FORBIDDEN)
        except afsluiting_service.AfsluitingFout as fout:
            return Response({'detail': str(fout)}, status=status.HTTP_400_BAD_REQUEST)

        logger.warning('Tolafsluiting %s teruggedraaid door %s',
                       pk, getattr(request.user, 'email', request.user))
        return Response({
            **uitkomst,
            'teruggedraaid_op': timezone.now().isoformat(),
            'afsluitingen': afsluiting_service.overzicht(),
        })

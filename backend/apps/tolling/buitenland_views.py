"""Overzicht en uitdraai van tolheffing per land.

Bedoeld voor de vraag "wat heeft deze wagen buiten Nederland gereden en wie
moet daarvoor gefactureerd worden". De periode komt altijd van de gebruiker:
of als twee datums, of als week- dan wel maandnummer met een verschuiving.
Er staat hier bewust geen vaste begindatum in code.
"""
from __future__ import annotations

import datetime

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.http import HttpResponse

from apps.core.permissions import HasReadWriteModulePermission

from .buitenland import (BUITENLAND, filter_op_land, naar_xlsx, overzicht,
                         totalen_per_land)
from .land_bepaling import LANDNAMEN
from .models import TollingEvent
from .views import (_month_range, _period_label, _shift_month, _shift_week,
                    _week_range)

MAX_PERIODE_DAGEN = 400


def _datum(waarde, veld):
    try:
        return datetime.date.fromisoformat(str(waarde)[:10])
    except (TypeError, ValueError):
        raise ValueError(f'{veld} is geen geldige datum (jjjj-mm-dd).')


def _periode(params) -> tuple[datetime.datetime, datetime.datetime, str]:
    """Bepaal het tijdvenster uit de parameters en geef er een label bij."""
    tz = timezone.get_current_timezone()
    van_tekst = params.get('date_from')
    tot_tekst = params.get('date_to')
    if van_tekst or tot_tekst:
        if not (van_tekst and tot_tekst):
            raise ValueError('Geef zowel date_from als date_to op.')
        van = _datum(van_tekst, 'date_from')
        tot = _datum(tot_tekst, 'date_to')
        if tot < van:
            raise ValueError('De einddatum ligt voor de startdatum.')
        if (tot - van).days > MAX_PERIODE_DAGEN:
            raise ValueError(f'De periode mag hoogstens {MAX_PERIODE_DAGEN} dagen beslaan.')
        start = timezone.make_aware(datetime.datetime.combine(van, datetime.time.min), tz)
        einde = timezone.make_aware(
            datetime.datetime.combine(tot + datetime.timedelta(days=1), datetime.time.min), tz)
        label = f"{van.strftime('%d-%m-%Y')} t/m {tot.strftime('%d-%m-%Y')}"
        return start, einde, label

    periode = (params.get('period') or 'week').lower()
    try:
        verschuiving = int(params.get('offset') or 0)
    except (TypeError, ValueError):
        raise ValueError('offset moet een heel getal zijn.')
    if abs(verschuiving) > 520:
        raise ValueError('De verschuiving is te groot.')

    nu = timezone.now().astimezone(tz)
    if periode == 'month':
        jaar, index = _shift_month(nu.year, nu.month, verschuiving)
        start, einde = _month_range(jaar, index)
    elif periode == 'week':
        iso = nu.isocalendar()
        jaar, index = _shift_week(iso[0], iso[1], verschuiving)
        start, einde = _week_range(jaar, index)
    else:
        raise ValueError('period moet "week" of "month" zijn, of geef date_from en date_to.')
    return start, einde, _period_label(periode, jaar, index)


class TolBuitenlandViewSet(viewsets.ViewSet):
    """Tolheffing buiten Nederland, opgesomd per kenteken."""

    permission_classes = [IsAuthenticated, HasReadWriteModulePermission]
    module_permission_read = 'view_tolling'
    module_permission_write = 'manage_tolling'

    def _selectie(self, params):
        """De tolregels van de gevraagde periode, land en bedrijf."""
        start, einde, label = _periode(params)
        queryset = TollingEvent.objects.filter(start_at__gte=start, start_at__lt=einde)

        bedrijf_id = (params.get('bedrijf_id') or '').strip()
        if bedrijf_id:
            try:
                queryset = queryset.filter(bedrijf_id=bedrijf_id)
            except (ValueError, TypeError):
                raise ValueError('bedrijf_id is geen geldige verwijzing.')

        keuze = params.get('land')
        if keuze is None:
            keuze = BUITENLAND
        queryset = filter_op_land(queryset, keuze)
        return queryset, label, (keuze or '').strip()

    def list(self, request):
        try:
            queryset, label, keuze = self._selectie(request.query_params)
            rijen = overzicht(queryset)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:  # ongeldige uuid komt pas bij het uitvoeren boven
            return Response({'detail': 'Ongeldige selectie.'},
                            status=status.HTTP_400_BAD_REQUEST)

        def _rij(rij):
            uit = dict(rij)
            uit['km'] = float(rij['km'])
            uit['bedrag'] = float(rij['bedrag'])
            uit['open_bedrag'] = float(rij['open_bedrag'])
            uit['eerste_dag'] = rij['eerste_dag'].isoformat() if rij['eerste_dag'] else None
            uit['laatste_dag'] = rij['laatste_dag'].isoformat() if rij['laatste_dag'] else None
            return uit

        landen = []
        for samen in totalen_per_land(rijen):
            landen.append({
                **samen,
                'km': float(samen['km']),
                'bedrag': float(samen['bedrag']),
                'open_bedrag': float(samen['open_bedrag']),
            })

        return Response({
            'periode': label,
            'land': keuze,
            'landkeuzes': [{'code': code, 'naam': naam}
                           for code, naam in sorted(LANDNAMEN.items(), key=lambda x: x[1])],
            'rijen': [_rij(r) for r in rijen],
            'per_land': landen,
        })

    @action(detail=False, methods=['get'], url_path='export')
    def export(self, request):
        try:
            queryset, label, keuze = self._selectie(request.query_params)
            rijen = overzicht(queryset)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({'detail': 'Ongeldige selectie.'},
                            status=status.HTTP_400_BAD_REQUEST)

        titel = f'Tolheffing {keuze or "alle landen"} — {label}'
        data = naar_xlsx(rijen, titel)
        bestand = f'tolheffing_{keuze or "alles"}_{label}'.lower()
        bestand = ''.join(c if c.isalnum() or c in '-_' else '_' for c in bestand)
        antwoord = HttpResponse(
            data,
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        antwoord['Content-Disposition'] = f'attachment; filename="{bestand}.xlsx"'
        return antwoord

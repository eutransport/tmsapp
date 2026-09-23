"""
API-views voor de Radius Velocity (VelocityFleet) telematics koppeling.

Alle endpoints zijn alleen bereikbaar voor beheerders/managers.
"""
import logging
import re
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdminOrManagerStrict

from .radius_archive_service import (
    STANDAARD_TERUGBLIK_DAGEN,
    get_archief_kentekens,
    get_radius_archive,
    sync_recente_dagen,
)
from .radius_service import (
    JOURNEYS_MAX_DAGEN,
    RadiusError,
    get_journey_summary_per_vehicle,
    get_journeys,
    get_telematics_customers,
    get_vehicles,
    test_connection,
    valideer_datum,
)
from .security import RadiusExportThrottle, RadiusSyncThrottle, TrackingReadThrottle

logger = logging.getLogger('tracking')

# Standaardperiode wanneer er geen datums zijn meegegeven.
STANDAARD_PERIODE_DAGEN = 7

# Het archief staat in onze eigen database, maar we begrenzen de periode om
# te voorkomen dat een enkel verzoek jarenlange data ophaalt.
ARCHIEF_MAX_DAGEN = 366

# Kentekens bevatten alleen letters, cijfers en streepjes.
_KENTEKEN_RE = re.compile(r'^[A-Za-z0-9\- ]{1,20}$')


def _fout_response(exc, melding):
    """Zet een RadiusError om in een nette response zonder upstream-details."""
    return Response({'detail': str(exc) or melding}, status=status.HTTP_400_BAD_REQUEST)


def _bepaal_klant(klant_id):
    """Gebruik de meegegeven klant, of val terug op de eerste Telematics-klant."""
    if klant_id:
        return klant_id
    klanten = get_telematics_customers()
    if not klanten:
        raise RadiusError('Er is geen Radius klant met een Telematics-abonnement gevonden.')
    return klanten[0]['id']


def _bepaal_periode(request):
    """Lees from/to uit de querystring; de service valideert het formaat."""
    tot = request.query_params.get('to')
    van = request.query_params.get('from')
    if not tot:
        tot = timezone.localdate().isoformat()
    if not van:
        einddatum = timezone.localdate()
        van = (einddatum - timedelta(days=STANDAARD_PERIODE_DAGEN - 1)).isoformat()
    return van, tot


class RadiusConnectionTestView(APIView):
    """
    POST /api/tracking/radius/test/

    Controleert of het opgeslagen Radius API token geldig is.
    Het token zelf wordt nooit teruggegeven of gelogd.
    """
    permission_classes = [IsAdminOrManagerStrict]
    throttle_classes = [TrackingReadThrottle]

    def post(self, request):
        try:
            resultaat = test_connection()
        except RadiusError as exc:
            return Response(
                {'ok': False, 'detail': str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            logger.exception('Onverwachte fout bij de Radius verbindingstest')
            return Response(
                {'ok': False, 'detail': 'Onverwachte fout bij het testen van de Radius koppeling.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(resultaat)


class RadiusCustomersView(APIView):
    """
    GET /api/tracking/radius/customers/

    Geeft de Radius-klanten met een Telematics-abonnement.
    """
    permission_classes = [IsAdminOrManagerStrict]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        try:
            klanten = get_telematics_customers()
        except RadiusError as exc:
            return _fout_response(exc, 'Kan de Radius klanten niet ophalen.')
        except Exception:
            logger.exception('Onverwachte fout bij het ophalen van Radius klanten')
            return Response(
                {'detail': 'Kan de Radius klanten niet ophalen.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({'customers': klanten, 'count': len(klanten)})


class RadiusVehiclesView(APIView):
    """
    GET /api/tracking/radius/vehicles/?customer=<id>

    Geeft alle telematics-voertuigen met hun laatst bekende positie.
    Zonder ``customer`` wordt de eerste Telematics-klant gebruikt.
    """
    permission_classes = [IsAdminOrManagerStrict]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        klant_id = request.query_params.get('customer')
        try:
            if not klant_id:
                klanten = get_telematics_customers()
                if not klanten:
                    return Response(
                        {'detail': 'Er is geen Radius klant met een Telematics-abonnement gevonden.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                klant_id = klanten[0]['id']
            resultaat = get_vehicles(klant_id)
        except RadiusError as exc:
            return _fout_response(exc, 'Kan de Radius voertuigen niet ophalen.')
        except Exception:
            logger.exception('Onverwachte fout bij het ophalen van Radius voertuigen')
            return Response(
                {'detail': 'Kan de Radius voertuigen niet ophalen.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        resultaat['customer'] = klant_id
        return Response(resultaat)


class RadiusJourneysView(APIView):
    """
    GET /api/tracking/radius/journeys/?customer=<id>&from=JJJJ-MM-DD&to=JJJJ-MM-DD

    Geeft de losse ritten uit de Radius ritgeschiedenis. Radius bewaart
    ongeveer 30 dagen; oudere gegevens komen uit ons eigen archief.
    """
    permission_classes = [IsAdminOrManagerStrict]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        van, tot = _bepaal_periode(request)
        try:
            klant_id = _bepaal_klant(request.query_params.get('customer'))
            resultaat = get_journeys(klant_id, van, tot)
        except RadiusError as exc:
            return _fout_response(exc, 'Kan de Radius ritgeschiedenis niet ophalen.')
        except Exception:
            logger.exception('Onverwachte fout bij het ophalen van Radius ritten')
            return Response(
                {'detail': 'Kan de Radius ritgeschiedenis niet ophalen.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        resultaat['customer'] = klant_id
        return Response(resultaat)


class RadiusArchiveView(APIView):
    """
    GET /api/tracking/radius/archive/?from=JJJJ-MM-DD&to=JJJJ-MM-DD&plate=..

    Geeft het opgebouwde archief uit onze eigen database, samengevat per dag
    en voertuig. Anders dan de Radius API zelf gaat dit verder terug dan
    30 dagen. Met ``format=csv|xlsx|pdf`` wordt het als bestand gedownload.
    """
    permission_classes = [IsAdminOrManagerStrict]

    def get_throttles(self):
        """Exports zijn duurder dan een gewone uitlezing, dus strenger begrensd."""
        if self.request.query_params.get('format'):
            return [RadiusExportThrottle()]
        return [TrackingReadThrottle()]

    def perform_content_negotiation(self, request, force=False):
        """Voorkom dat DRF ?format=csv|xlsx|pdf als renderer-suffix opvat."""
        from rest_framework.renderers import JSONRenderer
        return JSONRenderer(), 'application/json'

    @staticmethod
    def _tijd(waarde):
        if not waarde:
            return ''
        return timezone.localtime(waarde).strftime('%d-%m-%Y %H:%M')

    @staticmethod
    def _uren(seconden):
        seconden = int(seconden or 0)
        return f'{seconden // 3600}:{(seconden % 3600) // 60:02d}'

    def _regels(self, request):
        van, tot = _bepaal_periode(request)
        kenteken = (request.query_params.get('plate') or '').strip()
        if kenteken and not _KENTEKEN_RE.match(kenteken):
            raise RadiusError('Ongeldig kenteken.')
        van = valideer_datum(van, 'begindatum')
        tot = valideer_datum(tot, 'einddatum')
        if van > tot:
            raise RadiusError('De begindatum ligt na de einddatum.')
        if (tot - van).days + 1 > ARCHIEF_MAX_DAGEN:
            raise RadiusError(f'De periode mag maximaal {ARCHIEF_MAX_DAGEN} dagen beslaan.')
        return get_radius_archive(van, tot, plate_number=kenteken or None)

    def _kolommen(self):
        return ['Datum', 'Kenteken', 'Chauffeur', 'Eerste start', 'Laatste einde',
                'Afstand (km)', 'Rijtijd (u:mm)', 'Aantal ritten']

    def _rij(self, regel):
        return [
            regel['date'],
            regel['plate_number'],
            regel['driver_name'],
            self._tijd(regel['first_start']),
            self._tijd(regel['last_end']),
            regel['distance_km'],
            self._uren(regel['duration_seconds']),
            regel['journey_count'],
        ]

    def _export_csv(self, data):
        import csv
        from django.http import HttpResponse

        response = HttpResponse(content_type='text/csv; charset=utf-8')
        bestandsnaam = timezone.now().strftime('radius_archief_%Y%m%d.csv')
        response['Content-Disposition'] = f'attachment; filename="{bestandsnaam}"'
        # BOM zodat Excel de accenten goed leest.
        response.write('\ufeff')

        schrijver = csv.writer(response, delimiter=';')
        schrijver.writerow(self._kolommen())
        for regel in data['entries']:
            schrijver.writerow(self._rij(regel))
        schrijver.writerow([])
        schrijver.writerow(['Totaal', '', '', '', '',
                            data['total_distance_km'],
                            self._uren(data['total_duration_seconds']),
                            data['journey_count']])
        return response

    def _export_xlsx(self, data):
        import io
        from django.http import HttpResponse
        from openpyxl import Workbook
        from openpyxl.styles import Font

        wb = Workbook()
        ws = wb.active
        ws.title = 'Radius Archief'

        ws.append(self._kolommen())
        for cel in ws[1]:
            cel.font = Font(bold=True)

        for regel in data['entries']:
            ws.append(self._rij(regel))

        ws.append([])
        totaal = ['Totaal', '', '', '', '', data['total_distance_km'],
                  self._uren(data['total_duration_seconds']), data['journey_count']]
        ws.append(totaal)
        for cel in ws[ws.max_row]:
            cel.font = Font(bold=True)

        for kolom in ws.columns:
            breedte = max(len(str(cel.value or '')) for cel in kolom)
            ws.column_dimensions[kolom[0].column_letter].width = min(breedte + 2, 40)

        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        response = HttpResponse(
            buffer.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        bestandsnaam = timezone.now().strftime('radius_archief_%Y%m%d.xlsx')
        response['Content-Disposition'] = f'attachment; filename="{bestandsnaam}"'
        return response

    def _export_pdf(self, data):
        import io
        from django.http import HttpResponse
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(buffer, pagesize=landscape(A4))
        styles = getSampleStyleSheet()

        tabel_data = [self._kolommen()]
        for regel in data['entries']:
            tabel_data.append([str(w) for w in self._rij(regel)])
        tabel_data.append(['Totaal', '', '', '', '',
                           str(data['total_distance_km']),
                           self._uren(data['total_duration_seconds']),
                           str(data['journey_count'])])

        tabel = Table(tabel_data, repeatRows=1)
        tabel.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1F4E79')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, -1), 8),
            ('ALIGN', (5, 1), (-1, -1), 'RIGHT'),
            ('GRID', (0, 0), (-1, -1), 0.25, colors.HexColor('#D0D5DD')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, colors.HexColor('#EBF1F8')]),
        ]))

        periode = f"{data['date_from']} t/m {data['date_to']}"
        verhaal = [
            Paragraph('Radius Ritarchief', styles['Heading2']),
            Paragraph(f'Periode: {periode}', styles['Normal']),
            Paragraph(f"Exportdatum: {timezone.localtime().strftime('%d-%m-%Y %H:%M')}", styles['Normal']),
            Spacer(1, 10),
            tabel,
        ]
        doc.build(verhaal)
        pdf = buffer.getvalue()
        buffer.close()

        response = HttpResponse(pdf, content_type='application/pdf')
        bestandsnaam = timezone.now().strftime('radius_archief_%Y%m%d.pdf')
        response['Content-Disposition'] = f'attachment; filename="{bestandsnaam}"'
        return response

    def get(self, request):
        try:
            data = self._regels(request)
        except RadiusError as exc:
            return _fout_response(exc, 'Kan het Radius archief niet ophalen.')

        formaat = request.query_params.get('format')
        if formaat == 'csv':
            return self._export_csv(data)
        if formaat == 'xlsx':
            return self._export_xlsx(data)
        if formaat == 'pdf':
            return self._export_pdf(data)

        data['plates'] = get_archief_kentekens()
        return Response(data)


class RadiusSyncView(APIView):
    """
    POST /api/tracking/radius/sync/

    Haalt de ritgeschiedenis nu op en werkt het archief bij. Met ``days``
    kan een langere periode worden opgehaald (maximaal wat Radius bewaart).
    """
    permission_classes = [IsAdminOrManagerStrict]
    throttle_classes = [RadiusSyncThrottle]

    def post(self, request):
        try:
            dagen = int(request.data.get('days') or STANDAARD_TERUGBLIK_DAGEN)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'Ongeldig aantal dagen.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        dagen = max(1, min(dagen, JOURNEYS_MAX_DAGEN))

        try:
            resultaat = sync_recente_dagen(dagen=dagen, customer_id=request.data.get('customer'))
        except RadiusError as exc:
            return _fout_response(exc, 'De Radius synchronisatie is mislukt.')
        except Exception:
            logger.exception('Onverwachte fout bij de Radius synchronisatie')
            return Response(
                {'detail': 'De Radius synchronisatie is mislukt.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(resultaat)


class RadiusJourneySummaryView(APIView):
    """
    GET /api/tracking/radius/journeys/summary/?customer=<id>&from=..&to=..

    Geeft per voertuig het totaal aantal ritten, kilometers en rijtijd,
    zoals het overzicht in het Radius-portaal.
    """
    permission_classes = [IsAdminOrManagerStrict]
    throttle_classes = [TrackingReadThrottle]

    def get(self, request):
        van, tot = _bepaal_periode(request)
        try:
            klant_id = _bepaal_klant(request.query_params.get('customer'))
            resultaat = get_journey_summary_per_vehicle(klant_id, van, tot)
        except RadiusError as exc:
            return _fout_response(exc, 'Kan het Radius ritoverzicht niet ophalen.')
        except Exception:
            logger.exception('Onverwachte fout bij het ophalen van het Radius ritoverzicht')
            return Response(
                {'detail': 'Kan het Radius ritoverzicht niet ophalen.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        resultaat['customer'] = klant_id
        return Response(resultaat)


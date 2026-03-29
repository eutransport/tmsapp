"""Views for the reports agent."""
import logging
from datetime import datetime

from django.core.files.base import ContentFile
from django.http import FileResponse, HttpResponse
from django.utils import timezone
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .excel_generator import generate_excel
from .models import ReportOutputFormat, ReportRequest, ReportStatus, ReportType
from .pdf_generator import generate_pdf
from .serializers import (
    ReportRequestCreateSerializer,
    ReportRequestSerializer,
    ReportTypeChoiceSerializer,
)
from .services import execute_report

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Report-type metadata for the frontend wizard
# ---------------------------------------------------------------------------

REPORT_TYPE_METADATA = [
    {
        'value': ReportType.LEAVE_OVERVIEW_USER,
        'label': 'Verlof overzicht per gebruiker',
        'description': 'Genereer een overzicht van alle verlofaanvragen van een medewerker voor een bepaald jaar.',
        'parameters': [
            {'name': 'user_id', 'label': 'Medewerker', 'type': 'user', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False, 'default': 'current_year'},
        ],
    },
    {
        'value': ReportType.LEAVE_BALANCE_OVERVIEW,
        'label': 'Verlof saldo overzicht',
        'description': 'Overzicht van verlofuren en overuren voor alle medewerkers.',
        'parameters': [],
    },
    {
        'value': ReportType.LEAVE_REQUESTS_OVERVIEW,
        'label': 'Verlofaanvragen overzicht',
        'description': 'Alle verlofaanvragen met optionele filter op status of jaar.',
        'parameters': [
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
            {
                'name': 'status', 'label': 'Status', 'type': 'select', 'required': False,
                'options': [
                    {'value': 'pending', 'label': 'In afwachting'},
                    {'value': 'approved', 'label': 'Goedgekeurd'},
                    {'value': 'rejected', 'label': 'Afgewezen'},
                    {'value': 'cancelled', 'label': 'Geannuleerd'},
                ],
            },
        ],
    },
    {
        'value': ReportType.TRIPS_BY_USER,
        'label': 'Alle ritten per gebruiker',
        'description': 'Alle urenregistraties / ritten voor een specifieke medewerker.',
        'parameters': [
            {'name': 'user_id', 'label': 'Medewerker', 'type': 'user', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
            {'name': 'date_from', 'label': 'Datum van', 'type': 'date', 'required': False},
            {'name': 'date_to', 'label': 'Datum t/m', 'type': 'date', 'required': False},
        ],
    },
    {
        'value': ReportType.TRIPS_BY_VEHICLE,
        'label': 'Alle ritten van een voertuig',
        'description': 'Alle ritten van een voertuig op basis van ritnummer of kenteken.',
        'parameters': [
            {'name': 'ritnummer', 'label': 'Ritnummer', 'type': 'text', 'required': False},
            {'name': 'kenteken', 'label': 'Kenteken', 'type': 'text', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
            {'name': 'date_from', 'label': 'Datum van', 'type': 'date', 'required': False},
            {'name': 'date_to', 'label': 'Datum t/m', 'type': 'date', 'required': False},
        ],
    },
    {
        'value': ReportType.TIME_ENTRIES_SUMMARY,
        'label': 'Urenregistratie samenvatting',
        'description': 'Samenvatting van totaal ritten en kilometers per medewerker voor een jaar.',
        'parameters': [
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False, 'default': 'current_year'},
        ],
    },
    {
        'value': ReportType.TIME_ENTRIES_BY_USER,
        'label': 'Urenregistraties per gebruiker (detail)',
        'description': 'Gedetailleerd overzicht van alle urenregistraties per gebruiker.',
        'parameters': [
            {'name': 'user_id', 'label': 'Medewerker', 'type': 'user', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
            {'name': 'date_from', 'label': 'Datum van', 'type': 'date', 'required': False},
            {'name': 'date_to', 'label': 'Datum t/m', 'type': 'date', 'required': False},
        ],
    },
    {
        'value': ReportType.TIME_ENTRIES_BY_WEEK,
        'label': 'Urenregistraties per week',
        'description': 'Samenvatting van ritten en kilometers gegroepeerd per week.',
        'parameters': [
            {'name': 'user_id', 'label': 'Medewerker', 'type': 'user', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False, 'default': 'current_year'},
        ],
    },
    {
        'value': ReportType.WEEKLY_HOURS_SUMMARY,
        'label': 'Wekelijkse uren samenvatting',
        'description': 'Overzicht van uren per week per medewerker.',
        'parameters': [
            {'name': 'user_id', 'label': 'Medewerker', 'type': 'user', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False, 'default': 'current_year'},
        ],
    },
    {
        'value': ReportType.VEHICLE_OVERVIEW,
        'label': 'Voertuigen overzicht',
        'description': 'Overzicht van alle voertuigen in de vloot.',
        'parameters': [
            {
                'name': 'actief', 'label': 'Alleen actieve voertuigen', 'type': 'select',
                'required': False,
                'options': [
                    {'value': '', 'label': 'Alle'},
                    {'value': 'true', 'label': 'Alleen actief'},
                    {'value': 'false', 'label': 'Alleen inactief'},
                ],
            },
        ],
    },
    {
        'value': ReportType.VEHICLE_MAINTENANCE,
        'label': 'Onderhoud per voertuig',
        'description': 'Onderhoud overzicht voor een specifiek voertuig of alle voertuigen.',
        'parameters': [
            {'name': 'kenteken', 'label': 'Kenteken', 'type': 'text', 'required': False},
        ],
    },
    {
        'value': ReportType.DRIVER_OVERVIEW,
        'label': 'Chauffeurs overzicht',
        'description': 'Overzicht van alle chauffeurs met voertuig- en contactgegevens.',
        'parameters': [],
    },
    {
        'value': ReportType.DRIVER_ACTIVITY,
        'label': 'Activiteit per chauffeur',
        'description': 'Ritten en kilometers per chauffeur voor een jaar.',
        'parameters': [
            {'name': 'user_id', 'label': 'Medewerker / chauffeur', 'type': 'user', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False, 'default': 'current_year'},
        ],
    },
    {
        'value': ReportType.INVOICE_OVERVIEW,
        'label': 'Facturen overzicht',
        'description': 'Overzicht van alle facturen met optionele filters.',
        'parameters': [
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
            {
                'name': 'status', 'label': 'Status', 'type': 'select', 'required': False,
                'options': [
                    {'value': '', 'label': 'Alle'},
                    {'value': 'concept', 'label': 'Concept'},
                    {'value': 'definitief', 'label': 'Definitief'},
                    {'value': 'verzonden', 'label': 'Verzonden'},
                    {'value': 'betaald', 'label': 'Betaald'},
                ],
            },
        ],
    },
    {
        'value': ReportType.INVOICE_BY_COMPANY,
        'label': 'Facturen per bedrijf',
        'description': 'Facturen gefilterd op bedrijf.',
        'parameters': [
            {'name': 'bedrijf_id', 'label': 'Bedrijf', 'type': 'company', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
        ],
    },
    {
        'value': ReportType.REVENUE_SUMMARY,
        'label': 'Omzet samenvatting',
        'description': 'Omzet samenvatting per bedrijf en status voor een jaar.',
        'parameters': [
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False, 'default': 'current_year'},
        ],
    },
    {
        'value': ReportType.COMPANY_OVERVIEW,
        'label': 'Bedrijven overzicht',
        'description': 'Overzicht van alle geregistreerde bedrijven.',
        'parameters': [],
    },
    {
        'value': ReportType.MAINTENANCE_OVERVIEW,
        'label': 'Onderhoud overzicht',
        'description': 'Overzicht van alle onderhoudstaken.',
        'parameters': [
            {
                'name': 'status', 'label': 'Status', 'type': 'select', 'required': False,
                'options': [
                    {'value': '', 'label': 'Alle'},
                    {'value': 'scheduled', 'label': 'Gepland'},
                    {'value': 'completed', 'label': 'Voltooid'},
                    {'value': 'overdue', 'label': 'Achterstallig'},
                ],
            },
        ],
    },
    {
        'value': ReportType.APK_OVERVIEW,
        'label': 'APK overzicht',
        'description': 'Overzicht van APK keuringen per voertuig.',
        'parameters': [],
    },
    {
        'value': ReportType.PLANNING_OVERVIEW,
        'label': 'Planning overzicht',
        'description': 'Planning overzicht per week en jaar.',
        'parameters': [
            {'name': 'user_id', 'label': 'Chauffeur / Medewerker', 'type': 'user', 'required': False},
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
            {'name': 'week', 'label': 'Weeknummer', 'type': 'text', 'required': False},
        ],
    },
    {
        'value': ReportType.BANKING_TRANSACTIONS,
        'label': 'Bank transacties overzicht',
        'description': 'Overzicht van banktransacties met match status.',
        'parameters': [
            {'name': 'date_from', 'label': 'Datum van', 'type': 'date', 'required': False},
            {'name': 'date_to', 'label': 'Datum t/m', 'type': 'date', 'required': False},
            {
                'name': 'match_status', 'label': 'Match status', 'type': 'select', 'required': False,
                'options': [
                    {'value': '', 'label': 'Alle'},
                    {'value': 'matched', 'label': 'Gekoppeld'},
                    {'value': 'unmatched', 'label': 'Ongekoppeld'},
                    {'value': 'partial', 'label': 'Gedeeltelijk'},
                ],
            },
        ],
    },
    {
        'value': ReportType.SPREADSHEET_OVERVIEW,
        'label': 'Ritregistratie overzicht',
        'description': 'Overzicht van alle ritregistratie spreadsheets.',
        'parameters': [
            {'name': 'year', 'label': 'Jaar', 'type': 'year', 'required': False},
            {'name': 'bedrijf_id', 'label': 'Bedrijf', 'type': 'company', 'required': False},
        ],
    },
]


class ReportRequestViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing report requests.

    Supports creating, listing, retrieving, and processing report requests.
    Reports can be generated as on-screen data, Excel, or PDF.
    """
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return ReportRequestCreateSerializer
        return ReportRequestSerializer

    def get_queryset(self):
        user = self.request.user
        if user.is_superuser or getattr(user, 'rol', None) == 'admin':
            return ReportRequest.objects.select_related('requested_by').all()
        return ReportRequest.objects.select_related('requested_by').filter(requested_by=user)

    def perform_create(self, serializer):
        serializer.save(requested_by=self.request.user)

    # ------------------------------------------------------------------
    # List available report types
    # ------------------------------------------------------------------

    @action(detail=False, methods=['get'], url_path='types')
    def report_types(self, request):
        """Return all available report types with their parameter schemas."""
        return Response(REPORT_TYPE_METADATA)

    # ------------------------------------------------------------------
    # Execute / process a report request
    # ------------------------------------------------------------------

    @action(detail=True, methods=['post'], url_path='execute')
    def execute(self, request, pk=None):
        """
        Execute the report: run the query, generate Excel/PDF if requested,
        and update the request status.
        """
        report_request = self.get_object()

        if report_request.status == ReportStatus.PROCESSING:
            return Response(
                {'error': 'Rapport wordt al verwerkt.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Mark as processing
        report_request.status = ReportStatus.PROCESSING
        report_request.save(update_fields=['status', 'updated_at'])

        try:
            columns, rows, title = execute_report(
                report_request.report_type,
                report_request.parameters,
            )

            output_format = report_request.output_format
            result_data = {'columns': columns, 'rows': rows, 'title': title}

            # Generate Excel
            if output_format in (ReportOutputFormat.EXCEL, ReportOutputFormat.ALL):
                excel_bytes = generate_excel(title, columns, rows)
                safe_title = ''.join(c for c in title if c.isalnum() or c in ' _-')[:50]
                filename = f"rapport_{safe_title}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
                report_request.excel_file.save(filename, ContentFile(excel_bytes), save=False)

            # Generate PDF
            if output_format in (ReportOutputFormat.PDF, ReportOutputFormat.ALL):
                pdf_bytes = generate_pdf(title, columns, rows)
                safe_title = ''.join(c for c in title if c.isalnum() or c in ' _-')[:50]
                filename = f"rapport_{safe_title}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
                report_request.pdf_file.save(filename, ContentFile(pdf_bytes), save=False)

            report_request.status = ReportStatus.COMPLETED
            report_request.result_data = result_data
            report_request.row_count = len(rows)
            report_request.completed_at = timezone.now()
            report_request.error_message = ''
            report_request.save()

            serializer = ReportRequestSerializer(report_request, context={'request': request})
            return Response(serializer.data)

        except Exception as exc:
            logger.exception("Report execution failed for %s", report_request.id)
            report_request.status = ReportStatus.FAILED
            report_request.error_message = str(exc)
            report_request.save(update_fields=['status', 'error_message', 'updated_at'])
            return Response(
                {'error': f'Rapport generatie mislukt: {exc}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    # ------------------------------------------------------------------
    # Download actions
    # ------------------------------------------------------------------

    @action(detail=True, methods=['get'], url_path='download/excel')
    def download_excel(self, request, pk=None):
        """Download the generated Excel file."""
        report_request = self.get_object()
        if not report_request.excel_file:
            return Response(
                {'error': 'Geen Excel bestand beschikbaar.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        response = FileResponse(
            report_request.excel_file.open('rb'),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        filename = report_request.excel_file.name.split('/')[-1]
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=True, methods=['get'], url_path='download/pdf')
    def download_pdf(self, request, pk=None):
        """Download the generated PDF file."""
        report_request = self.get_object()
        if not report_request.pdf_file:
            return Response(
                {'error': 'Geen PDF bestand beschikbaar.'},
                status=status.HTTP_404_NOT_FOUND,
            )
        response = FileResponse(
            report_request.pdf_file.open('rb'),
            content_type='application/pdf',
        )
        filename = report_request.pdf_file.name.split('/')[-1]
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    # ------------------------------------------------------------------
    # Re-queue a failed report
    # ------------------------------------------------------------------

    @action(detail=True, methods=['post'], url_path='retry')
    def retry(self, request, pk=None):
        """Reset a failed report to pending so it can be re-executed."""
        report_request = self.get_object()
        if report_request.status != ReportStatus.FAILED:
            return Response(
                {'error': 'Alleen mislukte rapporten kunnen opnieuw worden gestart.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        report_request.status = ReportStatus.PENDING
        report_request.error_message = ''
        report_request.save(update_fields=['status', 'error_message', 'updated_at'])
        serializer = ReportRequestSerializer(report_request, context={'request': request})
        return Response(serializer.data)

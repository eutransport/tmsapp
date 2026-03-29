"""
Reports agent models.
Handles report requests, queue management, and generated report files.
"""
import uuid
from django.db import models
from django.conf import settings


class ReportStatus(models.TextChoices):
    PENDING = 'pending', 'In wachtrij'
    PROCESSING = 'processing', 'Wordt verwerkt'
    COMPLETED = 'completed', 'Voltooid'
    FAILED = 'failed', 'Mislukt'


class ReportType(models.TextChoices):
    # Leave reports
    LEAVE_OVERVIEW_USER = 'leave_overview_user', 'Verlof overzicht per gebruiker'
    LEAVE_BALANCE_OVERVIEW = 'leave_balance_overview', 'Verlof saldo overzicht alle medewerkers'
    LEAVE_REQUESTS_OVERVIEW = 'leave_requests_overview', 'Verlofaanvragen overzicht'

    # Trip / time entry reports
    TRIPS_BY_USER = 'trips_by_user', 'Alle ritten van een gebruiker'
    TRIPS_BY_VEHICLE = 'trips_by_vehicle', 'Alle ritten van een voertuig (ritnummer)'
    TIME_ENTRIES_SUMMARY = 'time_entries_summary', 'Urenregistratie samenvatting'
    TIME_ENTRIES_BY_USER = 'time_entries_by_user', 'Urenregistraties per gebruiker'
    TIME_ENTRIES_BY_WEEK = 'time_entries_by_week', 'Urenregistraties per week'
    WEEKLY_HOURS_SUMMARY = 'weekly_hours_summary', 'Wekelijkse uren samenvatting'

    # Vehicle / fleet reports
    VEHICLE_OVERVIEW = 'vehicle_overview', 'Voertuigen overzicht'
    VEHICLE_MAINTENANCE = 'vehicle_maintenance', 'Onderhoud overzicht per voertuig'

    # Driver reports
    DRIVER_OVERVIEW = 'driver_overview', 'Chauffeurs overzicht'
    DRIVER_ACTIVITY = 'driver_activity', 'Activiteit per chauffeur'

    # Invoice reports
    INVOICE_OVERVIEW = 'invoice_overview', 'Facturen overzicht'
    INVOICE_BY_COMPANY = 'invoice_by_company', 'Facturen per bedrijf'
    REVENUE_SUMMARY = 'revenue_summary', 'Omzet samenvatting'

    # Company reports
    COMPANY_OVERVIEW = 'company_overview', 'Bedrijven overzicht'

    # Maintenance reports
    MAINTENANCE_OVERVIEW = 'maintenance_overview', 'Onderhoud overzicht'
    APK_OVERVIEW = 'apk_overview', 'APK overzicht'

    # Planning reports
    PLANNING_OVERVIEW = 'planning_overview', 'Planning overzicht'

    # Banking reports
    BANKING_TRANSACTIONS = 'banking_transactions', 'Bank transacties overzicht'

    # Spreadsheet reports
    SPREADSHEET_OVERVIEW = 'spreadsheet_overview', 'Ritregistratie overzicht'


class ReportOutputFormat(models.TextChoices):
    SCREEN = 'screen', 'Scherm'
    EXCEL = 'excel', 'Excel'
    PDF = 'pdf', 'PDF'
    ALL = 'all', 'Alle formaten'


class ReportRequest(models.Model):
    """
    A report request submitted by a user to the reporting agent.
    Supports queue-based processing with status tracking.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='report_requests',
        verbose_name='Aangevraagd door',
    )

    title = models.CharField(
        max_length=255,
        verbose_name='Titel',
    )

    report_type = models.CharField(
        max_length=50,
        choices=ReportType.choices,
        verbose_name='Rapport type',
    )

    parameters = models.JSONField(
        default=dict,
        blank=True,
        verbose_name='Parameters',
        help_text='JSON object with query parameters (user_id, year, vehicle_id, date_from, date_to, etc.)',
    )

    output_format = models.CharField(
        max_length=10,
        choices=ReportOutputFormat.choices,
        default=ReportOutputFormat.ALL,
        verbose_name='Uitvoer formaat',
    )

    status = models.CharField(
        max_length=20,
        choices=ReportStatus.choices,
        default=ReportStatus.PENDING,
        verbose_name='Status',
    )

    # Result data (for on-screen display)
    result_data = models.JSONField(
        null=True,
        blank=True,
        verbose_name='Resultaat data',
    )

    # Generated files
    excel_file = models.FileField(
        upload_to='reports/excel/',
        null=True,
        blank=True,
        verbose_name='Excel bestand',
    )
    pdf_file = models.FileField(
        upload_to='reports/pdf/',
        null=True,
        blank=True,
        verbose_name='PDF bestand',
    )

    error_message = models.TextField(
        blank=True,
        verbose_name='Foutmelding',
    )

    row_count = models.PositiveIntegerField(
        null=True,
        blank=True,
        verbose_name='Aantal rijen',
    )

    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Aangemaakt op')
    updated_at = models.DateTimeField(auto_now=True, verbose_name='Bijgewerkt op')
    completed_at = models.DateTimeField(null=True, blank=True, verbose_name='Voltooid op')

    class Meta:
        verbose_name = 'Rapport verzoek'
        verbose_name_plural = 'Rapport verzoeken'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.title} ({self.get_report_type_display()}) - {self.get_status_display()}"

    @property
    def is_completed(self):
        return self.status == ReportStatus.COMPLETED

    @property
    def is_pending(self):
        return self.status == ReportStatus.PENDING

    @property
    def is_processing(self):
        return self.status == ReportStatus.PROCESSING

    @property
    def is_failed(self):
        return self.status == ReportStatus.FAILED

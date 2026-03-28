import logging
import io
from datetime import date
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.core.mail import EmailMessage, get_connection
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

from apps.core.permissions import IsAdminOrManager
from apps.core.models import AppSettings
from apps.fleet.models import Vehicle
from apps.drivers.models import Driver
from .models import WeekPlanning, PlanningEntry, Weekday
from .serializers import (
    WeekPlanningSerializer, 
    WeekPlanningCreateSerializer,
    PlanningEntrySerializer
)

logger = logging.getLogger('accounts.security')


def safe_str(value):
    """Convert value to safe ASCII string (handle Unicode characters)."""
    if value is None:
        return '-'
    s = str(value)
    # Replace problematic characters with ASCII equivalents
    replacements = {
        '\u0130': 'I',  # Turkish dotted capital I (İ)
        '\u0131': 'i',  # Turkish dotless lowercase i (ı)
        '\u015e': 'S',  # Turkish S with cedilla (Ş)
        '\u015f': 's',  # Turkish s with cedilla (ş)
        '\u011e': 'G',  # Turkish G with breve (Ğ)
        '\u011f': 'g',  # Turkish g with breve (ğ)
        '\u00c7': 'C',  # C with cedilla (Ç)
        '\u00e7': 'c',  # c with cedilla (ç)
        '\u00d6': 'O',  # O with umlaut (Ö)
        '\u00f6': 'o',  # o with umlaut (ö)
        '\u00dc': 'U',  # U with umlaut (Ü)
        '\u00fc': 'u',  # u with umlaut (ü)
    }
    for char, replacement in replacements.items():
        s = s.replace(char, replacement)
    # Remove any remaining non-ASCII characters
    return s.encode('ascii', 'replace').decode('ascii')


class WeekPlanningViewSet(viewsets.ModelViewSet):
    """
    ViewSet voor weekplanningen.
    
    Chauffeurs: alleen lezen
    Gebruikers/Admins: volledige CRUD
    """
    queryset = WeekPlanning.objects.select_related('bedrijf').prefetch_related(
        'entries__vehicle', 'entries__chauffeur'
    ).all()
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['bedrijf', 'weeknummer', 'jaar']
    ordering_fields = ['weeknummer', 'jaar']
    search_fields = ['bedrijf__naam']
    
    def get_serializer_class(self):
        if self.action == 'create':
            return WeekPlanningCreateSerializer
        return WeekPlanningSerializer
    
    def perform_create(self, serializer):
        planning = serializer.save()
        
        # Auto-generate entries for all active vehicles of the company
        vehicles = Vehicle.objects.filter(bedrijf=planning.bedrijf, actief=True)
        days = [Weekday.MAANDAG, Weekday.DINSDAG, Weekday.WOENSDAG, Weekday.DONDERDAG, Weekday.VRIJDAG]
        
        entries = []
        for vehicle in vehicles:
            for day in days:
                entries.append(PlanningEntry(
                    planning=planning,
                    vehicle=vehicle,
                    dag=day
                ))
        
        PlanningEntry.objects.bulk_create(entries)
        
        # Audit log
        logger.info(
            f"WeekPlanning created: {planning.bedrijf.naam} Week {planning.weeknummer}/{planning.jaar} "
            f"by user {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        planning = serializer.save()
        logger.info(
            f"WeekPlanning updated: {planning.bedrijf.naam} Week {planning.weeknummer}/{planning.jaar} "
            f"by user {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        planning_info = f"{instance.bedrijf.naam} Week {instance.weeknummer}/{instance.jaar}"
        instance.delete()
        logger.warning(
            f"WeekPlanning deleted: {planning_info} by user {self.request.user.email}"
        )
    
    @action(detail=False, methods=['get'])
    def current_week(self, request):
        """Get info for current week."""
        today = date.today()
        iso = today.isocalendar()
        return Response({
            'weeknummer': iso[1],
            'jaar': iso[0]
        })
    
    @action(detail=False, methods=['get'])
    def next_week(self, request):
        """Get info for next week."""
        today = date.today()
        iso = today.isocalendar()
        next_week = iso[1] + 1
        year = iso[0]
        
        # Handle year boundary (ISO week can be 52 or 53)
        if next_week > 52:
            # Check if there's a week 53 this year
            last_day = date(year, 12, 31)
            max_week = last_day.isocalendar()[1]
            if next_week > max_week:
                next_week = 1
                year += 1
        
        return Response({
            'weeknummer': next_week,
            'jaar': year
        })
    
    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def my_planning(self, request):
        """Get planning for the current logged-in driver (chauffeur role only)."""
        user = request.user
        
        # Get week and year from query params, default to current week
        today = date.today()
        iso = today.isocalendar()
        weeknummer = int(request.query_params.get('weeknummer', iso[1]))
        jaar = int(request.query_params.get('jaar', iso[0]))
        
        # Find the driver linked to this user
        try:
            driver = Driver.objects.get(gekoppelde_gebruiker=user)
        except Driver.DoesNotExist:
            return Response({
                'entries': [],
                'message': 'Je bent niet gekoppeld aan een chauffeursprofiel'
            })
        
        # Get planning entries for this driver
        entries = PlanningEntry.objects.filter(
            chauffeur=driver,
            planning__weeknummer=weeknummer,
            planning__jaar=jaar
        ).select_related('planning__bedrijf', 'vehicle').order_by('dag')
        
        # Build response with readable data
        result = []
        day_order = {'ma': 1, 'di': 2, 'wo': 3, 'do': 4, 'vr': 5}
        day_names = {'ma': 'Maandag', 'di': 'Dinsdag', 'wo': 'Woensdag', 'do': 'Donderdag', 'vr': 'Vrijdag'}
        
        for entry in entries:
            result.append({
                'id': str(entry.id),
                'dag': entry.dag,
                'dag_naam': day_names.get(entry.dag, entry.dag),
                'dag_order': day_order.get(entry.dag, 99),
                'kenteken': entry.vehicle.kenteken if entry.vehicle else '',
                'voertuig_type': entry.vehicle.type_wagen if entry.vehicle else '',
                'bedrijf': entry.planning.bedrijf.naam if entry.planning.bedrijf else '',
                'ritnummer': entry.ritnummer or (entry.vehicle.ritnummer if entry.vehicle else ''),
                'weeknummer': entry.planning.weeknummer,
                'jaar': entry.planning.jaar,
            })
        
        # Sort by day order
        result.sort(key=lambda x: x['dag_order'])
        
        return Response({
            'weeknummer': weeknummer,
            'jaar': jaar,
            'chauffeur': driver.naam,
            'entries': result
        })
    
    @action(detail=True, methods=['post'])
    def copy_to_next_week(self, request, pk=None):
        """Copy planning to next week."""
        source = self.get_object()
        
        # Calculate next week
        next_week = source.weeknummer + 1
        year = source.jaar
        if next_week > 52:
            next_week = 1
            year += 1
        
        # Check if target already exists
        if WeekPlanning.objects.filter(
            bedrijf=source.bedrijf, 
            weeknummer=next_week, 
            jaar=year
        ).exists():
            return Response(
                {'error': f'Planning voor week {next_week}/{year} bestaat al'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create new planning
        new_planning = WeekPlanning.objects.create(
            bedrijf=source.bedrijf,
            weeknummer=next_week,
            jaar=year
        )
        
        # Copy entries (skip inactive vehicles)
        for entry in source.entries.select_related('vehicle').all():
            if not entry.vehicle.actief:
                continue  # Skip inactieve voertuigen
            PlanningEntry.objects.create(
                planning=new_planning,
                vehicle=entry.vehicle,
                dag=entry.dag,
                chauffeur=entry.chauffeur,
                ritnummer=entry.ritnummer,
                telefoon=entry.telefoon,
                adr=entry.adr
            )
        
        logger.info(
            f"WeekPlanning copied: {source.bedrijf.naam} Week {source.weeknummer}/{source.jaar} -> "
            f"Week {next_week}/{year} by user {request.user.email}"
        )
        
        serializer = self.get_serializer(new_planning)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['post'])
    def send_email(self, request, pk=None):
        """Send planning as PDF via email."""
        planning = self.get_object()
        
        # Get email address from request
        to_email = request.data.get('email')
        if not to_email:
            return Response(
                {'error': 'E-mailadres is verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Get SMTP settings
        settings = AppSettings.get_settings()
        if not settings.smtp_host:
            return Response(
                {'error': 'SMTP is niet geconfigureerd. Vul eerst de e-mail instellingen in.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            # Generate PDF
            pdf_buffer = self._generate_planning_pdf(planning)
            
            # Sanitize SMTP credentials for ASCII compatibility
            smtp_username = safe_str(settings.smtp_username) if settings.smtp_username else ''
            from_email = safe_str(settings.smtp_from_email or settings.smtp_username)
            
            # Create email connection
            connection = get_connection(
                backend='django.core.mail.backends.smtp.EmailBackend',
                host=settings.smtp_host,
                port=settings.smtp_port,
                username=smtp_username,
                password=settings.smtp_password or '',
                use_tls=settings.smtp_use_tls,
                fail_silently=False,
            )
            
            # Create email with PDF attachment
            bedrijf_naam_safe = safe_str(planning.bedrijf.naam)
            subject = f'Planning week {planning.weeknummer}'
            body = f"""Beste,

Hierbij de planning voor week {planning.weeknummer} ({planning.jaar}) van {bedrijf_naam_safe}.

Met vriendelijke groet,
TMS
"""
            
            email = EmailMessage(
                subject=subject,
                body=body,
                from_email=from_email,
                to=[to_email],
                connection=connection,
            )
            
            # Attach PDF - use safe filename
            filename = f'Planning_week_{planning.weeknummer}_{planning.jaar}_{bedrijf_naam_safe}.pdf'
            email.attach(filename, pdf_buffer.getvalue(), 'application/pdf')
            email.send(fail_silently=False)
            
            logger.info(
                f"Planning emailed: {bedrijf_naam_safe} Week {planning.weeknummer}/{planning.jaar} "
                f"to {to_email} by user {request.user.email}"
            )
            
            return Response({
                'message': f'Planning succesvol verzonden naar {to_email}'
            })
            
        except Exception as e:
            logger.error(f"Failed to email planning: {str(e)}")
            return Response(
                {'error': f'E-mail verzenden mislukt: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    def _generate_planning_pdf(self, planning):
        """Generate PDF for planning."""
        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=landscape(A4),
            leftMargin=1*cm,
            rightMargin=1*cm,
            topMargin=1*cm,
            bottomMargin=1*cm
        )
        
        elements = []
        styles = getSampleStyleSheet()
        
        # Title
        title_style = ParagraphStyle(
            'CustomTitle',
            parent=styles['Heading1'],
            fontSize=16,
            spaceAfter=12
        )
        bedrijf_naam = safe_str(planning.bedrijf.naam)
        title = Paragraph(
            f"Planning Week {planning.weeknummer} - {planning.jaar}<br/>{bedrijf_naam}",
            title_style
        )
        elements.append(title)
        elements.append(Spacer(1, 0.5*cm))
        
        # Day names mapping
        day_names = {
            'ma': 'Maandag', 'di': 'Dinsdag', 'wo': 'Woensdag', 
            'do': 'Donderdag', 'vr': 'Vrijdag'
        }
        day_order = {'ma': 1, 'di': 2, 'wo': 3, 'do': 4, 'vr': 5}
        
        # Get entries sorted by ritnummer and day
        entries = planning.entries.select_related('vehicle', 'chauffeur').all()
        sorted_entries = sorted(entries, key=lambda e: (
            int(e.vehicle.ritnummer) if e.vehicle.ritnummer and e.vehicle.ritnummer.isdigit() else 9999,
            e.vehicle.ritnummer or '',
            day_order.get(e.dag, 99)
        ))
        
        # Table header
        table_data = [['Ritnummer', 'Dag', 'Kenteken', 'Type', 'Chauffeur', 'Telefoon', 'ADR']]
        
        # Table rows
        for entry in sorted_entries:
            table_data.append([
                safe_str(entry.vehicle.ritnummer) if entry.vehicle else '-',
                day_names.get(entry.dag, entry.dag),
                safe_str(entry.vehicle.kenteken) if entry.vehicle else '-',
                safe_str(entry.vehicle.type_wagen) if entry.vehicle else '-',
                safe_str(entry.chauffeur.naam) if entry.chauffeur else '-',
                safe_str(entry.telefoon) if entry.telefoon else '-',
                'Ja' if entry.adr else 'Nee'
            ])
        
        # Create table
        table = Table(table_data, repeatRows=1)
        table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#3b82f6')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
            ('TOPPADDING', (0, 0), (-1, 0), 8),
            ('BACKGROUND', (0, 1), (-1, -1), colors.white),
            ('FONTNAME', (0, 1), (-1, -1), 'Helvetica'),
            ('FONTSIZE', (0, 1), (-1, -1), 9),
            ('BOTTOMPADDING', (0, 1), (-1, -1), 6),
            ('TOPPADDING', (0, 1), (-1, -1), 6),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.grey),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#f5f7fa')]),
        ]))
        
        elements.append(table)
        
        # Build PDF
        doc.build(elements)
        buffer.seek(0)
        return buffer


class PlanningEntryViewSet(viewsets.ModelViewSet):
    """
    ViewSet voor planningsregels.
    
    Chauffeurs: alleen lezen
    Gebruikers/Admins: volledige CRUD
    """
    queryset = PlanningEntry.objects.select_related(
        'planning__bedrijf', 'vehicle', 'chauffeur'
    ).all()
    serializer_class = PlanningEntrySerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['planning', 'dag', 'chauffeur', 'vehicle']
    
    def perform_update(self, serializer):
        entry = serializer.save()
        
        # Auto-fill telefoon and adr from chauffeur
        if entry.chauffeur:
            entry.telefoon = entry.chauffeur.telefoon or ''
            entry.adr = entry.chauffeur.adr
            entry.save(update_fields=['telefoon', 'adr'])
        else:
            entry.telefoon = ''
            entry.adr = False
            entry.save(update_fields=['telefoon', 'adr'])
        
        logger.info(
            f"PlanningEntry updated: {entry.vehicle.kenteken} {entry.get_dag_display()} "
            f"-> {entry.chauffeur.naam if entry.chauffeur else 'leeg'} "
            f"by user {self.request.user.email}"
        )

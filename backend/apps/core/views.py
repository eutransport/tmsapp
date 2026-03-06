"""
Core app views.
"""
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet
from rest_framework.parsers import MultiPartParser, FormParser
from django.core.mail import send_mail, EmailMessage, get_connection
from django.db.models import Sum
from django.db import connection
from django.core.cache import cache
from django.utils import timezone
from datetime import timedelta


def safe_str(value):
    """Convert value to safe ASCII string (handle Unicode characters)."""
    if value is None:
        return ''
    s = str(value)
    replacements = {
        '\u0130': 'I', '\u0131': 'i', '\u015e': 'S', '\u015f': 's',
        '\u011e': 'G', '\u011f': 'g', '\u00c7': 'C', '\u00e7': 'c',
        '\u00d6': 'O', '\u00f6': 'o', '\u00dc': 'U', '\u00fc': 'u',
    }
    for char, replacement in replacements.items():
        s = s.replace(char, replacement)
    return s.encode('ascii', 'replace').decode('ascii')

from .models import AppSettings, CustomFont
from .serializers import (
    AppSettingsSerializer, 
    AppSettingsAdminSerializer,
    EmailTestSerializer,
    CustomFontSerializer,
    FontFamilySerializer,
)


class HealthCheckView(APIView):
    """
    Health check endpoint for monitoring and deployment.
    No authentication required.
    """
    permission_classes = [AllowAny]
    
    def get(self, request):
        health = {
            'status': 'healthy',
            'timestamp': timezone.now().isoformat(),
            'checks': {}
        }
        
        # Check database connection
        try:
            with connection.cursor() as cursor:
                cursor.execute('SELECT 1')
            health['checks']['database'] = 'ok'
        except Exception as e:
            health['checks']['database'] = 'error'
            health['status'] = 'unhealthy'
            # Log full error server-side only
            import logging
            logging.getLogger(__name__).error(f'Health check database error: {e}')
        
        # Check cache (Redis)
        try:
            cache.set('health_check', 'ok', 10)
            if cache.get('health_check') == 'ok':
                health['checks']['cache'] = 'ok'
            else:
                health['checks']['cache'] = 'error'
                health['status'] = 'degraded'
        except Exception as e:
            health['checks']['cache'] = 'error'
            health['status'] = 'degraded'
            import logging
            logging.getLogger(__name__).error(f'Health check cache error: {e}')
        
        status_code = status.HTTP_200_OK if health['status'] == 'healthy' else status.HTTP_503_SERVICE_UNAVAILABLE
        return Response(health, status=status_code)


class PublicSettingsView(APIView):
    """
    Public endpoint for app branding settings.
    No authentication required.
    """
    permission_classes = [AllowAny]
    
    def get(self, request):
        settings = AppSettings.get_settings()
        serializer = AppSettingsSerializer(settings, context={'request': request})
        return Response(serializer.data)


class AdminSettingsViewSet(ViewSet):
    """
    Admin endpoint for managing all app settings.
    Requires admin authentication.
    """
    permission_classes = [IsAdminUser]
    
    def list(self, request):
        """Get all settings."""
        settings = AppSettings.get_settings()
        serializer = AppSettingsAdminSerializer(settings, context={'request': request})
        return Response(serializer.data)
    
    def partial_update(self, request, pk=None):
        """Update settings."""
        settings = AppSettings.get_settings()
        serializer = AppSettingsAdminSerializer(
            settings, 
            data=request.data, 
            partial=True,
            context={'request': request}
        )
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=False, methods=['post'])
    def upload_logo(self, request):
        """Upload logo image."""
        settings = AppSettings.get_settings()
        if 'logo' not in request.FILES:
            return Response(
                {'error': 'Geen bestand geüpload'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        uploaded_file = request.FILES['logo']
        
        # Validate file type
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
        if uploaded_file.content_type not in allowed_types:
            return Response(
                {'error': 'Ongeldig bestandstype. Alleen JPEG, PNG, GIF, WEBP en SVG zijn toegestaan.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate file size (max 2MB for logo)
        max_size = 2 * 1024 * 1024
        if uploaded_file.size > max_size:
            return Response(
                {'error': 'Bestand is te groot. Maximum grootte is 2MB.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate magic bytes (file header)
        uploaded_file.seek(0)
        header = uploaded_file.read(16)
        uploaded_file.seek(0)
        
        valid_signatures = [
            b'\xff\xd8\xff',  # JPEG
            b'\x89PNG\r\n\x1a\n',  # PNG
            b'GIF87a', b'GIF89a',  # GIF
            b'RIFF',  # WEBP (starts with RIFF)
            b'<?xml', b'<svg',  # SVG
        ]
        
        if not any(header.startswith(sig) for sig in valid_signatures):
            # Check for SVG (may start with whitespace or BOM)
            if b'<svg' not in header and b'<?xml' not in header:
                return Response(
                    {'error': 'Bestandsinhoud komt niet overeen met bestandstype.'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Sanitize SVG files to prevent stored XSS
        if uploaded_file.content_type == 'image/svg+xml':
            from .security import sanitize_svg
            from django.core.files.base import ContentFile
            uploaded_file.seek(0)
            raw = uploaded_file.read()
            sanitized = sanitize_svg(raw)
            uploaded_file = ContentFile(sanitized, name=uploaded_file.name)
        
        settings.logo = uploaded_file
        settings.save()
        serializer = AppSettingsAdminSerializer(settings, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def upload_favicon(self, request):
        """Upload favicon image."""
        settings = AppSettings.get_settings()
        if 'favicon' not in request.FILES:
            return Response(
                {'error': 'Geen bestand geüpload'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        uploaded_file = request.FILES['favicon']
        
        # Validate file type
        allowed_types = ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico']
        if uploaded_file.content_type not in allowed_types:
            return Response(
                {'error': 'Ongeldig bestandstype. Alleen PNG en ICO zijn toegestaan.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate file size (max 500KB for favicon)
        max_size = 500 * 1024
        if uploaded_file.size > max_size:
            return Response(
                {'error': 'Bestand is te groot. Maximum grootte is 500KB.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate magic bytes
        uploaded_file.seek(0)
        header = uploaded_file.read(8)
        uploaded_file.seek(0)
        
        valid_signatures = [
            b'\x89PNG\r\n\x1a\n',  # PNG
            b'\x00\x00\x01\x00',  # ICO
        ]
        
        if not any(header.startswith(sig) for sig in valid_signatures):
            return Response(
                {'error': 'Bestandsinhoud komt niet overeen met bestandstype.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        settings.favicon = uploaded_file
        settings.save()
        serializer = AppSettingsAdminSerializer(settings, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def delete_logo(self, request):
        """Delete logo image."""
        settings = AppSettings.get_settings()
        if settings.logo:
            settings.logo.delete(save=False)
            settings.logo = None
            settings.save()
        serializer = AppSettingsAdminSerializer(settings, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def delete_favicon(self, request):
        """Delete favicon image."""
        settings = AppSettings.get_settings()
        if settings.favicon:
            settings.favicon.delete(save=False)
            settings.favicon = None
            settings.save()
        serializer = AppSettingsAdminSerializer(settings, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['post'])
    def test_email(self, request):
        """Test email configuration using database SMTP settings."""
        serializer = EmailTestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        settings = AppSettings.get_settings()
        to_email = serializer.validated_data['to_email']
        
        # Validate SMTP settings are configured
        if not settings.smtp_host:
            return Response(
                {'error': 'SMTP host is niet geconfigureerd. Vul eerst de e-mail instellingen in.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            # Sanitize credentials for ASCII compatibility
            smtp_username = safe_str(settings.smtp_username) if settings.smtp_username else ''
            
            # Create custom connection with database settings
            connection = get_connection(
                backend='django.core.mail.backends.smtp.EmailBackend',
                host=settings.smtp_host,
                port=settings.smtp_port,
                username=smtp_username,
                password=settings.smtp_password or '',
                use_tls=settings.smtp_use_tls,
                fail_silently=False,
            )
            
            # Sanitize from_email for ASCII compatibility
            from_email = safe_str(settings.smtp_from_email or settings.smtp_username)
            
            # Create and send email
            email = EmailMessage(
                subject='TMS - Test E-mail',
                body='Dit is een test e-mail vanuit TMS om de e-mail configuratie te verifieren.\n\nAls je deze e-mail ontvangt, werken de e-mail instellingen correct!',
                from_email=from_email,
                to=[to_email],
                connection=connection,
            )
            email.send(fail_silently=False)
            
            return Response({
                'message': f'Test e-mail succesvol verzonden naar {to_email}!'
            })
        except smtplib.SMTPAuthenticationError as e:
            return Response(
                {'error': 'Authenticatie mislukt. Controleer gebruikersnaam en wachtwoord.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        except smtplib.SMTPConnectError as e:
            return Response(
                {'error': f'Kan geen verbinding maken met de SMTP server.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f'Email test failed: {e}')
            return Response(
                {'error': 'E-mail verzenden mislukt. Controleer de instellingen.'}, 
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ImageUploadView(APIView):
    """
    General image upload endpoint for templates and other purposes.
    Uploads images to media/uploads/ folder and returns the URL.
    SVG is excluded to prevent stored XSS.
    """
    permission_classes = [IsAuthenticated]
    
    # Magic byte signatures for image validation
    IMAGE_SIGNATURES = [
        (b'\xff\xd8\xff', 'image/jpeg'),       # JPEG
        (b'\x89PNG\r\n\x1a\n', 'image/png'),   # PNG
        (b'GIF87a', 'image/gif'),               # GIF87a
        (b'GIF89a', 'image/gif'),               # GIF89a
        (b'RIFF', 'image/webp'),                # WEBP
    ]
    
    def post(self, request):
        import os
        import uuid
        from django.core.files.storage import default_storage
        from django.core.files.base import ContentFile
        
        if 'image' not in request.FILES:
            return Response(
                {'error': 'Geen bestand geüpload'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        uploaded_file = request.FILES['image']
        
        # Validate file type (SVG excluded to prevent stored XSS)
        allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
        if uploaded_file.content_type not in allowed_types:
            return Response(
                {'error': 'Ongeldig bestandstype. Alleen JPEG, PNG, GIF en WEBP zijn toegestaan.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate file size (max 5MB)
        max_size = 5 * 1024 * 1024  # 5MB
        if uploaded_file.size > max_size:
            return Response(
                {'error': 'Bestand is te groot. Maximum grootte is 5MB.'}, 
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate magic bytes to prevent content-type spoofing
        uploaded_file.seek(0)
        header = uploaded_file.read(16)
        uploaded_file.seek(0)
        
        if not any(header.startswith(sig) for sig, _ in self.IMAGE_SIGNATURES):
            return Response(
                {'error': 'Bestandsinhoud komt niet overeen met bestandstype.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Generate unique filename (prevents name-based attacks)
        ext = os.path.splitext(uploaded_file.name)[1].lower()
        # Only allow safe extensions
        safe_extensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
        if ext not in safe_extensions:
            ext = '.png'  # default to png
        filename = f"{uuid.uuid4().hex}{ext}"
        filepath = f"uploads/{filename}"
        
        # Save file
        path = default_storage.save(filepath, ContentFile(uploaded_file.read()))
        
        # Build full URL
        file_url = request.build_absolute_uri(f'/media/{path}')
        
        return Response({
            'url': file_url,
            'filename': filename,
            'size': uploaded_file.size,
        })


class DashboardStatsView(APIView):
    """
    Dashboard statistics endpoint.
    Returns counts for users, companies, vehicles, hours this week, open invoices,
    and financial totals (income, expenses, profit, collected, outstanding) for the current year.
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        from apps.accounts.models import User
        from apps.companies.models import Company
        from apps.fleet.models import Vehicle
        from apps.timetracking.models import TimeEntry
        from apps.invoicing.models import Invoice, InvoiceType, InvoiceStatus, Expense
        from datetime import date
        
        # Get current week number
        today = timezone.now().date()
        week_number = today.isocalendar()[1]
        year = today.year
        
        # Count users (excluding inactive)
        user_count = User.objects.filter(is_active=True).count()
        
        # Count companies
        company_count = Company.objects.count()
        
        # Count vehicles (all vehicles)
        vehicle_count = Vehicle.objects.count()
        
        # Get hours this week
        week_entries = TimeEntry.objects.filter(
            weeknummer=week_number,
            datum__year=year
        )
        
        # Calculate total hours from totaal_uren (format: "HH:MM:SS")
        total_hours = 0
        for entry in week_entries:
            if entry.totaal_uren:
                try:
                    parts = str(entry.totaal_uren).split(':')
                    hours = int(parts[0])
                    minutes = int(parts[1]) if len(parts) > 1 else 0
                    total_hours += hours + (minutes / 60)
                except (ValueError, IndexError):
                    pass
        
        # Count open invoices (concept or definitief, not betaald)
        open_invoice_count = Invoice.objects.filter(
            status__in=['concept', 'definitief', 'verzonden']
        ).count()
        
        # ── Financial totals for current year ──
        start_of_year = date(year, 1, 1)
        
        active_statuses = [InvoiceStatus.DEFINITIEF, InvoiceStatus.VERZONDEN, InvoiceStatus.BETAALD]
        
        # Total income (verkoop)
        income_agg = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status__in=active_statuses,
            factuurdatum__gte=start_of_year,
            factuurdatum__lte=today,
        ).aggregate(total=Sum('totaal'))
        total_income = float(income_agg['total'] or 0)
        
        # Total expenses (inkoop + credit + direct expenses)
        invoice_expenses_agg = Invoice.objects.filter(
            type=InvoiceType.INKOOP,
            status__in=active_statuses,
            factuurdatum__gte=start_of_year,
            factuurdatum__lte=today,
        ).aggregate(total=Sum('totaal'))
        
        credit_expenses_agg = Invoice.objects.filter(
            type=InvoiceType.CREDIT,
            status__in=active_statuses,
            factuurdatum__gte=start_of_year,
            factuurdatum__lte=today,
        ).aggregate(total=Sum('totaal'))
        
        direct_expenses_agg = Expense.objects.filter(
            datum__gte=start_of_year,
            datum__lte=today,
        ).aggregate(total=Sum('totaal'))
        
        total_expenses = (
            float(invoice_expenses_agg['total'] or 0) +
            float(credit_expenses_agg['total'] or 0) +
            float(direct_expenses_agg['total'] or 0)
        )
        
        # Collected (betaald)
        collected_agg = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status=InvoiceStatus.BETAALD,
            factuurdatum__gte=start_of_year,
            factuurdatum__lte=today,
        ).aggregate(total=Sum('totaal'))
        total_collected = float(collected_agg['total'] or 0)
        
        # Outstanding (not betaald: definitief + verzonden)
        outstanding_agg = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status__in=[InvoiceStatus.DEFINITIEF, InvoiceStatus.VERZONDEN],
            factuurdatum__gte=start_of_year,
            factuurdatum__lte=today,
        ).aggregate(total=Sum('totaal'))
        total_outstanding = float(outstanding_agg['total'] or 0)
        
        return Response({
            'users': user_count,
            'companies': company_count,
            'vehicles': vehicle_count,
            'hours_this_week': round(total_hours, 1),
            'open_invoices': open_invoice_count,
            'week_number': week_number,
            'year': year,
            'financial': {
                'income': round(total_income, 2),
                'expenses': round(total_expenses, 2),
                'profit': round(total_income - total_expenses, 2),
                'collected': round(total_collected, 2),
                'outstanding': round(total_outstanding, 2),
            },
        })


class OnlineUsersView(APIView):
    """
    Online users endpoint — users with activity in the last 2 minutes.
    Polled every 2 minutes by the frontend.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.accounts.models import User

        # Also update caller's own last_activity so they show as online
        User.objects.filter(pk=request.user.pk).update(last_activity=timezone.now())

        threshold = timezone.now() - timedelta(minutes=2)
        online_qs = User.objects.filter(
            is_active=True,
            last_activity__gte=threshold,
        ).order_by('-last_activity')

        online_users = [
            {
                'id': str(u.id),
                'full_name': u.full_name,
                'email': u.email,
                'rol': u.rol,
                'last_activity': u.last_activity.isoformat() if u.last_activity else None,
            }
            for u in online_qs
        ]

        return Response({
            'online_users': online_users,
            'online_count': len(online_users),
        })


class RecentLoginsView(APIView):
    """
    Recent logins endpoint — paginated list of users who logged in recently.
    Ordered by last_login descending.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.accounts.models import User

        page = int(request.query_params.get('page', 1))
        per_page = min(int(request.query_params.get('per_page', 10)), 50)

        qs = User.objects.filter(
            is_active=True,
            last_login__isnull=False,
        ).order_by('-last_login')

        total = qs.count()
        total_pages = max(1, (total + per_page - 1) // per_page)
        page = max(1, min(page, total_pages))
        offset = (page - 1) * per_page

        users = qs[offset:offset + per_page]
        logins = [
            {
                'id': str(u.id),
                'full_name': u.full_name,
                'email': u.email,
                'rol': u.rol,
                'last_login': u.last_login.isoformat() if u.last_login else None,
            }
            for u in users
        ]

        return Response({
            'logins': logins,
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': total,
                'total_pages': total_pages,
                'has_next': page < total_pages,
                'has_previous': page > 1,
            },
        })


class RecentActivityView(APIView):
    """
    Recent activity endpoint for dashboard.
    Returns recent activities from ActivityLog, limited to 10.
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        from .models import ActivityLog
        
        limit = min(int(request.query_params.get('limit', 10)), 10)  # Max 10 for dashboard
        
        user = request.user
        is_admin = user.is_superuser or user.rol == 'admin'
        
        # Get activities from ActivityLog
        if is_admin:
            activities_qs = ActivityLog.objects.select_related('user').order_by('-created_at')[:limit]
        else:
            # Non-admins only see their own activities
            activities_qs = ActivityLog.objects.filter(user=user).select_related('user').order_by('-created_at')[:limit]
        
        activities = []
        for activity in activities_qs:
            activities.append({
                'id': str(activity.id),
                'type': activity.entity_type,
                'action': activity.action,
                'icon': self._get_icon(activity.entity_type),
                'title': activity.title,
                'description': activity.description,
                'timestamp': activity.created_at.isoformat(),
                'user': activity.user.email if activity.user else None,
                'user_name': f"{activity.user.voornaam} {activity.user.achternaam}" if activity.user else 'Systeem',
                'link': activity.link,
            })
        
        return Response({
            'activities': activities,
            'has_more': ActivityLog.objects.count() > limit
        })
    
    def _get_icon(self, entity_type):
        icons = {
            'invoice': 'document',
            'planning': 'calendar',
            'leave': 'clock',
            'user': 'user',
            'company': 'building',
            'vehicle': 'truck',
            'driver': 'user',
            'time_entry': 'clock',
        }
        return icons.get(entity_type, 'document')


class ActivityListView(APIView):
    """
    Full activity list with pagination for the activity page.
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        from .models import ActivityLog
        from django.core.paginator import Paginator
        
        user = request.user
        is_admin = user.is_superuser or user.rol == 'admin'
        
        page = int(request.query_params.get('page', 1))
        per_page = int(request.query_params.get('per_page', 25))
        entity_type = request.query_params.get('type')
        action = request.query_params.get('action')
        
        # Base queryset
        if is_admin:
            qs = ActivityLog.objects.select_related('user').order_by('-created_at')
        else:
            qs = ActivityLog.objects.filter(user=user).select_related('user').order_by('-created_at')
        
        # Apply filters
        if entity_type:
            qs = qs.filter(entity_type=entity_type)
        if action:
            qs = qs.filter(action=action)
        
        # Paginate
        paginator = Paginator(qs, per_page)
        page_obj = paginator.get_page(page)
        
        activities = []
        for activity in page_obj:
            activities.append({
                'id': str(activity.id),
                'type': activity.entity_type,
                'action': activity.action,
                'action_display': activity.get_action_display(),
                'title': activity.title,
                'description': activity.description,
                'timestamp': activity.created_at.isoformat(),
                'user': activity.user.email if activity.user else None,
                'user_name': f"{activity.user.voornaam} {activity.user.achternaam}" if activity.user else 'Systeem',
                'link': activity.link,
                'ip_address': activity.ip_address if is_admin else None,
            })
        
        return Response({
            'activities': activities,
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': paginator.count,
                'total_pages': paginator.num_pages,
                'has_next': page_obj.has_next(),
                'has_previous': page_obj.has_previous(),
            }
        })


class CustomFontViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing custom fonts.
    Admin only for create/update/delete.
    Authenticated users can list (for template selection).
    """
    queryset = CustomFont.objects.all()
    serializer_class = CustomFontSerializer
    parser_classes = [MultiPartParser, FormParser]
    
    def get_permissions(self):
        """
        Allow any authenticated user to list fonts.
        Require admin for modifications.
        """
        if self.action in ['list', 'retrieve', 'families', 'css']:
            return [IsAuthenticated()]
        return [IsAdminUser()]
    
    def get_queryset(self):
        """Filter by active fonts for non-admins."""
        qs = super().get_queryset()
        if not self.request.user.is_staff:
            qs = qs.filter(is_active=True)
        return qs.order_by('family', 'weight', 'style')
    
    def perform_create(self, serializer):
        """Set uploaded_by on creation."""
        serializer.save(uploaded_by=self.request.user)
    
    def perform_destroy(self, instance):
        """Prevent deletion of system fonts."""
        if instance.is_system:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Systeemfonts kunnen niet worden verwijderd.')
        instance.delete()
    
    @action(detail=False, methods=['get'])
    def families(self, request):
        """
        Get all font families with their variants.
        Useful for font pickers/selectors.
        """
        data = FontFamilySerializer.get_families_with_fonts()
        serializer = FontFamilySerializer(data, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], permission_classes=[AllowAny])
    def css(self, request):
        """
        Generate @font-face CSS for all active fonts.
        Returns CSS that can be injected into the page.
        """
        fonts = CustomFont.objects.filter(is_active=True)
        css_rules = []
        
        for font in fonts:
            if font.font_file:
                url = request.build_absolute_uri(font.font_file.url)
                css_rule = f"""@font-face {{
  font-family: '{font.family}';
  font-style: {font.style};
  font-weight: {font.weight};
  font-display: swap;
  src: url('{url}') format('{font.css_format}');
}}"""
                css_rules.append(css_rule)
        
        css_content = '\n\n'.join(css_rules)
        
        from django.http import HttpResponse
        response = HttpResponse(css_content, content_type='text/css')
        response['Cache-Control'] = 'public, max-age=3600'  # Cache for 1 hour
        return response


# ==========================================
# Server Monitoring Views
# ==========================================

class ServerStatsView(APIView):
    """
    Get current server stats: CPU, RAM, disk, uptime, load average.
    Admin only.
    """
    permission_classes = [IsAdminUser]
    
    def get(self, request):
        from .monitoring import get_current_stats
        stats = get_current_stats()
        return Response(stats)


class ServerHistoryView(APIView):
    """
    Get historical server metrics from Redis.
    Query param: period = 1h | 12h | 1d | 1w | 1m
    Admin only.
    """
    permission_classes = [IsAdminUser]
    
    def get(self, request):
        from .monitoring import get_metrics_history
        period = request.query_params.get('period', '1h')
        if period not in ('1h', '12h', '1d', '1w', '1m'):
            period = '1h'
        
        data = get_metrics_history(period)
        return Response({
            'period': period,
            'points': data,
            'count': len(data),
        })


class ServerContainersView(APIView):
    """
    List Docker containers with status and optional per-container stats.
    Admin only.
    """
    permission_classes = [IsAdminUser]
    
    def get(self, request):
        from .monitoring import docker_client
        
        if not docker_client.available:
            return Response({
                'available': False,
                'containers': [],
                'message': 'Docker socket niet beschikbaar. Mount /var/run/docker.sock in de container.',
            })
        
        containers = docker_client.list_containers()
        
        # Optionally include resource stats per container
        include_stats = request.query_params.get('stats', 'false').lower() == 'true'
        if include_stats:
            for container in containers:
                if container['state'] == 'running':
                    stats = docker_client.get_container_stats(container['id'])
                    container['stats'] = stats
                else:
                    container['stats'] = None
        
        return Response({
            'available': True,
            'containers': containers,
        })


class ServerContainerLogsView(APIView):
    """
    Get logs for a specific Docker container.
    URL param: container_id
    Query param: tail (default 100, max 500)
    Admin only.
    """
    permission_classes = [IsAdminUser]
    
    def get(self, request, container_id):
        from .monitoring import docker_client
        
        if not docker_client.available:
            return Response({
                'available': False,
                'logs': [],
                'message': 'Docker socket niet beschikbaar.',
            }, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        
        tail = min(int(request.query_params.get('tail', 100)), 500)
        logs = docker_client.get_container_logs(container_id, tail=tail)
        
        return Response({
            'container_id': container_id,
            'lines': logs,
            'count': len(logs),
        })

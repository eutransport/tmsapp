import json
import logging
from datetime import date, timedelta
from decimal import Decimal
from django.utils import timezone
from django.http import JsonResponse
from django.db.models import Sum, Q, Count
from django.db.models.functions import TruncWeek, TruncMonth, TruncQuarter, TruncYear
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdminOnly, IsAdminOrManager
from apps.core.security import sanitize_filename
from .models import InvoiceTemplate, Invoice, InvoiceLine, InvoiceStatus, InvoiceType, Expense, ExpenseCategory
from .serializers import (
    InvoiceTemplateSerializer,
    InvoiceSerializer,
    InvoiceCreateSerializer,
    InvoiceUpdateSerializer,
    InvoiceLineSerializer,
    ExpenseSerializer,
    ExpenseCategorySerializer,
)

logger = logging.getLogger('accounts.security')


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
    return s


class InvoiceTemplateViewSet(viewsets.ModelViewSet):
    """
    ViewSet voor factuur templates.
    Alleen admins mogen templates beheren.
    """
    queryset = InvoiceTemplate.objects.all()
    serializer_class = InvoiceTemplateSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    filterset_fields = ['is_active']
    search_fields = ['naam', 'beschrijving']
    
    def perform_create(self, serializer):
        template = serializer.save()
        logger.info(
            f"InvoiceTemplate created: '{template.naam}' by user {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        template = serializer.save()
        logger.info(
            f"InvoiceTemplate updated: '{template.naam}' by user {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        template_name = instance.naam
        instance.delete()
        logger.warning(
            f"InvoiceTemplate deleted: '{template_name}' by user {self.request.user.email}"
        )
    
    @action(detail=True, methods=['post'])
    def copy(self, request, pk=None):
        """Copy a template with all its content to a new template."""
        original = self.get_object()
        
        # Get new name from request or generate one
        new_name = request.data.get('naam', f"{original.naam} (kopie)")
        
        # Create copy with same layout and variables
        new_template = InvoiceTemplate.objects.create(
            naam=new_name,
            beschrijving=request.data.get('beschrijving', original.beschrijving),
            layout=original.layout,  # JSONField is deep copied
            variables=original.variables,  # JSONField is deep copied
            is_active=True,
        )
        
        logger.info(
            f"InvoiceTemplate copied: '{original.naam}' -> '{new_template.naam}' "
            f"by user {request.user.email}"
        )
        
        return Response(InvoiceTemplateSerializer(new_template).data, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['get'])
    def export(self, request, pk=None):
        """Export a template as JSON file (without images)."""
        template = self.get_object()
        
        # Create export data - strip image URLs from layout
        layout_copy = json.loads(json.dumps(template.layout))  # Deep copy
        
        # Remove image URLs from header, subheader, footer
        for section in ['header', 'subheader', 'footer']:
            if section in layout_copy:
                for pos in ['left', 'center', 'right']:
                    field = layout_copy[section].get(pos)
                    if field and field.get('type') == 'image':
                        field['imageUrl'] = None  # Remove image URL
        
        export_data = {
            'version': '1.0',
            'type': 'invoice_template',
            'naam': template.naam,
            'beschrijving': template.beschrijving,
            'layout': layout_copy,
            'variables': template.variables,
        }
        
        response = JsonResponse(export_data, json_dumps_params={'indent': 2, 'ensure_ascii': False})
        safe_name = sanitize_filename(template.naam) or 'template'
        response['Content-Disposition'] = f'attachment; filename="{safe_name}.json"'
        
        logger.info(
            f"InvoiceTemplate exported: '{template.naam}' by user {request.user.email}"
        )
        
        return response
    
    @action(detail=False, methods=['post'])
    def import_template(self, request):
        """Import a template from JSON data."""
        try:
            # Get JSON data from request
            if request.content_type == 'application/json':
                data = request.data
            else:
                # Handle file upload
                file = request.FILES.get('file')
                if not file:
                    return Response({'error': 'Geen bestand geüpload'}, status=status.HTTP_400_BAD_REQUEST)
                data = json.load(file)
            
            # Validate structure
            if data.get('type') != 'invoice_template':
                return Response({'error': 'Ongeldig template bestand'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Create new template from import
            new_name = request.query_params.get('naam') or data.get('naam', 'Geïmporteerde template')
            
            # Check if name already exists
            if InvoiceTemplate.objects.filter(naam=new_name).exists():
                new_name = f"{new_name} (import)"
            
            template = InvoiceTemplate.objects.create(
                naam=new_name,
                beschrijving=data.get('beschrijving', ''),
                layout=data.get('layout', {}),
                variables=data.get('variables', {}),
                is_active=True,
            )
            
            logger.info(
                f"InvoiceTemplate imported: '{template.naam}' by user {request.user.email}"
            )
            
            return Response(InvoiceTemplateSerializer(template).data, status=status.HTTP_201_CREATED)
            
        except json.JSONDecodeError:
            return Response({'error': 'Ongeldig JSON bestand'}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class InvoiceViewSet(viewsets.ModelViewSet):
    """
    ViewSet voor facturen.
    
    Chauffeurs: alleen lezen
    Gebruikers/Admins: volledige CRUD
    """
    queryset = Invoice.objects.select_related(
        'bedrijf', 'template', 'created_by'
    ).prefetch_related('lines').all()
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['type', 'status', 'bedrijf', 'week_number', 'week_year', 'chauffeur']
    search_fields = ['factuurnummer', 'bedrijf__naam']
    ordering_fields = ['factuurdatum', 'factuurnummer', 'totaal', 'bedrijf__naam']

    def get_queryset(self):
        qs = super().get_queryset()
        # Year filter on factuurdatum
        jaar = self.request.query_params.get('jaar')
        if jaar:
            qs = qs.filter(factuurdatum__year=int(jaar))
        return qs
    
    @action(detail=False, methods=['get'])
    def next_number(self, request):
        """Get next invoice number for a given type."""
        from apps.core.models import AppSettings
        
        invoice_type = request.query_params.get('type', 'verkoop')
        today = date.today()
        
        type_prefixes = {
            'verkoop': 'F',
            'credit': 'C',
            'inkoop': 'I',
        }
        prefix_char = type_prefixes.get(invoice_type, 'F')
        prefix = f"{prefix_char}-{today.year}"
        
        # Get start number from settings
        app_settings = AppSettings.objects.first()
        start_numbers = {
            'verkoop': getattr(app_settings, 'invoice_start_number_verkoop', 1) if app_settings else 1,
            'credit': getattr(app_settings, 'invoice_start_number_credit', 1) if app_settings else 1,
            'inkoop': getattr(app_settings, 'invoice_start_number_inkoop', 1) if app_settings else 1,
        }
        start_number = start_numbers.get(invoice_type, 1)
        
        last_invoice = Invoice.objects.filter(
            factuurnummer__startswith=prefix
        ).order_by('-factuurnummer').first()
        
        if last_invoice:
            try:
                last_num = int(last_invoice.factuurnummer.split('-')[-1])
                next_num = max(last_num + 1, start_number)
            except (ValueError, IndexError):
                next_num = start_number
        else:
            next_num = start_number
        
        factuurnummer = f"{prefix}-{next_num:04d}"
        
        return Response({
            'factuurnummer': factuurnummer,
            'type': invoice_type,
            'jaar': today.year,
        })
    
    def get_serializer_class(self):
        if self.action == 'create':
            return InvoiceCreateSerializer
        if self.action in ['update', 'partial_update']:
            return InvoiceUpdateSerializer
        return InvoiceSerializer
    
    def perform_create(self, serializer):
        # Generate invoice number based on type
        from apps.core.models import AppSettings
        
        today = date.today()
        invoice_type = serializer.validated_data.get('type', 'verkoop')
        
        # Prefix based on type: F=Factuur(verkoop), C=Credit, I=Inkoop
        type_prefixes = {
            'verkoop': 'F',
            'credit': 'C',
            'inkoop': 'I',
        }
        prefix_char = type_prefixes.get(invoice_type, 'F')
        prefix = f"{prefix_char}-{today.year}"
        
        # Get start number from settings
        app_settings = AppSettings.objects.first()
        start_numbers = {
            'verkoop': getattr(app_settings, 'invoice_start_number_verkoop', 1) if app_settings else 1,
            'credit': getattr(app_settings, 'invoice_start_number_credit', 1) if app_settings else 1,
            'inkoop': getattr(app_settings, 'invoice_start_number_inkoop', 1) if app_settings else 1,
        }
        start_number = start_numbers.get(invoice_type, 1)
        
        # Get next number for this type and year
        last_invoice = Invoice.objects.filter(
            factuurnummer__startswith=prefix
        ).order_by('-factuurnummer').first()
        
        if last_invoice:
            try:
                last_num = int(last_invoice.factuurnummer.split('-')[-1])
                next_num = max(last_num + 1, start_number)
            except (ValueError, IndexError):
                next_num = start_number
        else:
            next_num = start_number
        
        factuurnummer = f"{prefix}-{next_num:04d}"
        
        invoice = serializer.save(
            created_by=self.request.user,
            factuurnummer=factuurnummer
        )
        
        logger.info(
            f"Invoice created: {factuurnummer} for {invoice.bedrijf.naam} "
            f"by user {self.request.user.email}"
        )
        
        # Store invoice instance for create response
        self._created_invoice = invoice
    
    def create(self, request, *args, **kwargs):
        """Override create to return full invoice data with id."""
        from rest_framework import status as drf_status
        try:
            serializer = self.get_serializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            self.perform_create(serializer)
            # Return full invoice data using InvoiceSerializer
            response_serializer = InvoiceSerializer(self._created_invoice)
            headers = self.get_success_headers(response_serializer.data)
            return Response(response_serializer.data, status=drf_status.HTTP_201_CREATED, headers=headers)
        except Exception as e:
            logger.error(f"Invoice create failed: {str(e)} | Data: {request.data} | User: {request.user.email}")
            raise
    
    def perform_update(self, serializer):
        old_status = self.get_object().status
        invoice = serializer.save()
        
        if invoice.status != old_status:
            logger.info(
                f"Invoice status changed: {invoice.factuurnummer} "
                f"'{old_status}' -> '{invoice.status}' by user {self.request.user.email}"
            )
        else:
            logger.info(
                f"Invoice updated: {invoice.factuurnummer} by user {self.request.user.email}"
            )
    
    def perform_destroy(self, instance):
        # Log warning for non-concept invoices
        if instance.status != InvoiceStatus.CONCEPT:
            logger.warning(
                f"Non-concept invoice being deleted: {instance.factuurnummer} "
                f"(status: {instance.status}) by user {self.request.user.email}"
            )
        
        invoice_nr = instance.factuurnummer
        instance.delete()
        logger.warning(
            f"Invoice deleted: {invoice_nr} by user {self.request.user.email}"
        )
    
    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Delete multiple invoices at once."""
        ids = request.data.get('ids', [])
        
        if not ids:
            return Response(
                {'error': 'Geen facturen geselecteerd'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        deleted_count = 0
        errors = []
        
        for invoice_id in ids:
            try:
                invoice = Invoice.objects.get(id=invoice_id)
                invoice_nr = invoice.factuurnummer
                invoice_status = invoice.status
                invoice.delete()
                deleted_count += 1
                
                if invoice_status != InvoiceStatus.CONCEPT:
                    logger.warning(
                        f"Non-concept invoice bulk deleted: {invoice_nr} "
                        f"(status: {invoice_status}) by user {request.user.email}"
                    )
                else:
                    logger.info(
                        f"Invoice bulk deleted: {invoice_nr} by user {request.user.email}"
                    )
            except Invoice.DoesNotExist:
                errors.append(f"Factuur {invoice_id} niet gevonden")
            except Exception as e:
                errors.append(f"Fout bij verwijderen: {str(e)}")
        
        logger.info(
            f"Bulk delete completed: {deleted_count} invoices deleted by user {request.user.email}"
        )
        
        return Response({
            'deleted': deleted_count,
            'errors': errors
        })

    @action(detail=False, methods=['post'])
    def bulk_status(self, request):
        """Change status for multiple invoices at once."""
        ids = request.data.get('ids', [])
        new_status = request.data.get('status')
        
        if not ids:
            return Response(
                {'error': 'Geen facturen geselecteerd'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        valid_statuses = [s[0] for s in InvoiceStatus.choices]
        if new_status not in valid_statuses:
            return Response(
                {'error': f'Ongeldige status. Kies uit: {", ".join(valid_statuses)}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        updated_count = 0
        errors = []
        
        for invoice_id in ids:
            try:
                invoice = Invoice.objects.get(id=invoice_id)
                old_status = invoice.status
                
                # Validation for definitief
                if new_status == InvoiceStatus.DEFINITIEF:
                    if invoice.status != InvoiceStatus.CONCEPT:
                        errors.append(f"{invoice.factuurnummer}: Alleen concept facturen kunnen definitief worden")
                        continue
                    if not invoice.lines.exists():
                        errors.append(f"{invoice.factuurnummer}: Factuur moet minimaal 1 regel bevatten")
                        continue
                
                invoice.status = new_status
                
                # Set sent_at for verzonden
                if new_status == InvoiceStatus.VERZONDEN:
                    invoice.sent_at = timezone.now()
                # Clear sent_at if going back to concept/definitief
                elif new_status in [InvoiceStatus.CONCEPT, InvoiceStatus.DEFINITIEF]:
                    invoice.sent_at = None
                
                invoice.save()
                updated_count += 1
                
                logger.info(
                    f"Invoice bulk status change: {invoice.factuurnummer} "
                    f"'{old_status}' -> '{new_status}' by user {request.user.email}"
                )
            except Invoice.DoesNotExist:
                errors.append(f"Factuur {invoice_id} niet gevonden")
            except Exception as e:
                errors.append(f"Fout: {str(e)}")
        
        status_labels = {
            'concept': 'concept',
            'definitief': 'definitief',
            'verzonden': 'verzonden',
            'betaald': 'betaald',
        }
        
        logger.info(
            f"Bulk status change completed: {updated_count} invoices updated to '{new_status}' by user {request.user.email}"
        )
        
        return Response({
            'updated': updated_count,
            'errors': errors,
            'message': f'{updated_count} factuur/facturen gemarkeerd als {status_labels.get(new_status, new_status)}'
        })
    
    @action(detail=True, methods=['post'])
    def recalculate(self, request, pk=None):
        """Recalculate invoice totals."""
        invoice = self.get_object()
        invoice.calculate_totals()
        logger.info(
            f"Invoice recalculated: {invoice.factuurnummer} by user {request.user.email}"
        )
        return Response(InvoiceSerializer(invoice).data)
    
    @action(detail=True, methods=['post'])
    def mark_definitief(self, request, pk=None):
        """Mark invoice as definitief (no more edits to lines)."""
        invoice = self.get_object()
        
        if invoice.status != InvoiceStatus.CONCEPT:
            return Response(
                {'error': 'Alleen concept facturen kunnen definitief worden gemaakt'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not invoice.lines.exists():
            return Response(
                {'error': 'Factuur moet minimaal 1 regel bevatten'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        invoice.status = InvoiceStatus.DEFINITIEF
        invoice.save()
        
        logger.info(
            f"Invoice marked definitief: {invoice.factuurnummer} by user {request.user.email}"
        )
        return Response(InvoiceSerializer(invoice).data)
    
    @action(detail=True, methods=['post'])
    def change_status(self, request, pk=None):
        """Change invoice status to any status (admin override)."""
        invoice = self.get_object()
        new_status = request.data.get('status')
        
        valid_statuses = [s[0] for s in InvoiceStatus.choices]
        if new_status not in valid_statuses:
            return Response(
                {'error': f'Ongeldige status. Kies uit: {", ".join(valid_statuses)}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        old_status = invoice.status
        invoice.status = new_status
        
        # Clear sent_at if going back to concept/definitief
        if new_status in [InvoiceStatus.CONCEPT, InvoiceStatus.DEFINITIEF]:
            invoice.sent_at = None
        
        invoice.save()
        
        logger.info(
            f"Invoice status changed: {invoice.factuurnummer} "
            f"'{old_status}' -> '{new_status}' by user {request.user.email}"
        )
        return Response(InvoiceSerializer(invoice).data)
    
    @action(detail=True, methods=['post'])
    def mark_verzonden(self, request, pk=None):
        """Mark invoice as sent."""
        invoice = self.get_object()
        
        # Removed restriction - allow from any status
        invoice.status = InvoiceStatus.VERZONDEN
        invoice.sent_at = timezone.now()
        invoice.save()
        
        logger.info(
            f"Invoice marked verzonden: {invoice.factuurnummer} by user {request.user.email}"
        )
        return Response(InvoiceSerializer(invoice).data)
    
    @action(detail=True, methods=['post'])
    def mark_betaald(self, request, pk=None):
        """Mark invoice as paid."""
        invoice = self.get_object()
        
        # Removed restriction - allow from any status
        invoice.status = InvoiceStatus.BETAALD
        invoice.save()
        
        logger.info(
            f"Invoice marked betaald: {invoice.factuurnummer} by user {request.user.email}"
        )
        return Response(InvoiceSerializer(invoice).data)
    
    @action(detail=True, methods=['get', 'post'])
    def generate_pdf(self, request, pk=None):
        """Generate PDF for invoice (works for any status)."""
        from django.http import HttpResponse
        from .pdf_generator import generate_invoice_pdf
        
        invoice = self.get_object()
        
        # Generate PDF
        pdf_content = generate_invoice_pdf(invoice)
        
        # Create response with PDF
        response = HttpResponse(pdf_content, content_type='application/pdf')
        
        # Set filename based on invoice number (sanitized)
        raw_name = f"factuur_{invoice.factuurnummer.replace('/', '-')}.pdf"
        filename = sanitize_filename(raw_name) or 'factuur.pdf'
        
        # Check if download or view in browser
        if request.query_params.get('download', 'false').lower() == 'true':
            response['Content-Disposition'] = f'attachment; filename="{filename}"'
        else:
            response['Content-Disposition'] = f'inline; filename="{filename}"'
        
        logger.info(
            f"PDF generated for invoice: {invoice.factuurnummer} by user {request.user.email}"
        )
        
        return response
    
    @action(detail=True, methods=['post'])
    def send_email(self, request, pk=None):
        """Send invoice via email. Supports single email, multiple emails, or mailing list."""
        from django.core.mail import EmailMessage
        from apps.core.models import AppSettings
        
        invoice = self.get_object()
        
        if invoice.status not in [InvoiceStatus.DEFINITIEF, InvoiceStatus.VERZONDEN]:
            return Response(
                {'error': 'E-mail kan alleen voor definitieve/verzonden facturen worden verstuurd'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Collect recipient emails
        recipient_emails = []
        
        # Option 1: Single email from request
        single_email = request.data.get('email')
        if single_email:
            recipient_emails.append(single_email)
        
        # Option 2: Multiple emails from request (mailing list selection)
        emails_list = request.data.get('emails', [])
        if emails_list and isinstance(emails_list, list):
            recipient_emails.extend(emails_list)
        
        # Option 3: Use mailing list flag - send to all active contacts of the company
        use_mailing_list = request.data.get('use_mailing_list', False)
        if use_mailing_list:
            from apps.companies.models import MailingListContact
            mailing_contacts = MailingListContact.objects.filter(
                bedrijf=invoice.bedrijf, is_active=True
            )
            for contact in mailing_contacts:
                if contact.email not in recipient_emails:
                    recipient_emails.append(contact.email)
        
        # Fallback to company email
        if not recipient_emails:
            if hasattr(invoice.bedrijf, 'email') and invoice.bedrijf.email:
                recipient_emails.append(invoice.bedrijf.email)
            else:
                return Response(
                    {'error': 'Geen e-mailadres opgegeven en bedrijf heeft geen e-mailadres'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Remove duplicates while preserving order
        seen = set()
        unique_emails = []
        for e in recipient_emails:
            if e not in seen:
                seen.add(e)
                unique_emails.append(e)
        recipient_emails = unique_emails
        
        # Get app settings for SMTP and company info
        settings = AppSettings.get_settings()
        
        if not settings.smtp_host:
            return Response(
                {'error': 'SMTP instellingen zijn niet geconfigureerd. Ga naar Instellingen om e-mail te configureren.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Build email - only show factuurnummer in subject, no company name
        subject = f"Factuur {invoice.factuurnummer}"
        
        # Build email body with optional signature
        signature = settings.email_signature or ''
        signature_block = f"\n\n{signature}" if signature else ''
        
        body = f"""Geachte,

Hierbij ontvangt u factuur {invoice.factuurnummer}.

Factuurdatum: {invoice.factuurdatum.strftime('%d-%m-%Y')}
Vervaldatum: {invoice.vervaldatum.strftime('%d-%m-%Y')}
Bedrag: € {invoice.totaal:.2f}

{f"Opmerkingen: {invoice.opmerkingen}" if invoice.opmerkingen else ""}

Met vriendelijke groet,
{settings.company_name or ''}
{settings.company_email or ''}{signature_block}
"""
        
        try:
            # Create custom SMTP connection using database settings
            from django.core.mail import get_connection
            
            # Sanitize SMTP credentials for ASCII compatibility
            smtp_username = safe_str(settings.smtp_username) if settings.smtp_username else ''
            from_email = safe_str(settings.smtp_from_email or settings.smtp_username)
            
            connection = get_connection(
                backend='django.core.mail.backends.smtp.EmailBackend',
                host=settings.smtp_host,
                port=settings.smtp_port,
                username=smtp_username,
                password=settings.smtp_password,
                use_tls=settings.smtp_use_tls,
                fail_silently=False,
            )
            
            email = EmailMessage(
                subject=subject,
                body=body,
                from_email=from_email,
                to=recipient_emails,
                connection=connection,
            )
            
            # Generate and attach PDF
            from .pdf_generator import generate_invoice_pdf
            pdf_content = generate_invoice_pdf(invoice)
            filename = f"factuur_{invoice.factuurnummer.replace('/', '-')}.pdf"
            email.attach(filename, pdf_content, 'application/pdf')
            
            email.send()
            
            # Update invoice status to verzonden if definitief
            if invoice.status == InvoiceStatus.DEFINITIEF:
                invoice.status = InvoiceStatus.VERZONDEN
                invoice.sent_at = timezone.now()
                invoice.save()
            
            recipients_str = ', '.join(recipient_emails)
            logger.info(
                f"Invoice email sent: {invoice.factuurnummer} to {recipients_str} "
                f"by user {request.user.email}"
            )
            
            return Response({
                'message': f'Factuur succesvol verzonden naar {recipients_str}',
                'invoice': InvoiceSerializer(invoice).data
            })
            
        except Exception as e:
            logger.error(f"Email send failed for invoice {invoice.factuurnummer}: {str(e)}")
            return Response(
                {'error': f'E-mail verzenden mislukt: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class InvoiceLineViewSet(viewsets.ModelViewSet):
    """
    ViewSet voor factuurregels.
    
    Chauffeurs: alleen lezen
    Gebruikers/Admins: volledige CRUD (alleen bij concept facturen)
    """
    queryset = InvoiceLine.objects.select_related('invoice', 'invoice__bedrijf').all()
    serializer_class = InvoiceLineSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['invoice']
    
    def create(self, request, *args, **kwargs):
        """Override create to add better error logging."""
        try:
            serializer = self.get_serializer(data=request.data)
            if not serializer.is_valid():
                logger.error(
                    f"InvoiceLine validation failed: {serializer.errors} "
                    f"Data: {request.data} "
                    f"User: {request.user.email}"
                )
                return Response(serializer.errors, status=400)
            return super().create(request, *args, **kwargs)
        except Exception as e:
            logger.error(f"InvoiceLine create failed: {str(e)} | Data: {request.data} | User: {request.user.email}")
            raise
    
    def perform_create(self, serializer):
        line = serializer.save()
        line.invoice.calculate_totals()
        
        logger.info(
            f"InvoiceLine created: '{line.omschrijving}' for {line.invoice.factuurnummer} "
            f"by user {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        line = serializer.save()
        line.invoice.calculate_totals()
        
        logger.info(
            f"InvoiceLine updated: '{line.omschrijving}' for {line.invoice.factuurnummer} "
            f"by user {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        # Log warning for non-concept invoice line deletion
        if instance.invoice.status != InvoiceStatus.CONCEPT:
            logger.warning(
                f"InvoiceLine being deleted from non-concept invoice: {instance.invoice.factuurnummer} "
                f"(status: {instance.invoice.status}) by user {self.request.user.email}"
            )
        
        invoice = instance.invoice
        line_desc = instance.omschrijving
        instance.delete()
        invoice.calculate_totals()
        
        logger.warning(
            f"InvoiceLine deleted: '{line_desc}' from {invoice.factuurnummer} "
            f"by user {self.request.user.email}"
        )


class ExpenseViewSet(viewsets.ModelViewSet):
    """
    ViewSet voor uitgaven.
    Alleen admins en managers mogen uitgaven beheren.
    """
    queryset = Expense.objects.select_related('bedrijf', 'voertuig', 'chauffeur', 'created_by').all()
    serializer_class = ExpenseSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['categorie', 'bedrijf', 'voertuig', 'chauffeur']
    search_fields = ['omschrijving', 'notities']
    ordering = ['-datum', '-created_at']
    
    def perform_create(self, serializer):
        expense = serializer.save(created_by=self.request.user)
        logger.info(
            f"Expense created: '{expense.omschrijving}' (€{expense.totaal}) "
            f"by user {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        expense = serializer.save()
        logger.info(
            f"Expense updated: '{expense.omschrijving}' (€{expense.totaal}) "
            f"by user {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        desc = instance.omschrijving
        instance.delete()
        logger.warning(
            f"Expense deleted: '{desc}' by user {self.request.user.email}"
        )
    
    @action(detail=False, methods=['get'])
    def categories(self, request):
        """Get all expense categories."""
        categories = ExpenseCategorySerializer.get_categories()
        return Response(categories)
    
    @action(detail=False, methods=['get'])
    def summary(self, request):
        """Get expense summary by category for a date range."""
        # Get date range from query params
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        
        qs = self.get_queryset()
        
        if start_date:
            qs = qs.filter(datum__gte=start_date)
        if end_date:
            qs = qs.filter(datum__lte=end_date)
        
        # Aggregate by category
        summary = qs.values('categorie').annotate(
            totaal=Sum('totaal'),
            aantal=Count('id')
        ).order_by('-totaal')
        
        # Add display names
        result = []
        for item in summary:
            result.append({
                'categorie': item['categorie'],
                'categorie_display': dict(ExpenseCategory.choices).get(item['categorie'], item['categorie']),
                'totaal': item['totaal'] or 0,
                'aantal': item['aantal']
            })
        
        return Response(result)


class RevenueView(APIView):
    """
    API endpoint voor omzet/winst statistieken.
    Ondersteunt week/maand/kwartaal/jaar aggregatie.
    Bevat: inkomsten (verkoop - credit), uitgaven (inkoop + directe kosten),
    totaal gevorderd (betaald) en totaal nog te vorderen (niet betaald).
    """
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    
    def get(self, request):
        # Get parameters
        period = request.query_params.get('period', 'month')  # week, month, quarter, year
        year = request.query_params.get('year')
        
        # Determine date range
        today = date.today()
        if year:
            year = int(year)
            start_date = date(year, 1, 1)
            end_date = date(year, 12, 31)
        else:
            # Default: current year
            year = today.year
            start_date = date(year, 1, 1)
            end_date = today
        
        # Get truncation function based on period
        trunc_funcs = {
            'week': TruncWeek,
            'month': TruncMonth,
            'quarter': TruncQuarter,
            'year': TruncYear,
        }
        trunc_func = trunc_funcs.get(period, TruncMonth)
        
        # Get income (verkoop facturen - definitief/verzonden/betaald)
        income_statuses = [InvoiceStatus.DEFINITIEF, InvoiceStatus.VERZONDEN, InvoiceStatus.BETAALD]
        income_qs = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status__in=income_statuses,
            factuurdatum__gte=start_date,
            factuurdatum__lte=end_date,
        ).annotate(
            period=trunc_func('factuurdatum')
        ).values('period').annotate(
            totaal=Sum('totaal')
        ).order_by('period')
        
        # Get expenses from invoices (inkoop facturen)
        invoice_expenses_qs = Invoice.objects.filter(
            type=InvoiceType.INKOOP,
            status__in=income_statuses,
            factuurdatum__gte=start_date,
            factuurdatum__lte=end_date,
        ).annotate(
            period=trunc_func('factuurdatum')
        ).values('period').annotate(
            totaal=Sum('totaal')
        ).order_by('period')
        
        # Get credit invoices as expenses (creditfacturen)
        credit_expenses_qs = Invoice.objects.filter(
            type=InvoiceType.CREDIT,
            status__in=income_statuses,
            factuurdatum__gte=start_date,
            factuurdatum__lte=end_date,
        ).annotate(
            period=trunc_func('factuurdatum')
        ).values('period').annotate(
            totaal=Sum('totaal')
        ).order_by('period')
        
        # Get expenses from Expense model
        direct_expenses_qs = Expense.objects.filter(
            datum__gte=start_date,
            datum__lte=end_date,
        ).annotate(
            period=trunc_func('datum')
        ).values('period').annotate(
            totaal=Sum('totaal')
        ).order_by('period')
        
        # Combine all data into a timeline
        income_dict = {item['period']: float(item['totaal'] or 0) for item in income_qs}
        invoice_exp_dict = {item['period']: float(item['totaal'] or 0) for item in invoice_expenses_qs}
        credit_exp_dict = {item['period']: float(item['totaal'] or 0) for item in credit_expenses_qs}
        direct_exp_dict = {item['period']: float(item['totaal'] or 0) for item in direct_expenses_qs}
        
        # Get all unique periods
        all_periods = sorted(set(
            list(income_dict.keys()) + 
            list(invoice_exp_dict.keys()) + 
            list(credit_exp_dict.keys()) +
            list(direct_exp_dict.keys())
        ))
        
        # Build result
        data = []
        total_income = 0
        total_expenses = 0
        total_credit = 0
        
        for period_date in all_periods:
            income = income_dict.get(period_date, 0)
            credit = credit_exp_dict.get(period_date, 0)
            net_income = income - credit
            expenses = invoice_exp_dict.get(period_date, 0) + direct_exp_dict.get(period_date, 0)
            profit = net_income - expenses
            
            total_income += net_income
            total_expenses += expenses
            total_credit += credit
            
            # Format period label
            if period == 'week':
                label = f"Week {period_date.isocalendar()[1]}, {period_date.year}"
            elif period == 'month':
                label = period_date.strftime('%B %Y')
            elif period == 'quarter':
                quarter = (period_date.month - 1) // 3 + 1
                label = f"Q{quarter} {period_date.year}"
            else:
                label = str(period_date.year)
            
            data.append({
                'period': period_date.isoformat(),
                'label': label,
                'income': round(net_income, 2),
                'credit': round(credit, 2),
                'expenses': round(expenses, 2),
                'profit': round(profit, 2),
            })
        
        # Calculate totals and summary
        total_profit = total_income - total_expenses
        
        # Totaal gevorderd: verkoop facturen die betaald zijn
        collected_agg = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status=InvoiceStatus.BETAALD,
            factuurdatum__gte=start_date,
            factuurdatum__lte=end_date,
        ).aggregate(total=Sum('totaal'))
        total_collected = float(collected_agg['total'] or 0)
        
        # Totaal nog te vorderen: verkoop facturen die NIET betaald zijn (definitief + verzonden)
        outstanding_agg = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status__in=[InvoiceStatus.DEFINITIEF, InvoiceStatus.VERZONDEN],
            factuurdatum__gte=start_date,
            factuurdatum__lte=end_date,
        ).aggregate(total=Sum('totaal'))
        total_outstanding = float(outstanding_agg['total'] or 0)
        
        return Response({
            'period_type': period,
            'year': year,
            'start_date': start_date.isoformat(),
            'end_date': end_date.isoformat(),
            'data': data,
            'totals': {
                'income': round(total_income, 2),
                'credit': round(total_credit, 2),
                'expenses': round(total_expenses, 2),
                'profit': round(total_profit, 2),
                'collected': round(total_collected, 2),
                'outstanding': round(total_outstanding, 2),
            },
            'summary': {
                'avg_income': round(total_income / len(data), 2) if data else 0,
                'avg_expenses': round(total_expenses / len(data), 2) if data else 0,
                'avg_profit': round(total_profit / len(data), 2) if data else 0,
                'profit_margin': round((total_profit / total_income * 100), 1) if total_income > 0 else 0,
            }
        })


class RevenueForecastView(APIView):
    """
    Forecast revenue, expenses and profit for upcoming periods.
    Uses weighted moving average of recent months (last 6 months)
    to project forward for month, quarter, half year and year.
    """
    permission_classes = [IsAuthenticated, IsAdminOrManager]

    def get(self, request):
        today = date.today()
        months_back = 6
        # Start from 6 months ago, first day of that month
        start_month = today.month - months_back
        start_year = today.year
        while start_month <= 0:
            start_month += 12
            start_year -= 1
        start_date = date(start_year, start_month, 1)

        income_statuses = [InvoiceStatus.DEFINITIEF, InvoiceStatus.VERZONDEN, InvoiceStatus.BETAALD]

        # Monthly income (verkoop)
        monthly_income = Invoice.objects.filter(
            type=InvoiceType.VERKOOP,
            status__in=income_statuses,
            factuurdatum__gte=start_date,
            factuurdatum__lte=today,
        ).annotate(
            month=TruncMonth('factuurdatum')
        ).values('month').annotate(
            totaal=Sum('totaal')
        ).order_by('month')

        # Monthly inkoop expenses
        monthly_inkoop = Invoice.objects.filter(
            type=InvoiceType.INKOOP,
            status__in=income_statuses,
            factuurdatum__gte=start_date,
            factuurdatum__lte=today,
        ).annotate(
            month=TruncMonth('factuurdatum')
        ).values('month').annotate(
            totaal=Sum('totaal')
        ).order_by('month')

        # Monthly credit expenses
        monthly_credit = Invoice.objects.filter(
            type=InvoiceType.CREDIT,
            status__in=income_statuses,
            factuurdatum__gte=start_date,
            factuurdatum__lte=today,
        ).annotate(
            month=TruncMonth('factuurdatum')
        ).values('month').annotate(
            totaal=Sum('totaal')
        ).order_by('month')

        # Monthly direct expenses
        monthly_direct = Expense.objects.filter(
            datum__gte=start_date,
            datum__lte=today,
        ).annotate(
            month=TruncMonth('datum')
        ).values('month').annotate(
            totaal=Sum('totaal')
        ).order_by('month')

        # Build dicts
        income_dict = {item['month']: float(item['totaal'] or 0) for item in monthly_income}
        inkoop_dict = {item['month']: float(item['totaal'] or 0) for item in monthly_inkoop}
        credit_dict = {item['month']: float(item['totaal'] or 0) for item in monthly_credit}
        direct_dict = {item['month']: float(item['totaal'] or 0) for item in monthly_direct}

        all_months = sorted(set(
            list(income_dict.keys()) +
            list(inkoop_dict.keys()) +
            list(credit_dict.keys()) +
            list(direct_dict.keys())
        ))

        empty_forecast = {
            'lookback_months': months_back,
            'data_months': 0,
            'avg_monthly_income': 0,
            'avg_monthly_expenses': 0,
            'avg_monthly_profit': 0,
            'trend': 'stable',
            'forecast': {
                'month': {'income': 0, 'expenses': 0, 'profit': 0},
                'quarter': {'income': 0, 'expenses': 0, 'profit': 0},
                'half_year': {'income': 0, 'expenses': 0, 'profit': 0},
                'year': {'income': 0, 'expenses': 0, 'profit': 0},
            },
            'monthly_trend': [],
        }

        if not all_months:
            return Response(empty_forecast)

        monthly_data = []
        for month in all_months:
            income = income_dict.get(month, 0)
            credit = credit_dict.get(month, 0)
            net_income = income - credit
            expenses = (inkoop_dict.get(month, 0) +
                        direct_dict.get(month, 0))
            monthly_data.append({
                'month': month,
                'income': net_income,
                'expenses': expenses,
                'profit': net_income - expenses,
            })

        n = len(monthly_data)
        avg_income = sum(d['income'] for d in monthly_data) / n
        avg_expenses = sum(d['expenses'] for d in monthly_data) / n
        avg_profit = avg_income - avg_expenses

        # Weighted average (recent months count more)
        if n >= 3:
            weights = list(range(1, n + 1))
            total_weight = sum(weights)
            w_income = sum(d['income'] * w for d, w in zip(monthly_data, weights)) / total_weight
            w_expenses = sum(d['expenses'] * w for d, w in zip(monthly_data, weights)) / total_weight
            w_profit = w_income - w_expenses
        else:
            w_income = avg_income
            w_expenses = avg_expenses
            w_profit = avg_profit

        # Determine trend direction
        if n >= 2:
            first_half = monthly_data[:n//2]
            second_half = monthly_data[n//2:]
            avg_first = sum(d['profit'] for d in first_half) / len(first_half)
            avg_second = sum(d['profit'] for d in second_half) / len(second_half)
            if avg_second > avg_first * 1.1:
                trend = 'up'
            elif avg_second < avg_first * 0.9:
                trend = 'down'
            else:
                trend = 'stable'
        else:
            trend = 'stable'

        forecast = {}
        multipliers = {'month': 1, 'quarter': 3, 'half_year': 6, 'year': 12}
        for period_key, mult in multipliers.items():
            forecast[period_key] = {
                'income': round(w_income * mult, 2),
                'expenses': round(w_expenses * mult, 2),
                'profit': round(w_profit * mult, 2),
            }

        monthly_trend = [
            {
                'month': d['month'].strftime('%B %Y'),
                'income': round(d['income'], 2),
                'expenses': round(d['expenses'], 2),
                'profit': round(d['profit'], 2),
            }
            for d in monthly_data
        ]

        return Response({
            'lookback_months': months_back,
            'data_months': n,
            'avg_monthly_income': round(avg_income, 2),
            'avg_monthly_expenses': round(avg_expenses, 2),
            'avg_monthly_profit': round(avg_profit, 2),
            'trend': trend,
            'forecast': forecast,
            'monthly_trend': monthly_trend,
        })


class RevenueYearsView(APIView):
    """
    Get available years for revenue data.
    """
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    
    def get(self, request):
        # Get years from invoices
        invoice_years = Invoice.objects.values_list(
            'factuurdatum__year', flat=True
        ).distinct()
        
        # Get years from expenses
        expense_years = Expense.objects.values_list(
            'datum__year', flat=True
        ).distinct()
        
        # Combine and sort
        all_years = sorted(set(list(invoice_years) + list(expense_years)), reverse=True)
        
        # If no data, include current year
        if not all_years:
            all_years = [date.today().year]
        
        return Response({'years': all_years})

"""
Email Import Views

API endpoints for managing email invoice imports.
"""
import logging
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.pagination import PageNumberPagination
from django.db.models import Q
from django.utils import timezone
from apps.core.permissions import IsAdminOnly, IsAdminOrManager

from .models import MailboxConfig, EmailImport, EmailAttachment
from .serializers import (
    MailboxConfigSerializer, MailboxConfigDetailSerializer,
    EmailImportSerializer, EmailImportDetailSerializer, EmailImportReviewSerializer,
    EmailAttachmentSerializer, TestConnectionSerializer, FetchEmailsSerializer,
    BulkDeleteSerializer
)
from .services import EmailImportService
from apps.core.throttling import EmailImportRateThrottle

logger = logging.getLogger(__name__)


class EmailImportPagination(PageNumberPagination):
    """Pagination for email imports."""
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class MailboxConfigViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing mailbox configurations.
    
    Only admins can create/edit configurations.
    Staff can view and trigger fetches.
    """
    pagination_class = EmailImportPagination
    
    def get_permissions(self):
        """Set permissions based on action."""
        if self.action in ['create', 'update', 'partial_update', 'destroy']:
            permission_classes = [permissions.IsAuthenticated, IsAdminOnly]
        elif self.action in ['test_connection', 'fetch_emails', 'list_folders']:
            permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]
        else:
            permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]
        return [permission() for permission in permission_classes]
    
    def get_queryset(self):
        """Return configs accessible to the user."""
        user = self.request.user
        
        # Admins see all
        if user.is_superuser or user.rol == 'admin':
            return MailboxConfig.objects.all()
        
        # Regular users see only active configs they created
        return MailboxConfig.objects.filter(
            Q(created_by=user) | Q(status=MailboxConfig.Status.ACTIVE)
        )
    
    def get_serializer_class(self):
        """Use detail serializer for retrieve/create/update."""
        if self.action in ['retrieve', 'create', 'update', 'partial_update']:
            return MailboxConfigDetailSerializer
        return MailboxConfigSerializer
    
    def perform_create(self, serializer):
        """Set created_by on create."""
        serializer.save(created_by=self.request.user)
    
    @action(detail=True, methods=['post'], throttle_classes=[EmailImportRateThrottle])
    def test_connection(self, request, pk=None):
        """Test the connection to the mailbox."""
        config = self.get_object()
        
        service = EmailImportService()
        success, message = service.test_connection(config)
        
        if success:
            return Response({
                'success': True,
                'message': message
            })
        else:
            return Response({
                'success': False,
                'message': message
            }, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['get'])
    def list_folders(self, request, pk=None):
        """List available folders in the mailbox."""
        config = self.get_object()
        
        service = EmailImportService()
        
        try:
            folders = service.list_folders(config)
            return Response({
                'success': True,
                'folders': folders
            })
        except Exception as e:
            return Response({
                'success': False,
                'message': str(e)
            }, status=status.HTTP_400_BAD_REQUEST)
    
    @action(detail=True, methods=['post'], throttle_classes=[EmailImportRateThrottle])
    def fetch_emails(self, request, pk=None):
        """Manually trigger email fetch for this mailbox."""
        config = self.get_object()
        
        serializer = FetchEmailsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        limit = serializer.validated_data.get('limit', 50)
        
        service = EmailImportService()
        
        try:
            stats = service.fetch_and_process_emails(
                config, 
                user=request.user,
                limit=limit
            )
            
            return Response({
                'success': True,
                'stats': stats
            })
        except Exception as e:
            logger.error(f"Email fetch failed: {e}")
            return Response({
                'success': False,
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    @action(detail=True, methods=['get'])
    def imports(self, request, pk=None):
        """Get email imports for this mailbox."""
        config = self.get_object()
        
        imports = EmailImport.objects.filter(mailbox_config=config)
        
        # Filter by status if provided
        status_filter = request.query_params.get('status')
        if status_filter:
            imports = imports.filter(status=status_filter)
        
        # Paginate
        page = self.paginate_queryset(imports)
        if page is not None:
            serializer = EmailImportSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        
        serializer = EmailImportSerializer(imports, many=True, context={'request': request})
        return Response(serializer.data)


class EmailImportViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing email imports.
    
    Provides list, retrieve, and review actions.
    Only admin and manager roles can access email imports.
    """
    pagination_class = EmailImportPagination
    permission_classes = [permissions.IsAuthenticated, IsAdminOrManager]
    http_method_names = ['get', 'post', 'head', 'options']  # No PUT/DELETE
    
    def get_queryset(self):
        """Return imports accessible to the user."""
        user = self.request.user
        queryset = EmailImport.objects.select_related(
            'mailbox_config', 'reviewed_by'
        ).prefetch_related('attachments')
        
        # Filter by status if provided
        status_filter = self.request.query_params.get('status')
        if status_filter:
            queryset = queryset.filter(status=status_filter)
        
        # Filter by mailbox if provided
        mailbox_id = self.request.query_params.get('mailbox')
        if mailbox_id:
            queryset = queryset.filter(mailbox_config_id=mailbox_id)
        
        # Date range filter
        date_from = self.request.query_params.get('date_from')
        if date_from:
            queryset = queryset.filter(email_date__gte=date_from)
        
        date_to = self.request.query_params.get('date_to')
        if date_to:
            queryset = queryset.filter(email_date__lte=date_to)
        
        # Admins see all
        if user.is_superuser or user.rol == 'admin':
            return queryset
        
        # Regular users see imports from their configs
        return queryset.filter(
            mailbox_config__created_by=user
        )
    
    def get_serializer_class(self):
        """Use detail serializer for retrieve."""
        if self.action == 'retrieve':
            return EmailImportDetailSerializer
        return EmailImportSerializer
    
    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        """Review (approve/reject) an email import."""
        email_import = self.get_object()
        
        # Only allow review if status is awaiting_review
        if email_import.status != EmailImport.Status.AWAITING_REVIEW:
            return Response({
                'error': 'Deze import kan niet gereviewd worden'
            }, status=status.HTTP_400_BAD_REQUEST)
        
        serializer = EmailImportReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        action = serializer.validated_data['action']
        notes = serializer.validated_data.get('notes', '')
        
        service = EmailImportService()
        
        if action == 'approve':
            service.approve_import(email_import, request.user, notes)
            return Response({
                'success': True,
                'message': 'Import goedgekeurd'
            })
        else:
            service.reject_import(email_import, request.user, notes)
            return Response({
                'success': True,
                'message': 'Import afgewezen'
            })
    
    @action(detail=False, methods=['get'])
    def pending_review(self, request):
        """Get all imports awaiting review with pagination."""
        queryset = self.get_queryset().filter(
            status=EmailImport.Status.AWAITING_REVIEW
        )
        
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = EmailImportSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)
        
        serializer = EmailImportSerializer(queryset, many=True, context={'request': request})
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'])
    def statistics(self, request):
        """Get import statistics."""
        queryset = self.get_queryset()
        
        # Get counts by status
        from django.db.models import Count
        
        stats = queryset.values('status').annotate(
            count=Count('id')
        )
        
        status_counts = {
            'pending': 0,
            'processing': 0,
            'awaiting_review': 0,
            'approved': 0,
            'rejected': 0,
            'completed': 0,
            'failed': 0
        }
        
        for item in stats:
            status_counts[item['status']] = item['count']
        
        # Total counts
        total = queryset.count()
        today = queryset.filter(
            created_at__date=timezone.now().date()
        ).count()
        
        return Response({
            'total': total,
            'today': today,
            'by_status': status_counts
        })
    
    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Delete multiple email imports at once."""
        serializer = BulkDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        ids = serializer.validated_data['ids']
        
        # Get imports that belong to user's accessible configs
        queryset = self.get_queryset().filter(id__in=ids)
        
        deleted_count = queryset.count()
        queryset.delete()
        
        return Response({
            'success': True,
            'deleted_count': deleted_count,
            'message': f'{deleted_count} imports verwijderd'
        })

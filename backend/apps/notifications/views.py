"""
Views for push notifications.
"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from apps.core.permissions import IsAdminOnly

from .models import (
    PushSettings, PushSubscription, PushNotification,
    NotificationGroup, NotificationSchedule, ScheduleFrequency, WeekDay,
    UserNotification
)
from .serializers import (
    PushSettingsSerializer,
    PushSubscriptionSerializer,
    PushSubscriptionCreateSerializer,
    SendPushNotificationSerializer,
    PushNotificationSerializer,
    GenerateVapidKeysSerializer,
    PublicVapidKeySerializer,
    NotificationGroupListSerializer,
    NotificationGroupDetailSerializer,
    NotificationGroupCreateSerializer,
    NotificationScheduleListSerializer,
    NotificationScheduleDetailSerializer,
    UserNotificationSerializer,
    NotificationInboxCountSerializer,
    SentNotificationListSerializer,
    SentNotificationDetailSerializer,
)
from .services import get_push_service, send_push_notification, send_to_group
from apps.accounts.models import User


class PushSettingsView(APIView):
    """
    API view for managing push notification settings.
    Admin only.
    """
    permission_classes = [IsAuthenticated, IsAdminOnly]
    
    def get(self, request):
        """Get current push settings."""
        settings = PushSettings.get_settings()
        serializer = PushSettingsSerializer(settings)
        return Response(serializer.data)
    
    def put(self, request):
        """Update push settings."""
        settings = PushSettings.get_settings()
        serializer = PushSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
    
    def patch(self, request):
        """Partial update push settings."""
        return self.put(request)


class GenerateVapidKeysView(APIView):
    """
    Generate new VAPID key pair.
    Admin only.
    """
    permission_classes = [IsAuthenticated, IsAdminOnly]
    
    def post(self, request):
        """Generate new VAPID keys."""
        try:
            # Generate keys using cryptography
            from cryptography.hazmat.primitives.asymmetric import ec
            from cryptography.hazmat.backends import default_backend
            from cryptography.hazmat.primitives import serialization
            import base64
            
            # Generate ECDSA key pair using P-256 curve (required for Web Push)
            private_key = ec.generate_private_key(ec.SECP256R1(), default_backend())
            public_key = private_key.public_key()
            
            # Get raw bytes for private key
            private_numbers = private_key.private_numbers()
            private_bytes = private_numbers.private_value.to_bytes(32, 'big')
            
            # Get uncompressed point format for public key
            public_bytes = public_key.public_bytes(
                encoding=serialization.Encoding.X962,
                format=serialization.PublicFormat.UncompressedPoint
            )
            
            # Base64url encode (without padding, as per Web Push spec)
            public_key_b64 = base64.urlsafe_b64encode(public_bytes).decode().rstrip('=')
            private_key_b64 = base64.urlsafe_b64encode(private_bytes).decode().rstrip('=')
            
            return Response({
                'public_key': public_key_b64,
                'private_key': private_key_b64,
            })
            
        except Exception as e:
            return Response(
                {'error': f'Failed to generate VAPID keys: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class PublicPushConfigView(APIView):
    """
    Get public push configuration (for frontend).
    Available to all authenticated users.
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        """Get public VAPID key and configuration."""
        settings = PushSettings.get_settings()
        
        if not settings.is_configured():
            return Response({
                'is_configured': False,
                'provider': settings.provider,
                'public_key': None,
                'notification_poll_interval': settings.notification_poll_interval,
            })
        
        response_data = {
            'is_configured': True,
            'provider': settings.provider,
            'notification_poll_interval': settings.notification_poll_interval,
        }
        
        if settings.provider == 'webpush':
            response_data['public_key'] = settings.vapid_public_key
        elif settings.provider == 'firebase':
            response_data['firebase_config'] = {
                'projectId': settings.firebase_project_id,
                'messagingSenderId': settings.firebase_sender_id,
            }
        
        return Response(response_data)


class PushSubscriptionViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing push subscriptions.
    Admin manages all subscriptions, users can only register (not unsubscribe).
    """
    permission_classes = [IsAuthenticated]
    
    def get_queryset(self):
        """Return subscriptions - all for admin, own for users."""
        if self.request.user.is_superuser or self.request.user.rol == 'admin':
            return PushSubscription.objects.all()
        return PushSubscription.objects.filter(user=self.request.user)
    
    def get_serializer_class(self):
        if self.action == 'create':
            return PushSubscriptionCreateSerializer
        return PushSubscriptionSerializer
    
    def create(self, request, *args, **kwargs):
        """Subscribe to push notifications."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        subscription = serializer.save()
        
        return Response(
            PushSubscriptionSerializer(subscription).data,
            status=status.HTTP_201_CREATED
        )
    
    def destroy(self, request, *args, **kwargs):
        """Only admins can delete subscriptions."""
        if not (request.user.is_superuser or request.user.rol == 'admin'):
            return Response(
                {'error': 'Alleen beheerders kunnen abonnementen verwijderen'},
                status=status.HTTP_403_FORBIDDEN
            )
        return super().destroy(request, *args, **kwargs)
    
    @action(detail=False, methods=['get'])
    def status(self, request):
        """Get subscription status for current user."""
        subscriptions = PushSubscription.objects.filter(user=request.user, is_active=True)
        settings = PushSettings.get_settings()
        
        return Response({
            'is_subscribed': subscriptions.exists(),
            'subscription_count': subscriptions.count(),
            'push_enabled': settings.is_configured(),
        })


class SendPushNotificationView(APIView):
    """
    Send push notifications.
    Admin only.
    """
    permission_classes = [IsAuthenticated, IsAdminOnly]
    
    def post(self, request):
        """Send a push notification."""
        serializer = SendPushNotificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        
        # Determine target
        user = None
        users = None
        group = None
        send_to_all = data.get('send_to_all', False)
        
        if data.get('user_id'):
            user = get_object_or_404(User, pk=data['user_id'])
        elif data.get('user_ids'):
            users = list(User.objects.filter(pk__in=data['user_ids']))
        elif data.get('group_id'):
            group = get_object_or_404(NotificationGroup, pk=data['group_id'])
        
        # Send notification
        if group:
            result = send_to_group(
                group=group,
                title=data['title'],
                body=data['body'],
                icon=data.get('icon'),
                url=data.get('url'),
                data=data.get('data'),
                sent_by=request.user,
            )
        else:
            result = send_push_notification(
                user=user,
                users=users,
                send_to_all=send_to_all,
                title=data['title'],
                body=data['body'],
                icon=data.get('icon'),
                url=data.get('url'),
                data=data.get('data'),
                sent_by=request.user,
            )
        
        return Response(result)


class PushNotificationLogViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for viewing push notification logs.
    Admin only.
    """
    queryset = PushNotification.objects.all()
    serializer_class = PushNotificationSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter by recipient
        recipient_id = self.request.query_params.get('recipient')
        if recipient_id:
            queryset = queryset.filter(recipient_id=recipient_id)
        
        # Filter by group
        group_id = self.request.query_params.get('group')
        if group_id:
            queryset = queryset.filter(group_id=group_id)
        
        return queryset


# ============ Notification Groups ============

class NotificationGroupViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing notification groups.
    Admin only.
    """
    queryset = NotificationGroup.objects.all()
    permission_classes = [IsAuthenticated, IsAdminOnly]
    pagination_class = None
    
    def get_serializer_class(self):
        if self.action == 'list':
            return NotificationGroupListSerializer
        elif self.action in ['create', 'update', 'partial_update']:
            return NotificationGroupCreateSerializer
        return NotificationGroupDetailSerializer
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter by company
        company_id = self.request.query_params.get('company')
        if company_id:
            queryset = queryset.filter(company_id=company_id)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def add_members(self, request, pk=None):
        """Add members to a group."""
        group = self.get_object()
        # Accept both 'member_ids' and 'user_ids' for flexibility
        member_ids = request.data.get('member_ids') or request.data.get('user_ids', [])
        
        if member_ids:
            members = User.objects.filter(id__in=member_ids)
            group.members.add(*members)
        
        return Response(NotificationGroupDetailSerializer(group).data)
    
    @action(detail=True, methods=['post'])
    def remove_members(self, request, pk=None):
        """Remove members from a group."""
        group = self.get_object()
        # Accept both 'member_ids' and 'user_ids' for flexibility
        member_ids = request.data.get('member_ids') or request.data.get('user_ids', [])
        
        if member_ids:
            members = User.objects.filter(id__in=member_ids)
            group.members.remove(*members)
        
        return Response(NotificationGroupDetailSerializer(group).data)
    
    @action(detail=True, methods=['post'])
    def send_notification(self, request, pk=None):
        """Send a notification to this group."""
        group = self.get_object()
        
        title = request.data.get('title')
        body = request.data.get('body')
        
        if not title or not body:
            return Response(
                {'error': 'Titel en bericht zijn verplicht'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        result = send_to_group(
            group=group,
            title=title,
            body=body,
            icon=request.data.get('icon'),
            url=request.data.get('url'),
            data=request.data.get('data'),
            sent_by=request.user,
        )
        
        return Response(result)


# ============ Notification Schedules ============

class NotificationScheduleViewSet(viewsets.ModelViewSet):
    """
    ViewSet for managing notification schedules.
    Admin only.
    """
    queryset = NotificationSchedule.objects.all()
    permission_classes = [IsAuthenticated, IsAdminOnly]
    pagination_class = None
    
    def get_serializer_class(self):
        if self.action == 'list':
            return NotificationScheduleListSerializer
        return NotificationScheduleDetailSerializer
    
    def get_queryset(self):
        queryset = super().get_queryset()
        
        # Filter by group
        group_id = self.request.query_params.get('group')
        if group_id:
            queryset = queryset.filter(group_id=group_id)
        
        # Filter by active status
        is_active = self.request.query_params.get('is_active')
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() == 'true')
        
        return queryset
    
    @action(detail=True, methods=['post'])
    def send_now(self, request, pk=None):
        """Manually trigger a scheduled notification now."""
        schedule = self.get_object()
        
        result = send_to_group(
            group=schedule.group,
            title=schedule.title,
            body=schedule.body,
            icon=schedule.icon,
            url=schedule.url,
            sent_by=request.user,
        )
        
        # Update last_sent_at
        from django.utils import timezone
        schedule.last_sent_at = timezone.now()
        schedule.save(update_fields=['last_sent_at'])
        
        return Response(result)
    
    @action(detail=False, methods=['get'])
    def choices(self, request):
        """Get frequency and weekday choices."""
        return Response({
            'frequencies': [
                {'value': choice[0], 'label': choice[1]}
                for choice in ScheduleFrequency.choices
            ],
            'weekdays': [
                {'value': choice[0], 'label': choice[1]}
                for choice in WeekDay.choices
            ],
        })


class AvailableUsersView(APIView):
    """
    Get list of users available for notification groups.
    Admin only.
    """
    permission_classes = [IsAuthenticated, IsAdminOnly]
    
    def get(self, request):
        """Get all active users."""
        users = User.objects.filter(is_active=True).order_by('voornaam', 'achternaam', 'email')
        
        return Response([
            {
                'id': str(user.id),
                'email': user.email,
                'full_name': user.full_name or user.email,
            }
            for user in users
        ])


# ============ User Notification Inbox ============

class NotificationInboxViewSet(viewsets.ReadOnlyModelViewSet):
    """
    ViewSet for user's notification inbox.
    Users can view and manage their own notifications.
    """
    serializer_class = UserNotificationSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    
    def get_queryset(self):
        """Return notifications for the current user."""
        return UserNotification.objects.filter(
            user=self.request.user
        ).select_related('notification').order_by('-created_at')
    
    @action(detail=False, methods=['get'])
    def count(self, request):
        """Get unread notification count."""
        queryset = self.get_queryset()
        return Response({
            'unread_count': queryset.filter(is_read=False).count(),
            'total_count': queryset.count(),
        })
    
    @action(detail=False, methods=['get'])
    def recent(self, request):
        """Get recent notifications (max 3 for dropdown)."""
        try:
            limit = min(max(1, int(request.query_params.get('limit', 3))), 50)
        except (ValueError, TypeError):
            limit = 3
        queryset = self.get_queryset()[:limit]
        serializer = self.get_serializer(queryset, many=True)
        
        total_count = self.get_queryset().count()
        unread_count = self.get_queryset().filter(is_read=False).count()
        
        return Response({
            'notifications': serializer.data,
            'unread_count': unread_count,
            'total_count': total_count,
            'has_more': total_count > limit,
        })
    
    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        """Mark a single notification as read."""
        notification = self.get_object()
        notification.mark_as_read()
        return Response(self.get_serializer(notification).data)
    
    @action(detail=False, methods=['post'])
    def mark_all_read(self, request):
        """Mark all notifications as read."""
        from django.utils import timezone
        count = self.get_queryset().filter(is_read=False).update(
            is_read=True,
            read_at=timezone.now()
        )
        return Response({
            'message': f'{count} notificaties als gelezen gemarkeerd',
            'count': count,
        })
    
    @action(detail=False, methods=['delete'])
    def clear_all(self, request):
        """Delete all notifications for the user."""
        count = self.get_queryset().delete()[0]
        return Response({
            'message': f'{count} notificaties verwijderd',
            'count': count,
        })
    
    @action(detail=False, methods=['delete'])
    def clear_read(self, request):
        """Delete only read notifications."""
        count = self.get_queryset().filter(is_read=True).delete()[0]
        return Response({
            'message': f'{count} gelezen notificaties verwijderd',
            'count': count,
        })


# ============ Admin: Sent Notifications History ============

class SentNotificationsViewSet(viewsets.ModelViewSet):
    """
    ViewSet for admins to view and manage sent notification history with read receipts.
    """
    queryset = PushNotification.objects.all().order_by('-sent_at')
    permission_classes = [IsAuthenticated, IsAdminOnly]
    pagination_class = None
    http_method_names = ['get', 'delete']  # Only allow GET and DELETE
    
    def get_serializer_class(self):
        if self.action == 'retrieve':
            return SentNotificationDetailSerializer
        return SentNotificationListSerializer
    
    def get_queryset(self):
        queryset = super().get_queryset().select_related(
            'sent_by', 'group', 'recipient'
        ).prefetch_related('user_notifications')
        
        # Filter by group
        group_id = self.request.query_params.get('group')
        if group_id:
            queryset = queryset.filter(group_id=group_id)
        
        # Filter by date range
        date_from = self.request.query_params.get('date_from')
        date_to = self.request.query_params.get('date_to')
        if date_from:
            queryset = queryset.filter(sent_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(sent_at__date__lte=date_to)
        
        return queryset
    
    def destroy(self, request, *args, **kwargs):
        """Delete a single sent notification and its user notifications."""
        instance = self.get_object()
        # Also delete related UserNotification records
        UserNotification.objects.filter(notification=instance).delete()
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
    
    @action(detail=False, methods=['post'])
    def bulk_delete(self, request):
        """Delete multiple sent notifications by IDs."""
        ids = request.data.get('ids', [])
        if not ids:
            return Response(
                {'detail': 'Geen notificaties geselecteerd'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate UUIDs
        import uuid
        valid_ids = []
        for id_str in ids:
            try:
                valid_ids.append(uuid.UUID(str(id_str)))
            except (ValueError, TypeError):
                pass
        
        if not valid_ids:
            return Response(
                {'detail': 'Geen geldige notificatie IDs'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Delete related UserNotification records first
        UserNotification.objects.filter(notification_id__in=valid_ids).delete()
        # Delete the notifications
        deleted_count, _ = PushNotification.objects.filter(id__in=valid_ids).delete()
        
        return Response({
            'deleted_count': deleted_count,
            'message': f'{deleted_count} notificatie(s) verwijderd'
        })
    
    @action(detail=False, methods=['post'])
    def clear_old(self, request):
        """Delete notifications older than specified days."""
        days = request.data.get('days', 30)
        try:
            days = int(days)
            if days < 1:
                raise ValueError()
        except (ValueError, TypeError):
            return Response(
                {'detail': 'Ongeldige waarde voor dagen'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        from django.utils import timezone
        from datetime import timedelta
        
        cutoff_date = timezone.now() - timedelta(days=days)
        old_notifications = PushNotification.objects.filter(sent_at__lt=cutoff_date)
        
        # Delete related UserNotification records first
        old_ids = list(old_notifications.values_list('id', flat=True))
        UserNotification.objects.filter(notification_id__in=old_ids).delete()
        
        deleted_count, _ = old_notifications.delete()
        
        return Response({
            'deleted_count': deleted_count,
            'message': f'{deleted_count} notificatie(s) ouder dan {days} dagen verwijderd'
        })
    
    @action(detail=True, methods=['get'])
    def read_receipts(self, request, pk=None):
        """Get detailed read receipts for a specific notification."""
        notification = self.get_object()
        user_notifications = UserNotification.objects.filter(
            notification=notification
        ).select_related('user').order_by('-read_at', 'user__email')
        
        return Response([
            {
                'user_id': str(un.user.id),
                'user_email': un.user.email,
                'user_full_name': un.user.full_name or un.user.email,
                'is_read': un.is_read,
                'read_at': un.read_at,
                'delivered_at': un.created_at,
            }
            for un in user_notifications
        ])

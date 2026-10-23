"""
Push notification service.
Handles sending notifications via Web Push (VAPID) or Firebase.
"""
import json
import logging
from typing import List, Optional, Dict, Any
from django.utils import timezone

from .models import PushSettings, PushSubscription, PushNotification, PushProvider

logger = logging.getLogger(__name__)

# De Microsoft-pushdienst (Edge op Windows) weigert berichten zonder TTL met een 400.
WEBPUSH_TTL = 86400


class PushNotificationService:
    """
    Service for sending push notifications.
    Supports both Web Push (VAPID) and Firebase Cloud Messaging.
    """
    
    def __init__(self):
        self.settings = PushSettings.get_settings()
    
    def is_configured(self) -> bool:
        """Check if push notifications are configured."""
        return self.settings.is_configured()
    
    def get_provider(self) -> str:
        """Get current provider."""
        return self.settings.provider
    
    def send_to_user(
        self,
        user,
        title: str,
        body: str,
        icon: Optional[str] = None,
        url: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        sent_by=None,
    ) -> Dict[str, int]:
        """
        Send push notification to a specific user.
        Returns dict with success_count and failure_count.
        """
        subscriptions = PushSubscription.objects.filter(
            user=user,
            is_active=True
        )
        
        return self._send_to_subscriptions(
            subscriptions=list(subscriptions),
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            recipient=user,
            sent_by=sent_by,
        )
    
    def send_to_users(
        self,
        users: List,
        title: str,
        body: str,
        icon: Optional[str] = None,
        url: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        sent_by=None,
    ) -> Dict[str, int]:
        """
        Send push notification to multiple users.
        """
        subscriptions = PushSubscription.objects.filter(
            user__in=users,
            is_active=True
        )
        
        return self._send_to_subscriptions(
            subscriptions=list(subscriptions),
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            send_to_all=False,
            sent_by=sent_by,
        )
    
    def send_to_all(
        self,
        title: str,
        body: str,
        icon: Optional[str] = None,
        url: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        sent_by=None,
    ) -> Dict[str, int]:
        """
        Send push notification to all subscribed users.
        """
        subscriptions = PushSubscription.objects.filter(is_active=True)
        
        return self._send_to_subscriptions(
            subscriptions=list(subscriptions),
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            send_to_all=True,
            sent_by=sent_by,
        )
    
    def send_to_group(
        self,
        group,
        title: str,
        body: str,
        icon: Optional[str] = None,
        url: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        sent_by=None,
    ) -> Dict[str, int]:
        """
        Send push notification to all members of a notification group.
        """
        # Get all active subscriptions for group members
        subscriptions = PushSubscription.objects.filter(
            user__in=group.members.all(),
            is_active=True
        )
        
        return self._send_to_subscriptions(
            subscriptions=list(subscriptions),
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            group=group,
            sent_by=sent_by,
        )
    
    def _send_to_subscriptions(
        self,
        subscriptions: List[PushSubscription],
        title: str,
        body: str,
        icon: Optional[str] = None,
        url: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
        recipient=None,
        send_to_all: bool = False,
        group=None,
        sent_by=None,
    ) -> Dict[str, int]:
        """
        Send notification to list of subscriptions.
        """
        if not self.is_configured():
            logger.warning("Push notifications not configured")
            return {'success_count': 0, 'failure_count': 0, 'error': 'not_configured'}
        
        success_count = 0
        failure_count = 0
        
        # Build notification payload
        payload = {
            'title': title,
            'body': body,
            'icon': icon or '/icons/icon-192x192.png',
            'badge': '/icons/badge-72x72.png',
            'data': {
                'url': url,
                **(data or {}),
            }
        }
        
        # Send based on provider
        if self.settings.provider == PushProvider.WEBPUSH:
            success_count, failure_count = self._send_webpush(subscriptions, payload)
        elif self.settings.provider == PushProvider.FIREBASE:
            success_count, failure_count = self._send_firebase(subscriptions, payload)
        
        # Log notification
        notification_log = PushNotification.objects.create(
            recipient=recipient,
            send_to_all=send_to_all,
            group=group,
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            sent_by=sent_by,
            success_count=success_count,
            failure_count=failure_count,
        )
        
        # Create UserNotification records for inbox
        self._create_user_notifications(notification_log, subscriptions, recipient, send_to_all, group)
        
        return {
            'success_count': success_count,
            'failure_count': failure_count,
            'notification_id': str(notification_log.id),
        }
    
    def _create_user_notifications(
        self,
        notification_log: PushNotification,
        subscriptions: List[PushSubscription],
        recipient=None,
        send_to_all: bool = False,
        group=None,
    ):
        """
        Create UserNotification records for all recipients.
        This enables the notification inbox and read receipts.
        """
        from .models import UserNotification
        
        # Collect unique users from subscriptions
        users_notified = set()
        
        if recipient:
            users_notified.add(recipient)
        elif send_to_all:
            # Get all users with active subscriptions
            users_notified.update(sub.user for sub in subscriptions)
        elif group:
            # Get all group members (even if they don't have subscriptions)
            users_notified.update(group.members.all())
        else:
            # From subscriptions
            users_notified.update(sub.user for sub in subscriptions)
        
        # Bulk create UserNotification records
        user_notifications = [
            UserNotification(
                notification=notification_log,
                user=user,
            )
            for user in users_notified
        ]
        
        if user_notifications:
            UserNotification.objects.bulk_create(
                user_notifications,
                ignore_conflicts=True  # Avoid duplicates
            )
    
    def _send_webpush(
        self,
        subscriptions: List[PushSubscription],
        payload: Dict[str, Any],
    ) -> tuple:
        """
        Send notifications via Web Push (VAPID).
        """
        try:
            from pywebpush import webpush, WebPushException
        except ImportError:
            logger.error("pywebpush not installed. Run: pip install pywebpush")
            return (0, len(subscriptions))
        
        vapid_private_key = self.settings.get_vapid_private_key()
        vapid_claims = {
            "sub": f"mailto:{self.settings.vapid_admin_email}"
        }
        
        success_count = 0
        failure_count = 0
        
        for subscription in subscriptions:
            try:
                subscription_info = {
                    "endpoint": subscription.endpoint,
                    "keys": {
                        "p256dh": subscription.p256dh_key,
                        "auth": subscription.auth_key,
                    }
                }
                
                webpush(
                    subscription_info=subscription_info,
                    data=json.dumps(payload),
                    vapid_private_key=vapid_private_key,
                    vapid_claims=vapid_claims,
                    ttl=WEBPUSH_TTL,
                )
                
                # Update last used timestamp
                subscription.last_used_at = timezone.now()
                subscription.save(update_fields=['last_used_at'])
                
                success_count += 1
                logger.debug(f"Push sent to {subscription.user.email}")
                
            except WebPushException as e:
                logger.error(f"WebPush error for {subscription.user.email}: {e}")
                failure_count += 1
                
                # Handle expired subscriptions
                if e.response and e.response.status_code in [404, 410]:
                    subscription.is_active = False
                    subscription.save(update_fields=['is_active'])
                    logger.info(f"Deactivated expired subscription for {subscription.user.email}")
                    
            except Exception as e:
                logger.error(f"Error sending push to {subscription.user.email}: {e}")
                failure_count += 1
        
        return (success_count, failure_count)
    
    def _send_firebase(
        self,
        subscriptions: List[PushSubscription],
        payload: Dict[str, Any],
    ) -> tuple:
        """
        Send notifications via Firebase Cloud Messaging.
        """
        try:
            import firebase_admin
            from firebase_admin import credentials, messaging
        except ImportError:
            logger.error("firebase-admin not installed. Run: pip install firebase-admin")
            return (0, len(subscriptions))
        
        # Initialize Firebase if not already done
        if not firebase_admin._apps:
            # For FCM, we'd need service account credentials
            # This is a simplified implementation
            logger.error("Firebase not initialized. Service account required.")
            return (0, len(subscriptions))
        
        success_count = 0
        failure_count = 0
        
        for subscription in subscriptions:
            try:
                message = messaging.Message(
                    notification=messaging.Notification(
                        title=payload['title'],
                        body=payload['body'],
                        image=payload.get('icon'),
                    ),
                    data={
                        'url': payload['data'].get('url', ''),
                    },
                    token=subscription.endpoint,  # FCM token stored in endpoint
                )
                
                messaging.send(message)
                
                subscription.last_used_at = timezone.now()
                subscription.save(update_fields=['last_used_at'])
                
                success_count += 1
                
            except Exception as e:
                logger.error(f"Firebase error for {subscription.user.email}: {e}")
                failure_count += 1
                
                # Handle invalid tokens
                if 'Requested entity was not found' in str(e):
                    subscription.is_active = False
                    subscription.save(update_fields=['is_active'])
        
        return (success_count, failure_count)


# Singleton instance
_push_service = None


def get_push_service() -> PushNotificationService:
    """Get or create push notification service instance."""
    global _push_service
    if _push_service is None:
        _push_service = PushNotificationService()
    return _push_service


def send_push_notification(
    user=None,
    users: List = None,
    send_to_all: bool = False,
    title: str = "",
    body: str = "",
    icon: str = None,
    url: str = None,
    data: Dict[str, Any] = None,
    sent_by=None,
) -> Dict[str, int]:
    """
    Convenience function to send push notifications.
    
    Args:
        user: Single user to send to
        users: List of users to send to
        send_to_all: Send to all subscribed users
        title: Notification title
        body: Notification body
        icon: Optional icon URL
        url: Optional click URL
        data: Optional extra data
        sent_by: User who triggered the notification
    
    Returns:
        Dict with success_count and failure_count
    """
    service = get_push_service()
    
    if send_to_all:
        return service.send_to_all(
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            sent_by=sent_by,
        )
    elif users:
        return service.send_to_users(
            users=users,
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            sent_by=sent_by,
        )
    elif user:
        return service.send_to_user(
            user=user,
            title=title,
            body=body,
            icon=icon,
            url=url,
            data=data,
            sent_by=sent_by,
        )
    else:
        return {'success_count': 0, 'failure_count': 0, 'error': 'no_target'}


def send_to_group(
    group,
    title: str = "",
    body: str = "",
    icon: str = None,
    url: str = None,
    data: Dict[str, Any] = None,
    sent_by=None,
) -> Dict[str, int]:
    """
    Convenience function to send push notifications to a group.
    
    Args:
        group: NotificationGroup to send to
        title: Notification title
        body: Notification body
        icon: Optional icon URL
        url: Optional click URL
        data: Optional extra data
        sent_by: User who triggered the notification
    
    Returns:
        Dict with success_count and failure_count
    """
    service = get_push_service()
    return service.send_to_group(
        group=group,
        title=title,
        body=body,
        icon=icon,
        url=url,
        data=data,
        sent_by=sent_by,
    )

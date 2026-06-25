"""Celery-taken voor herinneringen van de taken-module."""
import logging
from collections import defaultdict

from celery import shared_task
from django.utils import timezone
from datetime import timedelta

logger = logging.getLogger(__name__)


def _push_service():
    from apps.notifications.services import PushNotificationService
    service = PushNotificationService()
    return service if service.is_configured() else None


@shared_task
def send_daily_task_reminders():
    """
    Dagelijkse herinnering (standaard 09:00) naar gebruikers met openstaande taken.
    Draait elke minuut via beat; verstuurt alleen wanneer het ingestelde tijdstip
    en (optioneel) de ingestelde weekdag overeenkomt.
    """
    from .models import Task, TaskReminderSettings, TaskStatus

    settings_obj = TaskReminderSettings.get_settings()
    if not settings_obj.daily_reminder_enabled:
        return {'status': 'disabled'}

    now = timezone.localtime()
    if now.hour != settings_obj.daily_reminder_hour or now.minute != settings_obj.daily_reminder_minute:
        return {'status': 'not_due'}

    weekdays = settings_obj.daily_reminder_weekdays or []
    if weekdays and now.weekday() not in weekdays:
        return {'status': 'wrong_weekday'}

    service = _push_service()
    if service is None:
        return {'status': 'push_not_configured'}

    open_tasks = (
        Task.objects.filter(toegewezen_aan__is_active=True)
        .exclude(status=TaskStatus.AFGEROND)
        .select_related('toegewezen_aan')
    )

    per_user = defaultdict(list)
    for task in open_tasks:
        per_user[task.toegewezen_aan].append(task)

    sent = 0
    for user, tasks in per_user.items():
        nieuw = sum(1 for t in tasks if t.status == TaskStatus.NIEUW)
        body = f'Je hebt {len(tasks)} openstaande taak/taken'
        if nieuw:
            body += f' ({nieuw} nieuw)'
        try:
            service.send_to_user(
                user=user,
                title='Openstaande taken',
                body=body,
                url='/tasks',
                data={'type': 'task_daily_reminder'},
            )
            sent += 1
        except Exception as exc:
            logger.warning('Dagelijkse taakreminder mislukt voor %s: %s', user.email, exc)

    return {'status': 'sent', 'users_notified': sent}


@shared_task
def send_stale_task_reminders():
    """
    Herinnering voor taken die 'in behandeling' staan maar X dagen geen activiteit
    hebben gehad. Draait dagelijks.
    """
    from .models import Task, TaskReminderSettings, TaskStatus

    settings_obj = TaskReminderSettings.get_settings()
    if not settings_obj.stale_reminder_enabled:
        return {'status': 'disabled'}

    service = _push_service()
    if service is None:
        return {'status': 'push_not_configured'}

    threshold = timezone.now() - timedelta(days=settings_obj.stale_after_days)
    stale_tasks = (
        Task.objects.filter(
            status=TaskStatus.IN_BEHANDELING,
            last_activity_at__lt=threshold,
            toegewezen_aan__is_active=True,
        )
        .select_related('toegewezen_aan')
    )

    sent = 0
    for task in stale_tasks:
        # Niet vaker dan eens per dag herinneren
        if task.last_reminder_sent_at and task.last_reminder_sent_at > threshold:
            continue
        try:
            service.send_to_user(
                user=task.toegewezen_aan,
                title='Taak wacht op actie',
                body=f'"{task.titel}" staat al {settings_obj.stale_after_days} dagen in behandeling',
                url='/tasks',
                data={'type': 'task_stale_reminder', 'task_id': str(task.id)},
            )
            task.last_reminder_sent_at = timezone.now()
            task.save(update_fields=['last_reminder_sent_at'])
            sent += 1
        except Exception as exc:
            logger.warning('Stale taakreminder mislukt voor taak %s: %s', task.id, exc)

    return {'status': 'sent', 'tasks_reminded': sent}

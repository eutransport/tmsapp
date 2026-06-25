"""Views voor de taken-module."""
import logging
import os

from django.contrib.auth import get_user_model
from django.db import models
from django.http import FileResponse
from django.utils import timezone
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.response import Response

from .models import Task, TaskNote, TaskActivity, TaskReminderSettings, TaskStatus
from .serializers import (
    TaskSerializer,
    TaskListSerializer,
    TaskNoteSerializer,
    TaskReminderSettingsSerializer,
)

logger = logging.getLogger(__name__)
User = get_user_model()


def user_can_manage_tasks(user) -> bool:
    """Mag deze gebruiker taken aan anderen toewijzen en beheren?"""
    if not user or not user.is_authenticated:
        return False
    if getattr(user, 'is_admin', False):
        return True
    if hasattr(user, 'has_module_permission'):
        return user.has_module_permission('manage_tasks')
    return 'manage_tasks' in (getattr(user, 'module_permissions', None) or [])


class TaskViewSet(viewsets.ModelViewSet):
    """
    Takenlijst.

    Tabs (query param `tab`):
      - `mine` (default): taken die aan mij zijn toegewezen
      - `assigned_by_me`: taken die ik aan anderen heb toegewezen (alleen beheerders)
      - `all`: alle taken (alleen admins)
    """
    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_serializer_class(self):
        if self.action == 'list':
            return TaskListSerializer
        return TaskSerializer

    def get_queryset(self):
        user = self.request.user
        qs = Task.objects.select_related('aangemaakt_door', 'toegewezen_aan').prefetch_related('notes')

        can_manage = user_can_manage_tasks(user)

        # Voor detail-/wijzig-acties (retrieve, update, change_status, add_note, ...)
        # geldt geen tab-filter: je mag elke taak openen waar je bij hoort
        # (maker, toegewezene) of, als beheerder/admin, elke taak.
        if self.action != 'list':
            if getattr(user, 'is_admin', False):
                return qs
            return qs.filter(
                models.Q(toegewezen_aan=user) | models.Q(aangemaakt_door=user)
            ).distinct()

        tab = self.request.query_params.get('tab', 'mine')

        if tab == 'all' and getattr(user, 'is_admin', False):
            pass  # admins zien alles
        elif tab == 'assigned_by_me' and can_manage:
            qs = qs.filter(aangemaakt_door=user).exclude(toegewezen_aan=user)
        else:
            # 'mine' en fallback: altijd alleen eigen toegewezen taken
            qs = qs.filter(toegewezen_aan=user)

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(
                models.Q(titel__icontains=search) |
                models.Q(omschrijving__icontains=search)
            )

        return qs

    def perform_create(self, serializer):
        user = self.request.user
        assignee = serializer.validated_data.get('toegewezen_aan')

        # Gewone gebruikers mogen alleen aan zichzelf toewijzen.
        if not user_can_manage_tasks(user):
            assignee = user
        elif assignee is None:
            assignee = user

        task = serializer.save(
            aangemaakt_door=user,
            toegewezen_aan=assignee,
            status_changed_at=timezone.now(),
            last_activity_at=timezone.now(),
        )
        TaskActivity.objects.create(
            task=task, user=user,
            actie=f'Taak aangemaakt en toegewezen aan {assignee.full_name}',
        )

    def _can_touch(self, task, user) -> bool:
        """Maker, uitvoerder, beheerder of admin mogen de taak wijzigen."""
        return (
            task.aangemaakt_door_id == user.id
            or task.toegewezen_aan_id == user.id
            or user_can_manage_tasks(user)
        )

    def update(self, request, *args, **kwargs):
        task = self.get_object()
        if not self._can_touch(task, request.user):
            return Response({'error': 'Geen rechten voor deze taak'}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        task = self.get_object()
        if not (task.aangemaakt_door_id == request.user.id or user_can_manage_tasks(request.user)):
            return Response({'error': 'Alleen de maker of een beheerder mag verwijderen'}, status=status.HTTP_403_FORBIDDEN)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def change_status(self, request, pk=None):
        task = self.get_object()
        if not self._can_touch(task, request.user):
            return Response({'error': 'Geen rechten voor deze taak'}, status=status.HTTP_403_FORBIDDEN)

        new_status = request.data.get('status')
        if new_status not in TaskStatus.values:
            return Response({'error': 'Ongeldige status'}, status=status.HTTP_400_BAD_REQUEST)

        old_status = task.status
        if new_status == old_status:
            return Response(TaskSerializer(task).data)

        task.status = new_status
        task.status_changed_at = timezone.now()
        task.touch_activity()
        task.afgerond_op = timezone.now() if new_status == TaskStatus.AFGEROND else None
        task.save()

        TaskActivity.objects.create(
            task=task, user=request.user,
            actie=f'Status gewijzigd: {old_status} → {new_status}',
        )
        return Response(TaskSerializer(task).data)

    @action(detail=True, methods=['post'])
    def reassign(self, request, pk=None):
        task = self.get_object()
        if not self._can_touch(task, request.user):
            return Response({'error': 'Geen rechten voor deze taak'}, status=status.HTTP_403_FORBIDDEN)
        if not user_can_manage_tasks(request.user):
            return Response({'error': 'Alleen beheerders mogen taken (her)toewijzen'}, status=status.HTTP_403_FORBIDDEN)

        user_id = request.data.get('toegewezen_aan_id')
        try:
            new_user = User.objects.get(id=user_id, is_active=True)
        except (User.DoesNotExist, ValueError, TypeError):
            return Response({'error': 'Gebruiker niet gevonden'}, status=status.HTTP_400_BAD_REQUEST)

        old_user = task.toegewezen_aan
        task.toegewezen_aan = new_user
        task.touch_activity()
        task.last_reminder_sent_at = None
        task.save()

        TaskActivity.objects.create(
            task=task, user=request.user,
            actie=f'Opnieuw toegewezen: {old_user.full_name} → {new_user.full_name}',
        )

        # Stuur de nieuwe uitvoerder een melding (best effort)
        _notify_assignee(task, request.user)
        return Response(TaskSerializer(task).data)

    @action(detail=True, methods=['post'])
    def add_note(self, request, pk=None):
        task = self.get_object()
        if not self._can_touch(task, request.user):
            return Response({'error': 'Geen rechten voor deze taak'}, status=status.HTTP_403_FORBIDDEN)

        tekst = (request.data.get('tekst') or '').strip()
        if not tekst:
            return Response({'error': 'Notitie mag niet leeg zijn'}, status=status.HTTP_400_BAD_REQUEST)

        note = TaskNote.objects.create(task=task, auteur=request.user, tekst=tekst)
        task.touch_activity()
        task.save(update_fields=['last_activity_at'])
        return Response(TaskNoteSerializer(note).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def send_reminder(self, request, pk=None):
        """Stuur handmatig nu een herinnering naar de uitvoerder."""
        task = self.get_object()
        if not self._can_touch(task, request.user):
            return Response({'error': 'Geen rechten voor deze taak'}, status=status.HTTP_403_FORBIDDEN)

        sent = _notify_assignee(task, request.user, manual=True)
        task.last_reminder_sent_at = timezone.now()
        task.save(update_fields=['last_reminder_sent_at'])
        return Response({'sent': sent})

    @action(detail=True, methods=['get'])
    def download_bijlage(self, request, pk=None):
        """Download task attachment with task-level access checks."""
        task = self.get_object()
        if not self._can_touch(task, request.user):
            return Response({'error': 'Geen rechten voor deze taak'}, status=status.HTTP_403_FORBIDDEN)
        if not task.bijlage:
            return Response({'detail': 'Geen bijlage.'}, status=status.HTTP_404_NOT_FOUND)
        if not task.bijlage.storage.exists(task.bijlage.name):
            return Response({'detail': 'Bijlagebestand niet gevonden op de server.'}, status=status.HTTP_404_NOT_FOUND)

        return FileResponse(
            task.bijlage.open('rb'),
            as_attachment=True,
            filename=os.path.basename(task.bijlage.name),
        )

    @action(detail=False, methods=['get'])
    def active_count(self, request):
        """Aantal openstaande taken op naam van de huidige gebruiker (voor login-popup)."""
        count = Task.objects.filter(
            toegewezen_aan=request.user,
        ).exclude(status=TaskStatus.AFGEROND).count()
        nieuw = Task.objects.filter(
            toegewezen_aan=request.user, status=TaskStatus.NIEUW,
        ).count()
        return Response({'open': count, 'nieuw': nieuw})

    @action(detail=False, methods=['get', 'put'], url_path='reminder-settings')
    def reminder_settings(self, request):
        if not getattr(request.user, 'is_admin', False):
            return Response({'error': 'Alleen admins'}, status=status.HTTP_403_FORBIDDEN)

        obj = TaskReminderSettings.get_settings()
        if request.method == 'GET':
            return Response(TaskReminderSettingsSerializer(obj).data)

        serializer = TaskReminderSettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


def _notify_assignee(task, actor, manual: bool = False) -> bool:
    """Stuur een push-notificatie naar de uitvoerder van de taak. Best effort."""
    try:
        from apps.notifications.services import PushNotificationService
        service = PushNotificationService()
        if not service.is_configured():
            return False
        title = 'Herinnering: openstaande taak' if manual else 'Nieuwe taak toegewezen'
        result = service.send_to_user(
            user=task.toegewezen_aan,
            title=title,
            body=task.titel,
            url='/tasks',
            data={'task_id': str(task.id)},
            sent_by=actor,
        )
        return bool(result.get('success_count', 0))
    except Exception as exc:  # pragma: no cover - notificatie mag nooit de request breken
        logger.warning('Kon taak-notificatie niet versturen: %s', exc)
        return False

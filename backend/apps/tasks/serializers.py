"""Serializers voor de taken-module."""
import os
from rest_framework import serializers
from django.contrib.auth import get_user_model

from apps.core.access import accessible_administratie_ids
from apps.invoicing.models import Invoice
from .models import Task, TaskNote, TaskActivity, TaskReminderSettings, TaskStatus

User = get_user_model()


class TaskUserSerializer(serializers.ModelSerializer):
    """Compacte gebruikersweergave voor maker/uitvoerder."""
    full_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ['id', 'full_name', 'email']


class TaskNoteSerializer(serializers.ModelSerializer):
    auteur = TaskUserSerializer(read_only=True)

    class Meta:
        model = TaskNote
        fields = ['id', 'task', 'auteur', 'tekst', 'created_at']
        read_only_fields = ['id', 'auteur', 'created_at']


class TaskActivitySerializer(serializers.ModelSerializer):
    user = TaskUserSerializer(read_only=True)

    class Meta:
        model = TaskActivity
        fields = ['id', 'user', 'actie', 'created_at']
        read_only_fields = fields


class TaskInvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ['id', 'factuurnummer', 'status']


class TaskSerializer(serializers.ModelSerializer):
    aangemaakt_door = TaskUserSerializer(read_only=True)
    toegewezen_aan = TaskUserSerializer(read_only=True)
    toegewezen_aan_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True),
        source='toegewezen_aan',
        write_only=True,
        required=False,
    )
    factuur = TaskInvoiceSerializer(read_only=True)
    factuur_id = serializers.PrimaryKeyRelatedField(
        queryset=Invoice.objects.all(),
        source='factuur',
        write_only=True,
        required=False,
        allow_null=True,
    )
    bijlage_url = serializers.SerializerMethodField()
    bijlage_naam = serializers.SerializerMethodField()
    notes = TaskNoteSerializer(many=True, read_only=True)
    notes_count = serializers.IntegerField(source='notes.count', read_only=True)

    class Meta:
        model = Task
        fields = [
            'id', 'titel', 'omschrijving', 'status', 'prioriteit',
            'aangemaakt_door', 'toegewezen_aan', 'toegewezen_aan_id',
            'factuur', 'factuur_id',
            'bijlage', 'bijlage_url', 'bijlage_naam',
            'vervaldatum', 'status_changed_at', 'last_activity_at',
            'afgerond_op', 'notes', 'notes_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'aangemaakt_door', 'toegewezen_aan', 'status_changed_at',
            'last_activity_at', 'afgerond_op', 'created_at', 'updated_at',
        ]
        extra_kwargs = {
            'bijlage': {'required': False, 'allow_null': True},
        }

    def validate_factuur(self, value):
        """Only allow linking invoices the current user can access."""
        if value is None:
            return value

        request = self.context.get('request')
        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            raise serializers.ValidationError('Niet geautoriseerd.')

        if user.is_superuser or getattr(user, 'rol', None) == 'admin' or getattr(user, 'is_staff', False):
            return value

        allowed_admin_ids = accessible_administratie_ids(user)
        if allowed_admin_ids is None:
            return value
        if not value.administratie_id or value.administratie_id not in allowed_admin_ids:
            raise serializers.ValidationError('Je hebt geen toegang tot deze factuur.')
        return value

    def validate_bijlage(self, value):
        if not value:
            return value
        max_size = 10 * 1024 * 1024  # 10 MB
        if value.size > max_size:
            raise serializers.ValidationError('Bijlage is te groot (max 10MB).')

        allowed_types = {
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
        }
        content_type = getattr(value, 'content_type', None)
        if content_type and content_type not in allowed_types:
            raise serializers.ValidationError('Alleen PDF, JPG, PNG of WEBP zijn toegestaan.')
        return value

    def get_bijlage_url(self, obj):
        if obj.bijlage and obj.bijlage.storage.exists(obj.bijlage.name):
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.bijlage.url)
            return obj.bijlage.url
        return None

    def get_bijlage_naam(self, obj):
        if obj.bijlage and obj.bijlage.storage.exists(obj.bijlage.name):
            return os.path.basename(obj.bijlage.name)
        return None


class TaskListSerializer(serializers.ModelSerializer):
    """Lichtere serializer voor lijstweergave (zonder volledige notities)."""
    aangemaakt_door = TaskUserSerializer(read_only=True)
    toegewezen_aan = TaskUserSerializer(read_only=True)
    factuur = TaskInvoiceSerializer(read_only=True)
    notes_count = serializers.IntegerField(source='notes.count', read_only=True)

    class Meta:
        model = Task
        fields = [
            'id', 'titel', 'omschrijving', 'status', 'prioriteit',
            'aangemaakt_door', 'toegewezen_aan', 'factuur', 'vervaldatum',
            'last_activity_at', 'afgerond_op', 'notes_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = fields


class TaskReminderSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskReminderSettings
        fields = [
            'daily_reminder_enabled', 'daily_reminder_hour', 'daily_reminder_minute',
            'daily_reminder_weekdays', 'stale_reminder_enabled', 'stale_after_days',
            'updated_at',
        ]
        read_only_fields = ['updated_at']

    def validate_daily_reminder_hour(self, value):
        if not 0 <= value <= 23:
            raise serializers.ValidationError('Uur moet tussen 0 en 23 liggen.')
        return value

    def validate_daily_reminder_minute(self, value):
        if not 0 <= value <= 59:
            raise serializers.ValidationError('Minuut moet tussen 0 en 59 liggen.')
        return value

    def validate_daily_reminder_weekdays(self, value):
        if not isinstance(value, list) or any(d not in range(7) for d in value):
            raise serializers.ValidationError('Weekdagen moeten een lijst van 0-6 zijn.')
        return value

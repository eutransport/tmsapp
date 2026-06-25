"""Serializers voor de taken-module."""
from rest_framework import serializers
from django.contrib.auth import get_user_model

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


class TaskSerializer(serializers.ModelSerializer):
    aangemaakt_door = TaskUserSerializer(read_only=True)
    toegewezen_aan = TaskUserSerializer(read_only=True)
    toegewezen_aan_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True),
        source='toegewezen_aan',
        write_only=True,
        required=False,
    )
    notes = TaskNoteSerializer(many=True, read_only=True)
    notes_count = serializers.IntegerField(source='notes.count', read_only=True)

    class Meta:
        model = Task
        fields = [
            'id', 'titel', 'omschrijving', 'status', 'prioriteit',
            'aangemaakt_door', 'toegewezen_aan', 'toegewezen_aan_id',
            'vervaldatum', 'status_changed_at', 'last_activity_at',
            'afgerond_op', 'notes', 'notes_count',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'aangemaakt_door', 'toegewezen_aan', 'status_changed_at',
            'last_activity_at', 'afgerond_op', 'created_at', 'updated_at',
        ]


class TaskListSerializer(serializers.ModelSerializer):
    """Lichtere serializer voor lijstweergave (zonder volledige notities)."""
    aangemaakt_door = TaskUserSerializer(read_only=True)
    toegewezen_aan = TaskUserSerializer(read_only=True)
    notes_count = serializers.IntegerField(source='notes.count', read_only=True)

    class Meta:
        model = Task
        fields = [
            'id', 'titel', 'omschrijving', 'status', 'prioriteit',
            'aangemaakt_door', 'toegewezen_aan', 'vervaldatum',
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

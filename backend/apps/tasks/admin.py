"""Admin-registratie voor de taken-module."""
from django.contrib import admin

from .models import Task, TaskNote, TaskActivity, TaskReminderSettings


class TaskNoteInline(admin.TabularInline):
    model = TaskNote
    extra = 0
    readonly_fields = ['auteur', 'created_at']


class TaskActivityInline(admin.TabularInline):
    model = TaskActivity
    extra = 0
    readonly_fields = ['user', 'actie', 'created_at']


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['titel', 'status', 'prioriteit', 'aangemaakt_door', 'toegewezen_aan', 'vervaldatum', 'created_at']
    list_filter = ['status', 'prioriteit', 'created_at']
    search_fields = ['titel', 'omschrijving']
    readonly_fields = ['status_changed_at', 'last_activity_at', 'last_reminder_sent_at', 'afgerond_op', 'created_at', 'updated_at']
    inlines = [TaskNoteInline, TaskActivityInline]


@admin.register(TaskReminderSettings)
class TaskReminderSettingsAdmin(admin.ModelAdmin):
    list_display = ['daily_reminder_enabled', 'daily_reminder_hour', 'daily_reminder_minute', 'stale_reminder_enabled', 'stale_after_days']

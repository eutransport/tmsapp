from django.contrib import admin

from .models import (
    PakmiddelenAuditLog,
    PakmiddelenCheckResult,
    PakmiddelenConfig,
    PakmiddelenMailLog,
    PakmiddelenRitnummerSelection,
)


@admin.register(PakmiddelenConfig)
class PakmiddelenConfigAdmin(admin.ModelAdmin):
    list_display = ('imap_host', 'imap_username', 'enabled', 'schedule_time', 'last_run_at', 'last_run_status')
    readonly_fields = ('last_run_at', 'last_run_status', 'last_run_message', 'created_at', 'updated_at')


@admin.register(PakmiddelenRitnummerSelection)
class PakmiddelenRitnummerSelectionAdmin(admin.ModelAdmin):
    list_display = ('ritnummer', 'vehicle', 'actief', 'notitie')
    list_filter = ('actief',)
    search_fields = ('ritnummer', 'notitie')


@admin.register(PakmiddelenCheckResult)
class PakmiddelenCheckResultAdmin(admin.ModelAdmin):
    list_display = ('check_date', 'ritnummer', 'has_bon', 'matched_subject', 'notification_sent')
    list_filter = ('has_bon', 'check_date', 'notification_sent')
    search_fields = ('ritnummer', 'matched_subject')
    date_hierarchy = 'check_date'


@admin.register(PakmiddelenAuditLog)
class PakmiddelenAuditLogAdmin(admin.ModelAdmin):
    list_display = ('created_at', 'action', 'user', 'ip_address')
    list_filter = ('action',)
    readonly_fields = ('created_at',)
    search_fields = ('action', 'user__email')


@admin.register(PakmiddelenMailLog)
class PakmiddelenMailLogAdmin(admin.ModelAdmin):
    list_display = ('sent_at', 'mail_type', 'subject', 'success', 'user')
    list_filter = ('mail_type', 'success', 'sent_at')
    search_fields = ('subject', 'message', 'user__email')
    readonly_fields = ('sent_at',)
    date_hierarchy = 'sent_at'

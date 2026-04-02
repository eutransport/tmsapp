"""Admin configuration for leave app."""
from django.contrib import admin
from .models import GlobalLeaveSettings, LeaveBalance, LeaveRequest, PublicHoliday


@admin.register(GlobalLeaveSettings)
class GlobalLeaveSettingsAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'default_leave_hours', 'standard_work_week_hours', 'overtime_leave_percentage']


@admin.register(LeaveBalance)
class LeaveBalanceAdmin(admin.ModelAdmin):
    list_display = ['user', 'vacation_hours', 'overtime_hours', 'updated_at']
    search_fields = ['user__voornaam', 'user__achternaam', 'user__email']
    readonly_fields = ['overtime_hours']


@admin.register(LeaveRequest)
class LeaveRequestAdmin(admin.ModelAdmin):
    list_display = ['user', 'leave_type', 'start_date', 'end_date', 'hours_requested', 'status', 'created_at']
    list_filter = ['status', 'leave_type']
    search_fields = ['user__voornaam', 'user__achternaam', 'user__email']
    date_hierarchy = 'start_date'


@admin.register(PublicHoliday)
class PublicHolidayAdmin(admin.ModelAdmin):
    list_display = ['name', 'date', 'year']
    list_filter = ['year']
    ordering = ['date']

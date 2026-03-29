"""Admin configuration for reports app."""
from django.contrib import admin
from .models import ReportRequest


@admin.register(ReportRequest)
class ReportRequestAdmin(admin.ModelAdmin):
    list_display = ['title', 'report_type', 'status', 'requested_by', 'created_at', 'completed_at']
    list_filter = ['status', 'report_type', 'output_format']
    search_fields = ['title', 'requested_by__email']
    readonly_fields = ['id', 'status', 'result_data', 'excel_file', 'pdf_file', 'error_message', 'row_count', 'created_at', 'updated_at', 'completed_at']

from django.contrib import admin

from .models import TollingEvent, TollingImportBatch


@admin.register(TollingImportBatch)
class TollingImportBatchAdmin(admin.ModelAdmin):
    list_display = ('filename', 'uploaded_by', 'rows_total', 'rows_imported', 'rows_duplicate', 'created_at')
    readonly_fields = ('id', 'created_at')
    search_fields = ('filename',)


@admin.register(TollingEvent)
class TollingEventAdmin(admin.ModelAdmin):
    list_display = ('license_plate_raw', 'start_at', 'end_at', 'distance_km', 'amount', 'invoiced_at')
    list_filter = ('invoiced_at',)
    search_fields = ('license_plate_raw', 'license_plate_normalized', 'obu')
    readonly_fields = ('id', 'created_at', 'license_plate_normalized')

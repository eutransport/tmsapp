from django.contrib import admin

from .models import Depot, LoadList, LoadStop


@admin.register(Depot)
class DepotAdmin(admin.ModelAdmin):
    list_display = ('name', 'address', 'is_default', 'is_active', 'created_by', 'created_at')
    list_filter = ('is_default', 'is_active')
    search_fields = ('name', 'address')
    readonly_fields = ('id', 'lat', 'lng', 'created_at', 'updated_at')


class LoadStopInline(admin.TabularInline):
    model = LoadStop
    extra = 0
    readonly_fields = ('id', 'original_sequence', 'delivery_sequence', 'load_sequence',
                       'lat', 'lng', 'geocode_confidence', 'geocode_error')


@admin.register(LoadList)
class LoadListAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'status', 'extraction_provider', 'created_at')
    list_filter = ('status',)
    search_fields = ('name', 'owner__email', 'start_address')
    readonly_fields = ('id', 'raw_ocr_text', 'extraction_provider',
                       'total_distance_m', 'total_duration_s',
                       'created_at', 'updated_at')
    inlines = [LoadStopInline]


@admin.register(LoadStop)
class LoadStopAdmin(admin.ModelAdmin):
    list_display = ('loadlist', 'original_sequence', 'delivery_sequence',
                    'load_sequence', 'city', 'postcode')
    search_fields = ('address_raw', 'city', 'postcode', 'reference')

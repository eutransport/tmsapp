from django.contrib import admin

from .models import GeoAccessLog, GeoBlockSettings, GeoRule, IPRule


@admin.register(GeoBlockSettings)
class GeoBlockSettingsAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'default_action', 'updated_at']


@admin.register(GeoRule)
class GeoRuleAdmin(admin.ModelAdmin):
    list_display = ['country_code', 'role', 'action', 'priority', 'active']
    list_filter = ['action', 'active', 'role']
    search_fields = ['country_code', 'notes']


@admin.register(IPRule)
class IPRuleAdmin(admin.ModelAdmin):
    list_display = ['cidr', 'action', 'label', 'active']
    list_filter = ['action', 'active']
    search_fields = ['cidr', 'label']


@admin.register(GeoAccessLog)
class GeoAccessLogAdmin(admin.ModelAdmin):
    list_display = ['created_at', 'ip_address', 'country_code', 'role', 'decision', 'path']
    list_filter = ['decision', 'country_code']
    search_fields = ['ip_address', 'path']
    readonly_fields = [f.name for f in GeoAccessLog._meta.fields]

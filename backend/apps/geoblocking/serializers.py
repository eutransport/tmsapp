"""Serializers voor de geo-blocking beheer-API."""
import ipaddress

from rest_framework import serializers

from .models import (
    COUNTRY_ANY,
    GeoAccessLog,
    GeoBlockSettings,
    GeoRule,
    IPRule,
    ROLE_CHOICES,
)


class GeoBlockSettingsSerializer(serializers.ModelSerializer):
    updated_by_naam = serializers.SerializerMethodField()

    class Meta:
        model = GeoBlockSettings
        fields = [
            'enabled',
            'mode',
            'default_action',
            'block_unknown_country',
            'allow_superuser_bypass',
            'log_allowed',
            'log_retention_days',
            'updated_at',
            'updated_by_naam',
        ]
        read_only_fields = ['updated_at', 'updated_by_naam']

    def get_updated_by_naam(self, obj):
        if not obj.updated_by:
            return ''
        return obj.updated_by.get_full_name() or obj.updated_by.username


class GeoRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = GeoRule
        fields = [
            'id',
            'country_code',
            'role',
            'action',
            'priority',
            'active',
            'notes',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate_country_code(self, value):
        code = (value or '').strip().upper()
        if code == COUNTRY_ANY:
            return code
        if len(code) != 2 or not code.isalpha():
            raise serializers.ValidationError(
                'Gebruik een ISO-landcode van twee letters (bijvoorbeeld NL) of * voor alle landen.'
            )
        return code

    def validate_role(self, value):
        geldig = {key for key, _ in ROLE_CHOICES}
        if value not in geldig:
            raise serializers.ValidationError(f'Onbekende rol. Kies uit: {", ".join(sorted(geldig))}.')
        return value


class IPRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = IPRule
        fields = ['id', 'cidr', 'action', 'label', 'active', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate_cidr(self, value):
        text = (value or '').strip()
        try:
            network = ipaddress.ip_network(text, strict=False)
        except ValueError:
            raise serializers.ValidationError(
                'Ongeldig IP-adres of bereik. Bijvoorbeeld 203.0.113.5 of 203.0.113.0/24.'
            )
        return str(network)


class GeoAccessLogSerializer(serializers.ModelSerializer):
    gebruiker = serializers.SerializerMethodField()

    class Meta:
        model = GeoAccessLog
        fields = [
            'id',
            'created_at',
            'ip_address',
            'country_code',
            'role',
            'gebruiker',
            'path',
            'method',
            'decision',
            'reason',
        ]

    def get_gebruiker(self, obj):
        if not obj.user:
            return ''
        return obj.user.get_full_name() or obj.user.username

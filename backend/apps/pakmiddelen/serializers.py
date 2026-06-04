from rest_framework import serializers

from apps.fleet.models import Vehicle

from .models import (
    PakmiddelenCheckResult,
    PakmiddelenConfig,
    PakmiddelenMailLog,
    PakmiddelenRitnummerSelection,
)


class PakmiddelenConfigSerializer(serializers.ModelSerializer):
    imap_password = serializers.CharField(write_only=True, required=False, allow_blank=True, style={'input_type': 'password'})
    imap_password_set = serializers.SerializerMethodField()
    graph_client_secret = serializers.CharField(write_only=True, required=False, allow_blank=True, style={'input_type': 'password'})
    graph_client_secret_set = serializers.SerializerMethodField()
    graph_client_secret_days_left = serializers.SerializerMethodField()
    notification_recipients = serializers.ListField(
        child=serializers.EmailField(),
        required=False,
        allow_empty=True,
    )
    subject_templates_extra = serializers.ListField(
        child=serializers.CharField(max_length=500, allow_blank=False),
        required=False,
        allow_empty=True,
    )
    schedule_weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = PakmiddelenConfig
        fields = [
            'id',
            'provider',
            'imap_host', 'imap_port', 'imap_use_ssl',
            'imap_username', 'imap_password', 'imap_password_set',
            'imap_folder',
            'graph_tenant_id', 'graph_client_id',
            'graph_client_secret', 'graph_client_secret_set',
            'graph_client_secret_expires_at', 'graph_client_secret_days_left',
            'graph_mailbox', 'graph_folder',
            'subject_template',
            'subject_templates_extra',
            'mark_as_read',
            'enabled', 'schedule_time', 'schedule_weekdays',
            'period_days', 'period_from_date',
            'notification_recipients', 'notification_email_profile',
            'last_run_at', 'last_run_status', 'last_run_message',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'last_run_at', 'last_run_status', 'last_run_message',
                            'created_at', 'updated_at',
                            'imap_password_set', 'graph_client_secret_set',
                            'graph_client_secret_days_left']

    def get_imap_password_set(self, obj) -> bool:
        return bool(obj.imap_password)

    def get_graph_client_secret_set(self, obj) -> bool:
        return bool(obj.graph_client_secret)

    def get_graph_client_secret_days_left(self, obj):
        if not obj.graph_client_secret_expires_at:
            return None
        from django.utils import timezone as _tz
        return (obj.graph_client_secret_expires_at - _tz.localdate()).days

    def validate_imap_host(self, value: str) -> str:
        v = (value or '').strip()
        if v and any(c in v for c in ['\r', '\n', ' ']):
            raise serializers.ValidationError('Ongeldige host.')
        return v

    def validate_imap_folder(self, value: str) -> str:
        v = (value or 'INBOX').strip()
        if any(c in v for c in ['\r', '\n', '\x00']):
            raise serializers.ValidationError('Ongeldige mapnaam.')
        return v

    def validate_graph_folder(self, value: str) -> str:
        v = (value or 'Inbox').strip()
        if any(c in v for c in ['\r', '\n', '\x00']):
            raise serializers.ValidationError('Ongeldige mapnaam.')
        return v

    def validate_subject_template(self, value: str) -> str:
        if '{ritnummer}' not in (value or ''):
            raise serializers.ValidationError("Onderwerp template moet '{ritnummer}' bevatten.")
        return value

    def validate_subject_templates_extra(self, value):
        cleaned = []
        seen = set()
        for raw in value or []:
            t = (raw or '').strip()
            if not t:
                continue
            if '{ritnummer}' not in t:
                raise serializers.ValidationError(
                    "Elk extra onderwerp moet '{ritnummer}' bevatten."
                )
            if t in seen:
                continue
            seen.add(t)
            cleaned.append(t)
        return cleaned

    def update(self, instance, validated_data):
        # Don't overwrite stored secrets with blank string.
        password = validated_data.pop('imap_password', None)
        if password:
            instance.imap_password = password
        new_secret = validated_data.pop('graph_client_secret', None)
        new_expiry = validated_data.get('graph_client_secret_expires_at', None)
        # Reset reminder log when the secret OR its expiry date changes.
        expiry_changed = (
            'graph_client_secret_expires_at' in validated_data
            and new_expiry != instance.graph_client_secret_expires_at
        )
        if new_secret:
            instance.graph_client_secret = new_secret
            instance.graph_secret_reminders_sent = []
        elif expiry_changed:
            instance.graph_secret_reminders_sent = []
        for k, v in validated_data.items():
            setattr(instance, k, v)
        request = self.context.get('request') if self.context else None
        if request and request.user.is_authenticated:
            instance.updated_by = request.user
        instance.save()
        return instance


class VehicleRitnummerSerializer(serializers.ModelSerializer):
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True)

    class Meta:
        model = Vehicle
        fields = ['id', 'kenteken', 'ritnummer', 'type_wagen', 'bedrijf_naam', 'actief']


class PakmiddelenRitnummerSelectionSerializer(serializers.ModelSerializer):
    vehicle_kenteken = serializers.CharField(source='vehicle.kenteken', read_only=True)

    class Meta:
        model = PakmiddelenRitnummerSelection
        fields = ['id', 'ritnummer', 'vehicle', 'vehicle_kenteken',
                  'actief', 'notitie', 'created_at', 'updated_at']
        read_only_fields = ['id', 'vehicle_kenteken', 'created_at', 'updated_at']

    def validate_ritnummer(self, value: str) -> str:
        v = (value or '').strip()
        if not v:
            raise serializers.ValidationError('Ritnummer mag niet leeg zijn.')
        return v


class PakmiddelenCheckResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = PakmiddelenCheckResult
        fields = ['id', 'check_date', 'ritnummer', 'has_bon',
                  'matched_subject', 'mail_message_id', 'mail_received_at',
                  'notification_sent', 'created_at', 'updated_at']
        read_only_fields = fields


class PakmiddelenMailLogSerializer(serializers.ModelSerializer):
    mail_type_display = serializers.CharField(source='get_mail_type_display', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True, default=None)

    class Meta:
        model = PakmiddelenMailLog
        fields = ['id', 'sent_at', 'mail_type', 'mail_type_display',
                  'recipients', 'subject', 'success', 'message',
                  'related_date', 'user', 'user_email']
        read_only_fields = fields

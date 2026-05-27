"""
Core app serializers.
"""
from rest_framework import serializers
from .models import AppSettings, CustomFont, ReminderJobLog, EmailProfile, Administratie
from .file_signing import sign_file_field


def safe_str(value):
    """Convert value to safe ASCII string (handle Unicode characters like Turkish İ)."""
    if value is None:
        return None
    s = str(value)
    replacements = {
        '\u0130': 'I', '\u0131': 'i', '\u015e': 'S', '\u015f': 's',
        '\u011e': 'G', '\u011f': 'g', '\u00c7': 'C', '\u00e7': 'c',
        '\u00d6': 'O', '\u00f6': 'o', '\u00dc': 'U', '\u00fc': 'u',
    }
    for char, replacement in replacements.items():
        s = s.replace(char, replacement)
    return s


class CustomFontSerializer(serializers.ModelSerializer):
    """Serializer for custom fonts."""
    font_url = serializers.SerializerMethodField()
    file_format = serializers.ReadOnlyField()
    css_format = serializers.ReadOnlyField()
    weight_display = serializers.CharField(source='get_weight_display', read_only=True)
    style_display = serializers.CharField(source='get_style_display', read_only=True)
    
    class Meta:
        model = CustomFont
        fields = [
            'id', 'family', 'name', 'font_file', 'font_url',
            'weight', 'weight_display', 'style', 'style_display',
            'file_format', 'css_format',
            'is_system', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'is_system', 'created_at', 'updated_at', 'file_format', 'css_format']
        extra_kwargs = {
            'font_file': {'write_only': True},
        }
    
    def get_font_url(self, obj):
        url = sign_file_field(obj.font_file)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url


class FontFamilySerializer(serializers.Serializer):
    """Serializer for font family with all variants."""
    family = serializers.CharField()
    fonts = CustomFontSerializer(many=True)
    
    @staticmethod
    def get_families_with_fonts():
        """Get all font families with their font variants."""
        fonts = CustomFont.objects.filter(is_active=True).order_by('family', 'weight', 'style')
        families = {}
        for font in fonts:
            if font.family not in families:
                families[font.family] = []
            families[font.family].append(font)
        
        return [
            {'family': family, 'fonts': font_list}
            for family, font_list in families.items()
        ]


class AppSettingsSerializer(serializers.ModelSerializer):
    """Serializer for public app settings (branding only)."""
    logo_url = serializers.SerializerMethodField()
    favicon_url = serializers.SerializerMethodField()
    
    class Meta:
        model = AppSettings
        fields = [
            'app_name',
            'logo_url',
            'favicon_url',
            'primary_color',
            'login_background_color',
            'company_name',
        ]
    
    def get_logo_url(self, obj):
        url = sign_file_field(obj.logo)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url
    
    def get_favicon_url(self, obj):
        url = sign_file_field(obj.favicon)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url


class AppSettingsAdminSerializer(serializers.ModelSerializer):
    """Full serializer for admin settings management."""
    logo_url = serializers.SerializerMethodField()
    favicon_url = serializers.SerializerMethodField()
    primary_font_data = CustomFontSerializer(source='primary_font', read_only=True)
    secondary_font_data = CustomFontSerializer(source='secondary_font', read_only=True)
    ai_status = serializers.SerializerMethodField()
    has_linqo_api_key = serializers.SerializerMethodField()
    
    class Meta:
        model = AppSettings
        fields = [
            'id', 'app_name', 'logo', 'logo_url', 'favicon', 'favicon_url', 'primary_color',
            'login_background_color',
            'company_name', 'company_address', 'company_phone', 'company_email',
            'company_kvk', 'company_btw', 'company_iban',
            'smtp_host', 'smtp_port', 'smtp_username', 'smtp_password',
            'smtp_use_tls', 'smtp_from_email',
            'oauth_enabled', 'oauth_client_id', 'oauth_client_secret', 'oauth_tenant_id',
            'invoice_payment_text', 'email_signature', 'email_signature_image',
            # Invoice numbering
            'invoice_start_number_verkoop', 'invoice_start_number_inkoop', 'invoice_start_number_credit',
            'primary_font', 'primary_font_data', 'secondary_font', 'secondary_font_data',
            # AI Settings
            'ai_provider', 'ai_github_token', 'ai_openai_api_key',
            'ai_azure_endpoint', 'ai_azure_api_key', 'ai_azure_deployment', 'ai_model',
            'ai_status',
            # Reminder Settings
            'reminder_enabled', 'reminder_time', 'reminder_frequency',
            'reminder_weekly_day', 'reminder_custom_days', 'reminder_weeks_before',
            'reminder_email', 'reminder_signature',
            # Linqo / Tachograaf
            'linqo_api_key',
            'has_linqo_api_key',
            'tachograaf_start_datum',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'ai_status', 'has_linqo_api_key']
        extra_kwargs = {
            'smtp_password': {'write_only': True},
            'oauth_client_secret': {'write_only': True},
            # AI keys should be write_only for security
            'ai_github_token': {'write_only': True},
            'ai_openai_api_key': {'write_only': True},
            'ai_azure_api_key': {'write_only': True},
            'linqo_api_key': {'write_only': True},
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        signed = sign_file_field(getattr(instance, 'email_signature_image', None))
        if signed and request:
            signed = request.build_absolute_uri(signed)
        data['email_signature_image'] = signed
        return data

    def get_has_linqo_api_key(self, obj):
        """Return whether a Linqo API key is configured."""
        return bool(obj.linqo_api_key)

    def get_ai_status(self, obj):
        """Check if AI is properly configured and working."""
        if obj.ai_provider == 'none':
            return {'configured': False, 'message': 'AI is uitgeschakeld'}
        
        has_key = False
        if obj.ai_provider == 'github' and obj.ai_github_token:
            has_key = True
        elif obj.ai_provider == 'openai' and obj.ai_openai_api_key:
            has_key = True
        elif obj.ai_provider == 'azure' and obj.ai_azure_api_key and obj.ai_azure_endpoint:
            has_key = True
        
        if has_key:
            return {'configured': True, 'provider': obj.ai_provider, 'message': f'AI geconfigureerd ({obj.get_ai_provider_display()})'}
        else:
            return {'configured': False, 'message': 'API key ontbreekt'}
    
    def get_logo_url(self, obj):
        url = sign_file_field(obj.logo)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url
    
    def get_favicon_url(self, obj):
        url = sign_file_field(obj.favicon)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url
    
    def validate(self, data):
        """Sanitize SMTP fields to remove Turkish/Unicode characters."""
        if 'smtp_username' in data and data['smtp_username']:
            data['smtp_username'] = safe_str(data['smtp_username'])
        if 'smtp_from_email' in data and data['smtp_from_email']:
            data['smtp_from_email'] = safe_str(data['smtp_from_email'])
        # Don't overwrite linqo_api_key with empty string
        if 'linqo_api_key' in data and not data['linqo_api_key']:
            del data['linqo_api_key']
        return data


class EmailTestSerializer(serializers.Serializer):
    """Serializer for testing email configuration."""
    to_email = serializers.EmailField()
    profile_id = serializers.UUIDField(required=False, allow_null=True)


class EmailProfileSerializer(serializers.ModelSerializer):
    """Serializer for EmailProfile – list and detail."""
    created_by_name = serializers.SerializerMethodField()
    allowed_users_info = serializers.SerializerMethodField()
    has_smtp_password = serializers.SerializerMethodField()
    has_oauth_secret = serializers.SerializerMethodField()

    class Meta:
        model = EmailProfile
        fields = [
            'id', 'name', 'description', 'is_default',
            'smtp_host', 'smtp_port', 'smtp_username', 'smtp_password',
            'smtp_use_tls', 'smtp_from_email',
            'oauth_enabled', 'oauth_client_id', 'oauth_client_secret', 'oauth_tenant_id',
            'email_signature', 'email_signature_image',
            'allowed_users', 'allowed_users_info',
            'has_smtp_password', 'has_oauth_secret',
            'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
        extra_kwargs = {
            'smtp_password': {'write_only': True, 'required': False, 'allow_blank': True},
            'oauth_client_secret': {'write_only': True, 'required': False, 'allow_blank': True},
        }

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        signed = sign_file_field(getattr(instance, 'email_signature_image', None))
        if signed and request:
            signed = request.build_absolute_uri(signed)
        data['email_signature_image'] = signed
        return data

    def get_created_by_name(self, obj) -> str:
        if obj.created_by:
            name = f"{getattr(obj.created_by, 'voornaam', '')} {getattr(obj.created_by, 'achternaam', '')}".strip()
            return name or obj.created_by.email
        return ''

    def get_allowed_users_info(self, obj) -> list:
        return [
            {
                'id': str(u.id),
                'name': f"{getattr(u, 'voornaam', '')} {getattr(u, 'achternaam', '')}".strip() or u.email,
                'email': u.email,
            }
            for u in obj.allowed_users.all()
        ]

    def get_has_smtp_password(self, obj) -> bool:
        return bool(obj.smtp_password)

    def get_has_oauth_secret(self, obj) -> bool:
        return bool(obj.oauth_client_secret)

    def validate(self, data):
        for field in ('smtp_username', 'smtp_from_email'):
            if data.get(field):
                data[field] = safe_str(data[field])
        return data

    def update(self, instance, validated_data):
        # Don't overwrite passwords when the client sends an empty string
        for pw_field in ('smtp_password', 'oauth_client_secret'):
            if pw_field in validated_data and not validated_data[pw_field]:
                validated_data.pop(pw_field)
        return super().update(instance, validated_data)


class ReminderJobLogSerializer(serializers.ModelSerializer):
    """Serializer for reminder job log entries."""
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = ReminderJobLog
        fields = [
            'id', 'started_at', 'finished_at', 'status', 'status_display',
            'reminders_sent', 'message',
        ]
        read_only_fields = fields


class AdministratieSerializer(serializers.ModelSerializer):
    """Serializer for Administratie – admin CRUD + user list view."""
    bedrijven_info = serializers.SerializerMethodField()
    allowed_users_info = serializers.SerializerMethodField()
    bedrijf_count = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Administratie
        fields = [
            'id', 'naam', 'beschrijving',
            'bedrijven', 'bedrijven_info',
            'allowed_users', 'allowed_users_info',
            'bedrijf_count', 'user_count',
            'created_by_name', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_bedrijven_info(self, obj) -> list:
        return [
            {'id': str(c.id), 'naam': c.naam}
            for c in obj.bedrijven.all()
        ]

    def get_allowed_users_info(self, obj) -> list:
        return [
            {
                'id': str(u.id),
                'name': f"{getattr(u, 'voornaam', '')} {getattr(u, 'achternaam', '')}".strip() or u.email,
                'email': u.email,
            }
            for u in obj.allowed_users.all()
        ]

    def get_bedrijf_count(self, obj) -> int:
        return obj.bedrijven.count()

    def get_user_count(self, obj) -> int:
        return obj.allowed_users.count()

    def get_created_by_name(self, obj) -> str:
        if obj.created_by:
            name = f"{getattr(obj.created_by, 'voornaam', '')} {getattr(obj.created_by, 'achternaam', '')}".strip()
            return name or obj.created_by.email
        return ''


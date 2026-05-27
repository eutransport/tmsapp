"""
Serializers voor documenten en handtekeningen.
"""
from rest_framework import serializers
from .models import SignedDocument, SavedSignature
from apps.core.file_signing import sign_file_field


class SavedSignatureSerializer(serializers.ModelSerializer):
    """Serializer voor opgeslagen handtekeningen."""
    
    class Meta:
        model = SavedSignature
        fields = [
            'id', 'name', 'signature_image', 'is_default', 
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        signed = sign_file_field(getattr(instance, 'signature_image', None))
        if signed and request:
            signed = request.build_absolute_uri(signed)
        data['signature_image'] = signed
        return data


class SignedDocumentListSerializer(serializers.ModelSerializer):
    """Serializer voor document lijst weergave."""
    uploaded_by_name = serializers.SerializerMethodField()
    signed_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = SignedDocument
        fields = [
            'id', 'title', 'description', 'original_filename',
            'status', 'status_display',
            'uploaded_by', 'uploaded_by_name',
            'signed_by', 'signed_by_name',
            'created_at', 'signed_at'
        ]
    
    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by:
            name = obj.uploaded_by.full_name.strip() if obj.uploaded_by.full_name else ''
            return name if name else obj.uploaded_by.email
        return None
    
    def get_signed_by_name(self, obj):
        if obj.signed_by:
            name = obj.signed_by.full_name.strip() if obj.signed_by.full_name else ''
            return name if name else obj.signed_by.email
        return None


class SignedDocumentDetailSerializer(serializers.ModelSerializer):
    """Serializer voor document detail weergave."""
    uploaded_by_name = serializers.SerializerMethodField()
    signed_by_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    original_file_url = serializers.SerializerMethodField()
    signed_file_url = serializers.SerializerMethodField()
    
    class Meta:
        model = SignedDocument
        fields = [
            'id', 'title', 'description', 
            'original_file', 'original_file_url', 'original_filename',
            'signed_file', 'signed_file_url',
            'signature_data',
            'status', 'status_display',
            'uploaded_by', 'uploaded_by_name',
            'signed_by', 'signed_by_name',
            'created_at', 'updated_at', 'signed_at'
        ]
        read_only_fields = [
            'id', 'signed_file', 'status', 
            'uploaded_by', 'signed_by', 'signed_at',
            'created_at', 'updated_at'
        ]
    
    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by:
            name = obj.uploaded_by.full_name.strip() if obj.uploaded_by.full_name else ''
            return name if name else obj.uploaded_by.email
        return None
    
    def get_signed_by_name(self, obj):
        if obj.signed_by:
            name = obj.signed_by.full_name.strip() if obj.signed_by.full_name else ''
            return name if name else obj.signed_by.email
        return None
    
    def get_original_file_url(self, obj):
        url = sign_file_field(obj.original_file)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url
    
    def get_signed_file_url(self, obj):
        url = sign_file_field(obj.signed_file)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url

    def to_representation(self, instance):
        # Replace the raw FileField URLs (original_file / signed_file) with
        # signed equivalents so the underlying /media/ path isn't leaked.
        data = super().to_representation(instance)
        request = self.context.get('request')
        for fname in ('original_file', 'signed_file'):
            ffield = getattr(instance, fname, None)
            signed = sign_file_field(ffield)
            if signed and request:
                signed = request.build_absolute_uri(signed)
            data[fname] = signed
        return data


class DocumentUploadSerializer(serializers.Serializer):
    """Serializer voor document upload."""
    file = serializers.FileField()
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, max_length=1000)
    
    def validate_title(self, value):
        """Sanitize title to prevent XSS."""
        import re
        # Remove potentially dangerous characters
        value = re.sub(r'[<>"\']', '', value)
        return value.strip()
    
    def validate_file(self, value):
        # Alleen PDF bestanden toestaan - check extension
        if not value.name.lower().endswith('.pdf'):
            raise serializers.ValidationError('Alleen PDF bestanden zijn toegestaan.')
        
        # Check MIME type (content type)
        if hasattr(value, 'content_type') and value.content_type != 'application/pdf':
            raise serializers.ValidationError('Alleen PDF bestanden zijn toegestaan.')
        
        # Check magic bytes (PDF signature)
        value.seek(0)
        header = value.read(8)
        value.seek(0)
        if not header.startswith(b'%PDF'):
            raise serializers.ValidationError('Ongeldig PDF bestand.')
        
        # Max 20MB
        max_size = 20 * 1024 * 1024
        if value.size > max_size:
            raise serializers.ValidationError('Bestand mag maximaal 20MB zijn.')
        
        return value


class SignDocumentSerializer(serializers.Serializer):
    """Serializer voor het ondertekenen van een document."""
    signature_image = serializers.CharField(
        help_text='Base64 encoded PNG afbeelding van de handtekening',
        max_length=500000,  # ~375KB base64 = ~280KB image, ruim voldoende voor handtekening
    )
    page = serializers.IntegerField(
        min_value=1,
        max_value=1000,  # Reasonable max page limit
        help_text='Paginanummer waar de handtekening moet komen (1-indexed)'
    )
    x = serializers.FloatField(
        min_value=0,
        max_value=100,
        help_text='X positie in percentage van pagina breedte (0-100)'
    )
    y = serializers.FloatField(
        min_value=0,
        max_value=100,
        help_text='Y positie in percentage van pagina hoogte (0-100)'
    )
    width = serializers.FloatField(
        min_value=1,
        max_value=100,
        default=20,
        help_text='Breedte van handtekening in percentage van pagina breedte'
    )
    save_signature = serializers.BooleanField(
        default=False,
        help_text='Sla deze handtekening op voor later gebruik'
    )
    signature_name = serializers.CharField(
        max_length=100,
        required=False,
        help_text='Naam voor opgeslagen handtekening'
    )
    
    def validate_signature_image(self, value):
        """Validate base64 signature image."""
        import re
        # Check if it's a valid base64 data URI or raw base64
        if value.startswith('data:'):
            # Validate data URI format
            if not re.match(r'^data:image/(png|jpeg|jpg);base64,', value):
                raise serializers.ValidationError('Ongeldig afbeeldingsformaat. Alleen PNG en JPEG zijn toegestaan.')
        return value
    
    def validate(self, data):
        if data.get('save_signature') and not data.get('signature_name'):
            raise serializers.ValidationError({
                'signature_name': 'Naam is verplicht als je de handtekening wilt opslaan.'
            })
        return data


class EmailDocumentSerializer(serializers.Serializer):
    """Serializer voor het e-mailen van een ondertekend document."""
    email = serializers.EmailField(
        help_text='E-mailadres van de ontvanger'
    )
    subject = serializers.CharField(
        max_length=255,
        required=False,
        help_text='Onderwerp van de e-mail (optioneel)'
    )
    message = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text='Bericht in de e-mail (optioneel)'
    )

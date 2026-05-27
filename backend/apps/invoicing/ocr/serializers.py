"""
Invoice OCR Serializers
"""
from rest_framework import serializers
from .models import InvoiceImport, InvoicePattern, FieldMapping, ImportedInvoiceLine


class ImportedInvoiceLineSerializer(serializers.ModelSerializer):
    """Serializer for imported invoice line items."""
    
    class Meta:
        model = ImportedInvoiceLine
        fields = [
            'id', 'omschrijving', 'aantal', 'eenheid',
            'prijs_per_eenheid', 'totaal', 'btw_percentage',
            'raw_text', 'position', 'volgorde', 'is_verified'
        ]
        read_only_fields = ['id', 'raw_text', 'position']


class InvoiceImportListSerializer(serializers.ModelSerializer):
    """Serializer for listing invoice imports."""
    
    uploaded_by_name = serializers.SerializerMethodField()
    pattern_name = serializers.SerializerMethodField()
    lines_count = serializers.SerializerMethodField()
    
    class Meta:
        model = InvoiceImport
        fields = [
            'id', 'file_name', 'file_type', 'file_size',
            'status', 'ocr_confidence', 'uploaded_by_name',
            'pattern_name', 'lines_count',
            'created_at', 'completed_at'
        ]
    
    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by:
            return obj.uploaded_by.full_name or obj.uploaded_by.username
        return None
    
    def get_pattern_name(self, obj):
        if obj.matched_pattern:
            return obj.matched_pattern.name
        return None
    
    def get_lines_count(self, obj):
        return obj.lines.count()


class InvoiceImportDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for invoice import with all data."""
    
    lines = ImportedInvoiceLineSerializer(many=True, read_only=True)
    uploaded_by_name = serializers.SerializerMethodField()
    pattern_name = serializers.SerializerMethodField()
    original_file_url = serializers.SerializerMethodField()
    
    class Meta:
        model = InvoiceImport
        fields = [
            'id', 'file_name', 'file_type', 'file_size',
            'original_file_url', 'status', 'error_message',
            'ocr_text', 'ocr_confidence', 'extracted_data',
            'user_corrections', 'uploaded_by_name', 'pattern_name',
            'lines', 'created_at', 'updated_at', 'completed_at'
        ]
    
    def get_uploaded_by_name(self, obj):
        if obj.uploaded_by:
            return obj.uploaded_by.full_name or obj.uploaded_by.username
        return None
    
    def get_pattern_name(self, obj):
        if obj.matched_pattern:
            return obj.matched_pattern.name
        return None
    
    def get_original_file_url(self, obj):
        from apps.core.file_signing import sign_file_field
        url = sign_file_field(obj.original_file)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url


class InvoiceImportUploadSerializer(serializers.Serializer):
    """Serializer for uploading invoice files."""
    
    file = serializers.FileField(required=True)
    
    def validate_file(self, value):
        """Validate the uploaded file."""
        # Check file size (max 20MB)
        max_size = 20 * 1024 * 1024
        if value.size > max_size:
            raise serializers.ValidationError(
                "Bestand is te groot. Maximum is 20MB."
            )
        
        # Check file type
        allowed_types = ['application/pdf', 'image/jpeg', 'image/png', 'image/tiff']
        content_type = value.content_type
        
        if content_type not in allowed_types:
            # Also check extension
            name = value.name.lower()
            if not any(name.endswith(ext) for ext in ['.pdf', '.jpg', '.jpeg', '.png', '.tiff']):
                raise serializers.ValidationError(
                    "Ongeldig bestandstype. Toegestaan: PDF, JPG, PNG, TIFF."
                )
        
        return value


class CorrectionsSerializer(serializers.Serializer):
    """Serializer for submitting corrections to extracted data."""
    
    corrections = serializers.DictField(required=True)
    create_pattern = serializers.BooleanField(default=False)
    pattern_name = serializers.CharField(max_length=100, required=False)
    pattern_keywords = serializers.ListField(
        child=serializers.CharField(),
        required=False
    )
    company_id = serializers.UUIDField(required=False)


class FieldMappingSerializer(serializers.ModelSerializer):
    """Serializer for field mappings."""
    
    field_type_display = serializers.CharField(
        source='get_field_type_display', 
        read_only=True
    )
    extraction_method_display = serializers.CharField(
        source='get_extraction_method_display',
        read_only=True
    )
    accuracy = serializers.FloatField(read_only=True)
    
    class Meta:
        model = FieldMapping
        fields = [
            'id', 'field_type', 'field_type_display',
            'extraction_method', 'extraction_method_display',
            'config', 'data_type', 'validation_rules',
            'correct_extractions', 'incorrect_extractions',
            'accuracy', 'priority', 'is_active'
        ]


class InvoicePatternSerializer(serializers.ModelSerializer):
    """Serializer for invoice patterns."""
    
    company_name = serializers.SerializerMethodField()
    field_mappings = FieldMappingSerializer(many=True, read_only=True)
    
    class Meta:
        model = InvoicePattern
        fields = [
            'id', 'name', 'description', 'company', 'company_name',
            'is_active', 'visual_signature', 'times_used',
            'times_corrected', 'accuracy_score', 'field_mappings',
            'created_at', 'last_used_at'
        ]
        read_only_fields = [
            'id', 'times_used', 'times_corrected', 'accuracy_score',
            'created_at', 'last_used_at'
        ]
    
    def get_company_name(self, obj):
        if obj.company:
            return obj.company.naam
        return None


class CreatePatternSerializer(serializers.Serializer):
    """Serializer for creating a pattern from an import."""
    
    name = serializers.CharField(max_length=100)
    company_id = serializers.UUIDField()
    keywords = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list
    )


class ExtractRegionSerializer(serializers.Serializer):
    """Serializer for extracting text from a region."""
    
    page = serializers.IntegerField(min_value=0, default=0)
    x = serializers.FloatField(min_value=0)
    y = serializers.FloatField(min_value=0)
    width = serializers.FloatField(min_value=1)
    height = serializers.FloatField(min_value=1)


class ConvertToInvoiceSerializer(serializers.Serializer):
    """Serializer for converting import to invoice."""
    
    invoice_type = serializers.ChoiceField(
        choices=['inkoop', 'verkoop', 'credit'],
        default='inkoop'
    )
    
    # Template selection (optional - null means no template)
    template_id = serializers.UUIDField(required=False, allow_null=True)
    
    # Company selection (optional - if not provided, auto-create from leverancier)
    bedrijf_id = serializers.UUIDField(required=False, allow_null=True)
    
    # Common fields
    factuurnummer = serializers.CharField(max_length=50, required=False, allow_blank=True, allow_null=True)
    factuurdatum = serializers.CharField(required=False, allow_blank=True, allow_null=True)  # Accept string to parse
    vervaldatum = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    omschrijving = serializers.CharField(max_length=500, required=False, allow_blank=True, allow_null=True)
    
    # Leverancier/Klant
    leverancier = serializers.CharField(max_length=200, required=False, allow_blank=True)
    leverancier_id = serializers.UUIDField(required=False, allow_null=True)
    
    # Amounts
    subtotaal = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )
    btw_percentage = serializers.DecimalField(
        max_digits=5, decimal_places=2, required=False, default=21
    )
    btw_bedrag = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True
    )
    totaal = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, default=0
    )
    
    # Line items
    line_items = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list
    )

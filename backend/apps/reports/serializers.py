"""Serializers for report requests."""
from rest_framework import serializers
from .models import ReportRequest, ReportType, ReportOutputFormat, ReportStatus


class ReportRequestSerializer(serializers.ModelSerializer):
    """Full serializer for report requests (read)."""
    report_type_display = serializers.CharField(source='get_report_type_display', read_only=True)
    output_format_display = serializers.CharField(source='get_output_format_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    requested_by_naam = serializers.SerializerMethodField()
    excel_url = serializers.SerializerMethodField()
    pdf_url = serializers.SerializerMethodField()

    class Meta:
        model = ReportRequest
        fields = [
            'id',
            'title',
            'report_type',
            'report_type_display',
            'parameters',
            'output_format',
            'output_format_display',
            'status',
            'status_display',
            'result_data',
            'excel_file',
            'excel_url',
            'pdf_file',
            'pdf_url',
            'error_message',
            'row_count',
            'requested_by',
            'requested_by_naam',
            'created_at',
            'updated_at',
            'completed_at',
        ]
        read_only_fields = [
            'id', 'status', 'result_data', 'excel_file', 'pdf_file',
            'error_message', 'row_count', 'requested_by', 'created_at',
            'updated_at', 'completed_at',
        ]

    def get_requested_by_naam(self, obj):
        user = obj.requested_by
        if hasattr(user, 'get_full_name'):
            return user.get_full_name()
        return str(user)

    def get_excel_url(self, obj):
        if obj.excel_file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.excel_file.url)
            return obj.excel_file.url
        return None

    def get_pdf_url(self, obj):
        if obj.pdf_file:
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.pdf_file.url)
            return obj.pdf_file.url
        return None


class ReportRequestCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating a new report request."""

    class Meta:
        model = ReportRequest
        fields = [
            'title',
            'report_type',
            'parameters',
            'output_format',
        ]

    def validate_report_type(self, value):
        valid = [choice[0] for choice in ReportType.choices]
        if value not in valid:
            raise serializers.ValidationError(f"Ongeldig rapport type. Kies uit: {valid}")
        return value

    def validate_output_format(self, value):
        valid = [choice[0] for choice in ReportOutputFormat.choices]
        if value not in valid:
            raise serializers.ValidationError(f"Ongeldig formaat. Kies uit: {valid}")
        return value


class ReportTypeChoiceSerializer(serializers.Serializer):
    """Serializer for listing available report types."""
    value = serializers.CharField()
    label = serializers.CharField()
    description = serializers.CharField()
    parameters = serializers.ListField(child=serializers.DictField())

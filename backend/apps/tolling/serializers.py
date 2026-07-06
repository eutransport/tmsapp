from rest_framework import serializers

from .models import TollingEvent, TollingImportBatch


class TollingEventSerializer(serializers.ModelSerializer):
    invoiced = serializers.SerializerMethodField()

    class Meta:
        model = TollingEvent
        fields = (
            'id', 'start_at', 'end_at', 'distance_km', 'amount',
            'license_plate_raw', 'license_plate_normalized', 'obu',
            'invoice_line', 'invoiced_at', 'invoiced', 'created_at',
        )
        read_only_fields = fields

    def get_invoiced(self, obj) -> bool:
        return obj.invoiced_at is not None


class TollingImportBatchSerializer(serializers.ModelSerializer):
    class Meta:
        model = TollingImportBatch
        fields = (
            'id', 'filename', 'rows_total', 'rows_imported',
            'rows_duplicate', 'rows_invalid', 'error_message', 'created_at',
        )
        read_only_fields = fields

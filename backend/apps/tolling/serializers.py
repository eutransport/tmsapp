from rest_framework import serializers

from .models import PrivateTollRegistration, TollingEvent, TollingImportBatch, normalize_plate


class TollingEventSerializer(serializers.ModelSerializer):
    invoiced = serializers.SerializerMethodField()

    class Meta:
        model = TollingEvent
        fields = (
            'id', 'start_at', 'end_at', 'distance_km', 'amount',
            'license_plate_raw', 'license_plate_normalized', 'obu',
            'invoice_line', 'invoiced_at', 'invoiced',
            'is_private', 'private_registration', 'created_at',
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


class PrivateTollRegistrationSerializer(serializers.ModelSerializer):
    matched_events_count = serializers.SerializerMethodField()
    matched_events_amount = serializers.SerializerMethodField()
    matched_events_km = serializers.SerializerMethodField()
    matched_events = serializers.SerializerMethodField()

    class Meta:
        model = PrivateTollRegistration
        fields = (
            'id', 'datum', 'begin_tijd', 'eind_tijd',
            'license_plate_raw', 'license_plate_normalized',
            'notitie',
            'matched_events_count', 'matched_events_amount', 'matched_events_km',
            'matched_events',
            'admin_invoiced', 'admin_invoiced_at',
            'created_at', 'updated_at',
        )
        read_only_fields = (
            'id', 'license_plate_normalized',
            'matched_events_count', 'matched_events_amount', 'matched_events_km',
            'matched_events',
            'admin_invoiced', 'admin_invoiced_at',
            'created_at', 'updated_at',
        )

    def get_matched_events_count(self, obj) -> int:
        return obj.matched_events.count()

    def get_matched_events_amount(self, obj) -> float:
        from decimal import Decimal
        total = sum((Decimal(e.amount or 0) for e in obj.matched_events.all()), Decimal('0'))
        return float(total)

    def get_matched_events_km(self, obj) -> float:
        from decimal import Decimal
        total = sum((Decimal(e.distance_km or 0) for e in obj.matched_events.all()), Decimal('0'))
        return float(total)

    def get_matched_events(self, obj):
        return [
            {
                'id': str(e.id),
                'start_at': e.start_at.isoformat() if e.start_at else None,
                'end_at': e.end_at.isoformat() if e.end_at else None,
                'distance_km': float(e.distance_km or 0),
                'amount': float(e.amount or 0),
            }
            for e in obj.matched_events.all().order_by('start_at')
        ]

    def validate(self, attrs):
        begin = attrs.get('begin_tijd') or getattr(self.instance, 'begin_tijd', None)
        eind = attrs.get('eind_tijd') or getattr(self.instance, 'eind_tijd', None)
        if begin and eind and eind <= begin:
            raise serializers.ValidationError({'eind_tijd': 'Eindtijd moet later zijn dan begintijd.'})
        plate = attrs.get('license_plate_raw')
        if plate:
            attrs['license_plate_normalized'] = normalize_plate(plate)
        return attrs

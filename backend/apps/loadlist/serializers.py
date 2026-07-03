from __future__ import annotations

from rest_framework import serializers

from .models import LoadList, LoadStop


class LoadStopSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoadStop
        fields = [
            'id', 'original_sequence', 'delivery_sequence', 'load_sequence',
            'address_raw', 'address_formatted',
            'postcode', 'city', 'country',
            'reference', 'colli', 'pallets', 'weight_kg', 'notes',
            'lat', 'lng', 'geocode_confidence', 'geocode_error',
        ]
        read_only_fields = [
            'id', 'delivery_sequence', 'load_sequence',
            'address_formatted', 'lat', 'lng',
            'geocode_confidence', 'geocode_error',
        ]


class LoadStopWriteSerializer(serializers.ModelSerializer):
    """Used when the client edits a stop; only user-controllable fields."""
    class Meta:
        model = LoadStop
        fields = [
            'address_raw', 'postcode', 'city', 'country',
            'reference', 'colli', 'pallets', 'weight_kg', 'notes',
        ]


class LoadListSerializer(serializers.ModelSerializer):
    stops = LoadStopSerializer(many=True, read_only=True)
    photo_url = serializers.SerializerMethodField()
    stop_count = serializers.IntegerField(source='stops.count', read_only=True)

    class Meta:
        model = LoadList
        fields = [
            'id', 'name', 'status', 'status_message',
            'start_address', 'start_lat', 'start_lng',
            'photo_url', 'extraction_provider',
            'total_distance_m', 'total_duration_s',
            'stop_count', 'stops',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'status', 'status_message',
            'start_lat', 'start_lng',
            'photo_url', 'extraction_provider',
            'total_distance_m', 'total_duration_s',
            'stop_count', 'stops',
            'created_at', 'updated_at',
        ]

    def get_photo_url(self, obj: LoadList) -> str | None:
        if not obj.photo:
            return None
        request = self.context.get('request')
        try:
            url = obj.photo.url
        except Exception:
            return None
        return request.build_absolute_uri(url) if request else url


class LoadListCreateSerializer(serializers.ModelSerializer):
    photo = serializers.ImageField(required=True, allow_empty_file=False)

    class Meta:
        model = LoadList
        fields = ['name', 'start_address', 'photo']

    def validate_photo(self, value):
        # DRF's ImageField already runs Pillow.verify(). Add a hard size cap
        # so we never accept multi-megabyte uploads.
        max_bytes = 10 * 1024 * 1024
        if value.size and value.size > max_bytes:
            raise serializers.ValidationError('Bestand is te groot (max 10 MB).')

        allowed = {'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'}
        ct = getattr(value, 'content_type', '') or ''
        if ct and ct.lower() not in allowed:
            raise serializers.ValidationError(f'Onondersteund bestandstype: {ct}')
        return value

    def validate_start_address(self, value: str) -> str:
        cleaned = (value or '').strip()
        if len(cleaned) > 250:
            raise serializers.ValidationError('Adres is te lang.')
        return cleaned

    def validate_name(self, value: str) -> str:
        return (value or '').strip()[:120]

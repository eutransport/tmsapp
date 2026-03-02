from rest_framework import serializers
from .models import Vehicle

class VehicleSerializer(serializers.ModelSerializer):
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True, allow_null=True)
    
    class Meta:
        model = Vehicle
        fields = [
            'id', 'kenteken', 'type_wagen', 'ritnummer',
            'bedrijf', 'bedrijf_naam', 'minimum_weken_per_jaar',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

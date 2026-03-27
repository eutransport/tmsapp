from rest_framework import serializers
from .models import Driver

class DriverSerializer(serializers.ModelSerializer):
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True, allow_null=True)
    gekoppelde_gebruiker_naam = serializers.SerializerMethodField()
    voertuig_ritnummer = serializers.CharField(source='voertuig.ritnummer', read_only=True, allow_null=True)
    voertuig_kenteken = serializers.CharField(source='voertuig.kenteken', read_only=True, allow_null=True)
    
    class Meta:
        model = Driver
        fields = [
            'id', 'naam', 'telefoon', 'bedrijf', 'bedrijf_naam',
            'gekoppelde_gebruiker', 'gekoppelde_gebruiker_naam',
            'voertuig', 'voertuig_ritnummer', 'voertuig_kenteken',
            'adr', 'minimum_uren_per_week', 'actief',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_gekoppelde_gebruiker_naam(self, obj):
        if obj.gekoppelde_gebruiker:
            return obj.gekoppelde_gebruiker.full_name or obj.gekoppelde_gebruiker.username
        return None

from rest_framework import serializers
from .models import Driver

class DriverSerializer(serializers.ModelSerializer):
    bedrijven_namen = serializers.SerializerMethodField()
    # Backward-compat: expose the first linked company as 'bedrijf' / 'bedrijf_naam'
    bedrijf = serializers.SerializerMethodField()
    bedrijf_naam = serializers.SerializerMethodField()
    gekoppelde_gebruiker_naam = serializers.SerializerMethodField()
    voertuig_ritnummer = serializers.CharField(source='voertuig.ritnummer', read_only=True, allow_null=True)
    voertuig_kenteken = serializers.CharField(source='voertuig.kenteken', read_only=True, allow_null=True)

    class Meta:
        model = Driver
        fields = [
            'id', 'naam', 'telefoon',
            'bedrijven', 'bedrijven_namen',
            'bedrijf', 'bedrijf_naam',
            'gekoppelde_gebruiker', 'gekoppelde_gebruiker_naam',
            'voertuig', 'voertuig_ritnummer', 'voertuig_kenteken',
            'adr',
            'einddatum_bestuurderspas', 'einddatum_code95',
            'einddatum_adr', 'einddatum_rijbewijs',
            'minimum_uren_per_week', 'actief',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'bedrijf', 'bedrijf_naam', 'bedrijven_namen']

    def get_bedrijven_namen(self, obj):
        return [c.naam for c in obj.bedrijven.all()]

    def get_bedrijf(self, obj):
        first = obj.bedrijven.first()
        return str(first.id) if first else None

    def get_bedrijf_naam(self, obj):
        first = obj.bedrijven.first()
        return first.naam if first else None

    def get_gekoppelde_gebruiker_naam(self, obj):
        if obj.gekoppelde_gebruiker:
            return obj.gekoppelde_gebruiker.full_name or obj.gekoppelde_gebruiker.username
        return None

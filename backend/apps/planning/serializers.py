from rest_framework import serializers
from .models import WeekPlanning, PlanningEntry


class PlanningEntrySerializer(serializers.ModelSerializer):
    """Serializer voor PlanningEntry. Toont snapshot-velden zodat historie
    onveranderd blijft, ongeacht latere wijzigingen aan Vehicle/Driver."""
    # Voor backwards-compat behouden we de bestaande output-namen.
    # 'vehicle_type' was de oude naam; we mappen 'm op het snapshot.
    vehicle_type = serializers.CharField(source='vehicle_type_wagen', read_only=True)
    dag_display = serializers.CharField(source='get_dag_display', read_only=True)
    # Stabiele key voor grouping in de frontend: vehicle FK id of fallback op kenteken-snapshot
    vehicle_key = serializers.SerializerMethodField()

    class Meta:
        model = PlanningEntry
        fields = [
            'id', 'planning', 'vehicle', 'vehicle_key', 'dag', 'chauffeur',
            'vehicle_kenteken', 'vehicle_type', 'vehicle_type_wagen', 'vehicle_ritnummer',
            'chauffeur_naam', 'dag_display', 'telefoon', 'adr',
            'ritnummer',
            'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'planning', 'vehicle', 'dag',
            'vehicle_kenteken', 'vehicle_type_wagen', 'vehicle_ritnummer',
            'chauffeur_naam', 'telefoon', 'adr',
            'created_at', 'updated_at'
        ]

    def get_vehicle_key(self, obj):
        # FK id wanneer voertuig nog bestaat, anders snapshot-kenteken zodat
        # rijen in de frontend niet samenvallen wanneer meerdere voertuigen verwijderd zijn.
        if obj.vehicle_id:
            return str(obj.vehicle_id)
        return f"snapshot:{obj.vehicle_kenteken}:{obj.vehicle_ritnummer}"


class WeekPlanningSerializer(serializers.ModelSerializer):
    entries = PlanningEntrySerializer(many=True, read_only=True)

    class Meta:
        model = WeekPlanning
        fields = [
            'id', 'bedrijf', 'bedrijf_naam', 'weeknummer', 'jaar',
            'entries', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'bedrijf', 'bedrijf_naam', 'created_at', 'updated_at']


class WeekPlanningCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeekPlanning
        fields = ['bedrijf', 'weeknummer', 'jaar']
    
    def validate_weeknummer(self, value):
        if value < 1 or value > 53:
            raise serializers.ValidationError("Weeknummer moet tussen 1 en 53 zijn")
        return value
    
    def validate_jaar(self, value):
        from datetime import date
        current_year = date.today().year
        if value < current_year - 1 or value > current_year + 2:
            raise serializers.ValidationError(
                f"Jaar moet tussen {current_year - 1} en {current_year + 2} liggen"
            )
        return value

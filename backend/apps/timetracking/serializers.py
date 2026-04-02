from rest_framework import serializers
from .models import TimeEntry, WeeklyMinimumHours, ImportBatch, ImportedTimeEntry


class TimeEntrySerializer(serializers.ModelSerializer):
    user_naam = serializers.CharField(source='user.full_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    user_bedrijf = serializers.CharField(source='user.bedrijf', read_only=True, allow_blank=True)
    totaal_uren_display = serializers.SerializerMethodField()
    pauze_display = serializers.SerializerMethodField()
    
    class Meta:
        model = TimeEntry
        fields = [
            'id', 'user', 'user_naam', 'user_email', 'user_bedrijf',
            'weeknummer', 'ritnummer', 'datum', 'kenteken',
            'km_start', 'km_eind', 'totaal_km',
            'aanvang', 'eind', 'pauze', 'pauze_display',
            'totaal_uren', 'totaal_uren_display',
            'status', 'bron', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'user', 'weeknummer', 'totaal_km', 'totaal_uren', 'created_at', 'updated_at']
    
    def get_totaal_uren_display(self, obj):
        if obj.totaal_uren:
            total_seconds = int(obj.totaal_uren.total_seconds())
            hours, remainder = divmod(total_seconds, 3600)
            minutes, _ = divmod(remainder, 60)
            return f"{hours}:{minutes:02d}"
        return "0:00"
    
    def get_pauze_display(self, obj):
        if obj.pauze:
            total_seconds = int(obj.pauze.total_seconds())
            hours, remainder = divmod(total_seconds, 3600)
            minutes, _ = divmod(remainder, 60)
            if hours > 0:
                return f"{hours}:{minutes:02d}"
            return f"{minutes} min"
        return "0 min"
    
    def validate(self, attrs):
        # Validate km_eind > km_start
        km_start = attrs.get('km_start')
        km_eind = attrs.get('km_eind')
        
        if km_start is not None and km_eind is not None:
            if km_eind < km_start:
                raise serializers.ValidationError({
                    'km_eind': 'KM eind moet groter zijn dan KM start.'
                })
        
        # Validate kenteken format (optional, Dutch format)
        kenteken = attrs.get('kenteken', '')
        if kenteken:
            # Remove dashes and spaces, uppercase
            kenteken_clean = kenteken.upper().replace('-', '').replace(' ', '')
            if len(kenteken_clean) < 4 or len(kenteken_clean) > 8:
                raise serializers.ValidationError({
                    'kenteken': 'Ongeldig kenteken formaat.'
                })
            # Store cleaned version
            attrs['kenteken'] = kenteken.upper()
        
        return attrs
    
    def validate_datum(self, value):
        from datetime import date, timedelta
        
        # Don't allow dates more than 30 days in the future
        max_future = date.today() + timedelta(days=30)
        if value > max_future:
            raise serializers.ValidationError('Datum mag niet meer dan 30 dagen in de toekomst liggen.')
        
        # Don't allow dates more than 1 year in the past
        min_past = date.today() - timedelta(days=365)
        if value < min_past:
            raise serializers.ValidationError('Datum mag niet meer dan 1 jaar in het verleden liggen.')
        
        return value


class WeeklyMinimumHoursSerializer(serializers.ModelSerializer):
    user_naam = serializers.CharField(source='user.full_name', read_only=True)
    
    class Meta:
        model = WeeklyMinimumHours
        fields = ['id', 'user', 'user_naam', 'jaar', 'weeknummer', 'minimum_uren', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class ImportedTimeEntrySerializer(serializers.ModelSerializer):
    user_naam = serializers.CharField(source='user.full_name', read_only=True, default='')
    voertuig_kenteken = serializers.CharField(
        source='gekoppeld_voertuig.kenteken', read_only=True, default=''
    )
    voertuig_ritnummer = serializers.CharField(
        source='gekoppeld_voertuig.ritnummer', read_only=True, default=''
    )
    pauze_display = serializers.SerializerMethodField()

    class Meta:
        model = ImportedTimeEntry
        fields = [
            'id', 'batch', 'user', 'user_naam',
            'weeknummer', 'periode', 'datum', 'ritlijst',
            'kenteken_import', 'km', 'uurtarief', 'dot',
            'geplande_vertrektijd', 'ingelogd_bc',
            'begintijd_rit', 'eindtijd_rit',
            'uren', 'pauze', 'pauze_display', 'netto_uren',
            'uren_factuur', 'factuur_bedrag',
            'gekoppeld_voertuig', 'voertuig_kenteken', 'voertuig_ritnummer',
            'created_at',
        ]
        read_only_fields = fields

    def get_pauze_display(self, obj):
        if obj.pauze:
            total_seconds = int(obj.pauze.total_seconds())
            hours, remainder = divmod(total_seconds, 3600)
            minutes, _ = divmod(remainder, 60)
            if hours > 0:
                return f"{hours}:{minutes:02d}"
            return f"{minutes} min"
        return "0 min"


class ImportBatchSerializer(serializers.ModelSerializer):
    geimporteerd_door_naam = serializers.CharField(
        source='geimporteerd_door.full_name', read_only=True, default=''
    )

    class Meta:
        model = ImportBatch
        fields = [
            'id', 'bestandsnaam', 'geimporteerd_door', 'geimporteerd_door_naam',
            'totaal_rijen', 'gekoppeld', 'niet_gekoppeld', 'created_at',
        ]
        read_only_fields = fields

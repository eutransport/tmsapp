from rest_framework import serializers
import os
from .models import TimeEntry, WeeklyMinimumHours, ImportBatch, ImportedTimeEntry, TolRegistratie, TolRit


class TimeEntrySerializer(serializers.ModelSerializer):
    user_naam = serializers.CharField(source='user.full_name', read_only=True)
    user_email = serializers.CharField(source='user.email', read_only=True)
    user_bedrijf = serializers.CharField(source='user.bedrijf', read_only=True, allow_blank=True)
    totaal_uren_display = serializers.SerializerMethodField()
    pauze_display = serializers.SerializerMethodField()
    overtime_info = serializers.SerializerMethodField()
    
    class Meta:
        model = TimeEntry
        fields = [
            'id', 'user', 'user_naam', 'user_email', 'user_bedrijf',
            'weeknummer', 'ritnummer', 'datum', 'kenteken',
            'km_start', 'km_eind', 'totaal_km',
            'aanvang', 'eind', 'pauze', 'pauze_display',
            'totaal_uren', 'totaal_uren_display',
            'status', 'bron', 'created_at', 'updated_at',
            'overtime_info',
            'kilometerheffing_bedrag', 'kilometerheffing_gefactureerd_at',
        ]
        read_only_fields = ['id', 'user', 'weeknummer', 'totaal_km', 'totaal_uren', 'created_at', 'updated_at', 'kilometerheffing_gefactureerd_at']
    
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
    
    def get_overtime_info(self, obj):
        """Calculate overtime info for auto_import entries based on driver settings."""
        if obj.bron != 'auto_import' or not obj.totaal_uren:
            return None

        from apps.drivers.models import Driver

        try:
            driver = Driver.objects.get(gekoppelde_gebruiker=obj.user)
        except Driver.DoesNotExist:
            return None

        uren_per_dag = float(driver.uren_per_dag) if driver.uren_per_dag is not None else 8.0
        total_seconds = obj.totaal_uren.total_seconds()
        total_hours = total_seconds / 3600
        overtime = max(0, round(total_hours - uren_per_dag, 2))

        def _fmt(h):
            hrs = int(h)
            mins = int(round((h - hrs) * 60))
            return f"{hrs:02d}:{mins:02d}"

        pauze_seconds = obj.pauze.total_seconds() if obj.pauze else 0
        pauze_hours = pauze_seconds / 3600

        return {
            'start_time': obj.aanvang.strftime('%H:%M') if obj.aanvang else None,
            'end_time': obj.eind.strftime('%H:%M') if obj.eind else None,
            'pauze_display': _fmt(pauze_hours),
            'netto_display': _fmt(total_hours),
            'uren_per_dag': uren_per_dag,
            'uren_per_dag_display': _fmt(uren_per_dag),
            'overtime_hours': overtime,
            'overtime_display': _fmt(overtime),
            'formula': f"{_fmt(total_hours)} - {_fmt(uren_per_dag)} = {_fmt(overtime)} overuren",
        }

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


class TolRitSerializer(serializers.ModelSerializer):
    rit_datum = serializers.SerializerMethodField()

    class Meta:
        model = TolRit
        fields = ['id', 'ritnummer', 'volgorde', 'rit_datum']
        read_only_fields = ['id']

    def get_rit_datum(self, obj):
        matched_date = (
            TimeEntry.objects
            .filter(user=obj.tol_registratie.user, ritnummer=obj.ritnummer)
            .order_by('-datum')
            .values_list('datum', flat=True)
            .first()
        )
        if not matched_date:
            matched_date = (
                TimeEntry.objects
                .filter(ritnummer=obj.ritnummer)
                .order_by('-datum')
                .values_list('datum', flat=True)
                .first()
            )
        return matched_date.isoformat() if matched_date else None


class TolRegistratieSerializer(serializers.ModelSerializer):
    user_naam = serializers.CharField(source='user.full_name', read_only=True)
    bijlage_url = serializers.SerializerMethodField()
    bijlage_naam = serializers.SerializerMethodField()
    ritten = TolRitSerializer(many=True, read_only=True)
    ritnummers = serializers.ListField(
        child=serializers.CharField(allow_blank=True),
        write_only=True,
        required=False,
    )

    class Meta:
        model = TolRegistratie
        fields = [
            'id', 'user', 'user_naam', 'datum', 'kenteken',
            'totaal_bedrag', 'bijlage', 'bijlage_url', 'bijlage_naam',
            'ritten', 'ritnummers',
            'status', 'gefactureerd', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'user', 'created_at', 'updated_at']
        extra_kwargs = {
            'bijlage': {'write_only': True, 'required': False, 'allow_null': True},
            'datum': {'required': False, 'allow_null': True},
            'kenteken': {'required': False, 'allow_blank': True},
        }

    def validate(self, attrs):
        # Datum is optional; if not provided, a vehicle (kenteken) is required.
        datum = attrs.get('datum', getattr(self.instance, 'datum', None))
        kenteken = attrs.get('kenteken', getattr(self.instance, 'kenteken', None))
        if not datum and not (kenteken and str(kenteken).strip()):
            raise serializers.ValidationError({
                'kenteken': 'Selecteer een wagen wanneer er geen datum is ingevuld.'
            })
        return attrs

    def _parse_ritnummers(self, raw):
        """Accept a list of ritnummers, or comma/newline separated string(s)."""
        result = []
        if raw is None:
            return result
        items = raw if isinstance(raw, (list, tuple)) else [raw]
        for item in items:
            if item is None:
                continue
            for part in str(item).replace('\n', ',').split(','):
                part = part.strip()
                if part:
                    result.append(part)
        return result

    def create(self, validated_data):
        ritnummers = self._parse_ritnummers(validated_data.pop('ritnummers', None))
        instance = super().create(validated_data)
        for index, ritnummer in enumerate(ritnummers):
            TolRit.objects.create(tol_registratie=instance, ritnummer=ritnummer, volgorde=index)
        return instance

    def update(self, instance, validated_data):
        ritnummers_raw = validated_data.pop('ritnummers', None)
        instance = super().update(instance, validated_data)
        if ritnummers_raw is not None:
            instance.ritten.all().delete()
            for index, ritnummer in enumerate(self._parse_ritnummers(ritnummers_raw)):
                TolRit.objects.create(tol_registratie=instance, ritnummer=ritnummer, volgorde=index)
        return instance

    def get_bijlage_url(self, obj):
        if obj.bijlage and obj.bijlage.storage.exists(obj.bijlage.name):
            request = self.context.get('request')
            if request:
                return request.build_absolute_uri(obj.bijlage.url)
            return obj.bijlage.url
        return None

    def get_bijlage_naam(self, obj):
        if obj.bijlage and obj.bijlage.storage.exists(obj.bijlage.name):
            return os.path.basename(obj.bijlage.name)
        return None

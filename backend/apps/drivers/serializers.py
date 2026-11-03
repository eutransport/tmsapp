from rest_framework import serializers
from .models import Charter, Driver, DriverCharterPeriode


class DriverSerializer(serializers.ModelSerializer):
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True, allow_null=True)
    gekoppelde_gebruiker_naam = serializers.SerializerMethodField()
    voertuig_ritnummer = serializers.CharField(source='voertuig.ritnummer', read_only=True, allow_null=True)
    voertuig_kenteken = serializers.CharField(source='voertuig.kenteken', read_only=True, allow_null=True)
    charter_naam = serializers.CharField(source='charter.naam', read_only=True, allow_null=True)
    
    class Meta:
        model = Driver
        fields = [
            'id', 'naam', 'telefoon', 'bedrijf', 'bedrijf_naam',
            'gekoppelde_gebruiker', 'gekoppelde_gebruiker_naam',
            'voertuig', 'voertuig_ritnummer', 'voertuig_kenteken',
            'charter', 'charter_naam',
            'adr', 'minimum_uren_per_week', 'standaard_pauze',
            'auto_uren', 'tacho_kenteken', 'standaard_begintijd',
            'uren_per_dag',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
    
    def get_gekoppelde_gebruiker_naam(self, obj):
        if obj.gekoppelde_gebruiker:
            return obj.gekoppelde_gebruiker.full_name or obj.gekoppelde_gebruiker.username
        return None

    def validate_charter(self, charter):
        # Een charter-koppeling stelt uren en tol open voor een externe partij;
        # dat besluit ligt bij een admin, net als het charterbeheer zelf.
        huidig = self.instance.charter if self.instance else None
        if charter != huidig:
            request = self.context.get('request')
            if not (request and getattr(request.user, 'is_admin', False)):
                raise serializers.ValidationError(
                    'Alleen een beheerder kan een chauffeur aan een charter koppelen.'
                )
        return charter


class CharterSerializer(serializers.ModelSerializer):
    aantal_chauffeurs = serializers.SerializerMethodField()
    voertuig_kentekens = serializers.SerializerMethodField()

    class Meta:
        model = Charter
        fields = [
            'id', 'naam', 'kvk', 'contactpersoon', 'email', 'telefoon',
            'voertuigen', 'voertuig_kentekens', 'aantal_chauffeurs',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_aantal_chauffeurs(self, obj):
        return obj.chauffeurs.count()

    def get_voertuig_kentekens(self, obj):
        return [v.kenteken for v in obj.voertuigen.all()]


class DriverCharterPeriodeSerializer(serializers.ModelSerializer):
    driver_naam = serializers.CharField(source='driver.naam', read_only=True)
    charter_naam = serializers.CharField(source='charter.naam', read_only=True)

    class Meta:
        model = DriverCharterPeriode
        fields = [
            'id', 'driver', 'driver_naam', 'charter', 'charter_naam',
            'vanaf', 'tot', 'created_at', 'updated_at',
        ]
        # Wie bij welke charter hoort, loopt via de chauffeur zelf; hier alleen de datums.
        read_only_fields = ['id', 'driver', 'charter', 'created_at', 'updated_at']

    def validate(self, attrs):
        vanaf = attrs.get('vanaf', self.instance.vanaf if self.instance else None)
        tot = attrs.get('tot', self.instance.tot if self.instance else None)
        if vanaf and tot and tot < vanaf:
            raise serializers.ValidationError({'tot': 'De einddatum ligt voor de begindatum.'})
        return attrs

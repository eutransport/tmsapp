from rest_framework import serializers

from .models import Opdracht
from .serializers import OpdrachtBijlageSerializer, OpdrachtRegelSerializer


class ChauffeurOpdrachtSerializer(serializers.ModelSerializer):
    """Wat de chauffeur van een opdracht te zien krijgt."""

    bijlagen = OpdrachtBijlageSerializer(many=True, read_only=True)
    regels = OpdrachtRegelSerializer(many=True, read_only=True)
    opdrachtgever_naam = serializers.CharField(source='bedrijf.naam', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    fase_label = serializers.CharField(source='get_fase_display', read_only=True)
    werksoort = serializers.CharField(read_only=True)
    werk_omschrijving = serializers.CharField(read_only=True)

    class Meta:
        model = Opdracht
        fields = [
            'id', 'opdrachtgever_naam', 'ritnummer', 'klant_naam', 'adres', 'postcode', 'plaats',
            'contactpersoon', 'telefoon', 'notitie', 'geopend_tot',
            'volgorde', 'status', 'status_label',
            'werk_laden', 'werk_lossen', 'werksoort', 'werk_omschrijving',
            'fase', 'fase_label', 'aangekomen_op', 'aangekomen_automatisch',
            'wachten_sinds', 'laden_gestart_op', 'lossen_gestart_op', 'regels',
            'gestart_op', 'afgeleverd_op', 'niet_geleverd_op', 'niet_geleverd_reden',
            'chauffeur_reactie', 'kenteken',
            'eta_aankomst', 'eta_minuten', 'eta_start_minuten',
            'eta_afstand_km', 'eta_bijgewerkt_op', 'eta_fout',
            'bijlagen', 'created_at', 'updated_at',
        ]
        read_only_fields = fields


class FaseNotitieSerializer(serializers.Serializer):
    """Gedeelde invoer voor de tussenstappen: alleen een tijdstip en een notitie."""

    tijdstip = serializers.DateTimeField(required=False, allow_null=True)
    chauffeur_reactie = serializers.CharField(required=False, allow_blank=True)


class BegonnenSerializer(FaseNotitieSerializer):
    soort = serializers.ChoiceField(choices=['laden', 'lossen'], required=False)


class AfmeldSerializer(serializers.Serializer):
    afgeleverd_op = serializers.DateTimeField(required=False, allow_null=True)
    chauffeur_reactie = serializers.CharField(required=False, allow_blank=True)


class NietGeleverdSerializer(serializers.Serializer):
    niet_geleverd_reden = serializers.CharField(max_length=5000)
    niet_geleverd_op = serializers.DateTimeField(required=False, allow_null=True)

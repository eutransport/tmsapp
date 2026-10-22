from rest_framework import serializers

from .models import Opdracht
from .serializers import OpdrachtBijlageSerializer


class ChauffeurOpdrachtSerializer(serializers.ModelSerializer):
    """Wat de chauffeur van een opdracht te zien krijgt."""

    bijlagen = OpdrachtBijlageSerializer(many=True, read_only=True)
    opdrachtgever_naam = serializers.CharField(source='bedrijf.naam', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Opdracht
        fields = [
            'id', 'opdrachtgever_naam', 'ritnummer', 'klant_naam', 'adres', 'postcode', 'plaats',
            'contactpersoon', 'telefoon', 'notitie', 'geopend_tot',
            'volgorde', 'status', 'status_label',
            'gestart_op', 'afgeleverd_op', 'niet_geleverd_op', 'niet_geleverd_reden',
            'chauffeur_reactie', 'kenteken',
            'eta_aankomst', 'eta_minuten', 'eta_start_minuten',
            'eta_afstand_km', 'eta_bijgewerkt_op', 'eta_fout',
            'bijlagen', 'created_at', 'updated_at',
        ]
        read_only_fields = fields


class AfmeldSerializer(serializers.Serializer):
    afgeleverd_op = serializers.DateTimeField(required=False, allow_null=True)
    chauffeur_reactie = serializers.CharField(required=False, allow_blank=True)


class NietGeleverdSerializer(serializers.Serializer):
    niet_geleverd_reden = serializers.CharField(max_length=5000)
    niet_geleverd_op = serializers.DateTimeField(required=False, allow_null=True)

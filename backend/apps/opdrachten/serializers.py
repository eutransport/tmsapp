from rest_framework import serializers

from apps.core.file_signing import sign_file_field
from apps.drivers.models import Driver

from .models import Opdracht, OpdrachtBijlage, OpdrachtKlant, OpdrachtMailInstelling, OpdrachtStatus


class OpdrachtBijlageSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    geupload_door_naam = serializers.CharField(
        source='geupload_door.full_name', read_only=True, default=None
    )

    class Meta:
        model = OpdrachtBijlage
        fields = ['id', 'bestandsnaam', 'url', 'geupload_door_naam', 'created_at']
        read_only_fields = fields

    def get_url(self, obj):
        return sign_file_field(obj.bestand)


class OpdrachtSerializer(serializers.ModelSerializer):
    bijlagen = OpdrachtBijlageSerializer(many=True, read_only=True)
    ritnummer = serializers.CharField(
        max_length=30, required=False, allow_blank=True, allow_null=True
    )
    chauffeur_naam = serializers.CharField(source='chauffeur.naam', read_only=True)
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True)
    aangemaakt_door_naam = serializers.CharField(
        source='aangemaakt_door.full_name', read_only=True
    )
    status_label = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Opdracht
        fields = [
            'id', 'bedrijf', 'bedrijf_naam', 'aangemaakt_door', 'aangemaakt_door_naam',
            'chauffeur', 'chauffeur_naam',
            'ritnummer',
            'klant_naam', 'adres', 'postcode', 'plaats', 'contactpersoon',
            'telefoon', 'notitie', 'geopend_tot',
            'volgorde', 'status', 'status_label',
            'gestart_op', 'afgeleverd_op', 'ingetrokken_op',
            'niet_geleverd_op', 'niet_geleverd_reden', 'laatste_mail_fout',
            'chauffeur_reactie', 'kenteken', 'bijlagen',
            'eta_aankomst', 'eta_minuten', 'eta_start_minuten',
            'eta_afstand_km', 'eta_bijgewerkt_op', 'eta_fout',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'bedrijf', 'aangemaakt_door', 'status', 'gestart_op',
            'afgeleverd_op', 'ingetrokken_op', 'niet_geleverd_op',
            'niet_geleverd_reden', 'laatste_mail_fout',
            'chauffeur_reactie', 'kenteken',
            'eta_aankomst', 'eta_minuten', 'eta_start_minuten',
            'eta_afstand_km', 'eta_bijgewerkt_op', 'eta_fout',
            'created_at', 'updated_at',
        ]

    def validate_ritnummer(self, waarde):
        """Leeg betekent: laat het model zelf een nummer uitdelen."""
        return (waarde or '').strip() or None

    def validate_chauffeur(self, chauffeur):
        """Een opdrachtgever mag alleen chauffeurs van zijn eigen bedrijf kiezen."""
        bedrijf_id = self.context.get('bedrijf_id')
        if bedrijf_id and chauffeur.bedrijf_id != bedrijf_id:
            raise serializers.ValidationError(
                'Deze chauffeur hoort niet bij uw bedrijf.'
            )
        return chauffeur


class OpdrachtVolgordeSerializer(serializers.Serializer):
    """Nieuwe rangschikking: een lijst met opdracht-ids in de gewenste volgorde."""
    volgorde = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)


class ChauffeurKeuzeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Driver
        fields = ['id', 'naam', 'telefoon']


class OpdrachtKlantSerializer(serializers.ModelSerializer):
    aantal_opdrachten = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = OpdrachtKlant
        fields = [
            'id', 'naam', 'adres', 'postcode', 'plaats', 'contactpersoon',
            'telefoon', 'notitie', 'geopend_tot', 'aantal_opdrachten',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'aantal_opdrachten', 'created_at', 'updated_at']

    def validate_naam(self, waarde):
        waarde = (waarde or '').strip()
        if not waarde:
            raise serializers.ValidationError('Bedrijfsnaam is verplicht.')
        bestaat = OpdrachtKlant.objects.filter(
            bedrijf_id=self.context.get('bedrijf_id'), naam__iexact=waarde
        ).exclude(pk=self.instance.pk if self.instance else None)
        if bestaat.exists():
            raise serializers.ValidationError('Deze klant bestaat al.')
        return waarde


class OpdrachtMailInstellingSerializer(serializers.ModelSerializer):
    class Meta:
        model = OpdrachtMailInstelling
        fields = [
            'id', 'bedrijf', 'afzender', 'ontvangers',
            'mail_bij_start', 'mail_bij_aflevering', 'mail_bij_niet_geleverd', 'taal',
        ]
        # De afzender blijft van ons; alleen een beheerder wijzigt die.
        read_only_fields = ['id', 'bedrijf', 'afzender']

    def validate_ontvangers(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('Ontvangers moeten een lijst zijn.')
        velden = serializers.EmailField()
        return [velden.run_validation(str(adres).strip()) for adres in value]

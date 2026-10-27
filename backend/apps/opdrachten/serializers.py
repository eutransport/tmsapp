from rest_framework import serializers

from apps.core.file_signing import sign_file_field
from apps.drivers.models import Driver

from .models import (
    Opdracht,
    OpdrachtBijlage,
    OpdrachtKlant,
    OpdrachtMailInstelling,
    OpdrachtRegel,
    OpdrachtStatus,
)


class OpdrachtRegelSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)

    class Meta:
        model = OpdrachtRegel
        fields = ['id', 'ordernummer', 'omschrijving', 'aantal_pallets', 'soort', 'volgorde']

    def validate(self, data):
        gevuld = any([
            (data.get('ordernummer') or '').strip(),
            (data.get('omschrijving') or '').strip(),
            data.get('aantal_pallets') is not None,
        ])
        if not gevuld:
            raise serializers.ValidationError('Een lege regel kan niet bewaard worden.')
        return data



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
    fase_label = serializers.CharField(source='get_fase_display', read_only=True)
    werksoort = serializers.CharField(read_only=True)
    werk_omschrijving = serializers.CharField(read_only=True)
    regels = OpdrachtRegelSerializer(many=True, required=False)

    class Meta:
        model = Opdracht
        fields = [
            'id', 'bedrijf', 'bedrijf_naam', 'aangemaakt_door', 'aangemaakt_door_naam',
            'chauffeur', 'chauffeur_naam',
            'ritnummer',
            'klant_naam', 'adres', 'postcode', 'plaats', 'contactpersoon',
            'telefoon', 'notitie', 'geopend_tot',
            'volgorde', 'status', 'status_label',
            'werk_laden', 'werk_lossen', 'werksoort', 'werk_omschrijving',
            'fase', 'fase_label', 'aangekomen_op', 'aangekomen_automatisch',
            'wachten_sinds', 'laden_gestart_op', 'lossen_gestart_op',
            'regels',
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
            'fase', 'aangekomen_op', 'aangekomen_automatisch',
            'wachten_sinds', 'laden_gestart_op', 'lossen_gestart_op',
            'eta_aankomst', 'eta_minuten', 'eta_start_minuten',
            'eta_afstand_km', 'eta_bijgewerkt_op', 'eta_fout',
            'created_at', 'updated_at',
        ]

    def validate(self, data):
        """Een opdracht zonder werk heeft geen betekenis voor de chauffeur."""
        laden = data.get('werk_laden', getattr(self.instance, 'werk_laden', False))
        lossen = data.get('werk_lossen', getattr(self.instance, 'werk_lossen', True))
        if not laden and not lossen:
            raise serializers.ValidationError(
                {'werk_laden': 'Kies minstens laden of lossen.'}
            )
        return data

    def create(self, validated_data):
        regels = validated_data.pop('regels', None)
        opdracht = super().create(validated_data)
        self._regels_bewaren(opdracht, regels)
        return opdracht

    def update(self, instance, validated_data):
        regels = validated_data.pop('regels', None)
        opdracht = super().update(instance, validated_data)
        self._regels_bewaren(opdracht, regels)
        return opdracht

    @staticmethod
    def _regels_bewaren(opdracht, regels):
        """Niet meegestuurd betekent ongewijzigd; een lege lijst wist de regels."""
        if regels is None:
            return
        opdracht.regels.all().delete()
        OpdrachtRegel.objects.bulk_create([
            OpdrachtRegel(
                opdracht=opdracht,
                ordernummer=(regel.get('ordernummer') or '').strip(),
                omschrijving=(regel.get('omschrijving') or '').strip(),
                aantal_pallets=regel.get('aantal_pallets'),
                soort=regel.get('soort') or '',
                volgorde=regel.get('volgorde') or index,
            )
            for index, regel in enumerate(regels)
        ])

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

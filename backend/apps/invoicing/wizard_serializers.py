"""Serializers voor de factuurwizard."""
from decimal import Decimal

from rest_framework import serializers

from .models import InvoiceTemplate
from .wizard_models import FactuurWizardBedrijf, FactuurWizardDienst


class FactuurWizardDienstSerializer(serializers.ModelSerializer):
    class Meta:
        model = FactuurWizardDienst
        fields = ['id', 'ritnummer', 'omschrijving', 'actief', 'volgorde']
        read_only_fields = ['id']

    def validate_ritnummer(self, waarde):
        schoon = (waarde or '').strip()
        if not schoon:
            raise serializers.ValidationError('Vul een routenummer in.')
        return schoon


class FactuurWizardBedrijfSerializer(serializers.ModelSerializer):
    """Configuratie van een bedrijf, inclusief de diensten eronder."""

    diensten = FactuurWizardDienstSerializer(many=True, required=False)
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True)
    template_naam = serializers.CharField(source='template.naam', read_only=True)
    administratie_naam = serializers.CharField(
        source='administratie.naam', read_only=True, allow_null=True
    )

    class Meta:
        model = FactuurWizardBedrijf
        fields = [
            'id', 'bedrijf', 'bedrijf_naam', 'template', 'template_naam',
            'administratie', 'administratie_naam', 'btw_percentage',
            'betaaltermijn_dagen', 'actief', 'volgorde', 'diensten',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_btw_percentage(self, waarde):
        if waarde is None:
            return Decimal('21')
        if waarde < 0 or waarde > 100:
            raise serializers.ValidationError('Vul een BTW-percentage tussen 0 en 100 in.')
        return waarde

    def validate_template(self, template: InvoiceTemplate):
        if not template.is_active:
            raise serializers.ValidationError('Deze template staat op inactief.')
        return template

    def _diensten_opslaan(self, config, diensten):
        """Vervangt de dienstenlijst door wat er is meegestuurd."""
        gewenst = {d['ritnummer']: d for d in diensten}

        # Weghalen wat er niet meer bij staat.
        config.diensten.exclude(ritnummer__in=gewenst.keys()).delete()

        bestaand = {d.ritnummer: d for d in config.diensten.all()}
        for volgorde, (ritnummer, gegevens) in enumerate(gewenst.items()):
            regel = bestaand.get(ritnummer)
            if regel is None:
                FactuurWizardDienst.objects.create(
                    config=config,
                    ritnummer=ritnummer,
                    omschrijving=gegevens.get('omschrijving', ''),
                    actief=gegevens.get('actief', True),
                    volgorde=gegevens.get('volgorde', volgorde),
                )
                continue
            regel.omschrijving = gegevens.get('omschrijving', '')
            regel.actief = gegevens.get('actief', True)
            regel.volgorde = gegevens.get('volgorde', volgorde)
            regel.save()

    def create(self, validated_data):
        diensten = validated_data.pop('diensten', [])
        config = FactuurWizardBedrijf.objects.create(**validated_data)
        self._diensten_opslaan(config, diensten)
        return config

    def update(self, instance, validated_data):
        diensten = validated_data.pop('diensten', None)
        for veld, waarde in validated_data.items():
            setattr(instance, veld, waarde)
        instance.save()
        if diensten is not None:
            self._diensten_opslaan(instance, diensten)
        return instance


class WizardRegelSerializer(serializers.Serializer):
    """Een regel zoals de wizard hem aanlevert.

    Een regel hoort bij nul, één of meerdere routes. Meerdere routes komen voor
    als de gebruiker kiest om ze samen op één factuurregel te zetten.
    """

    ritnummers = serializers.ListField(
        child=serializers.CharField(max_length=50),
        required=False,
        default=list,
    )
    datum_van = serializers.DateField(required=False, allow_null=True)
    datum_tot = serializers.DateField(required=False, allow_null=True)
    omschrijving = serializers.CharField(max_length=500)
    bedrag = serializers.DecimalField(max_digits=10, decimal_places=2)

    def validate_ritnummers(self, waarde):
        schoon = [(rit or '').strip() for rit in (waarde or [])]
        schoon = [rit for rit in schoon if rit]
        if len(set(schoon)) != len(schoon):
            raise serializers.ValidationError('Dezelfde route staat er dubbel in.')
        return schoon

    def validate_omschrijving(self, waarde):
        schoon = (waarde or '').strip()
        if not schoon:
            raise serializers.ValidationError('Vul een omschrijving in.')
        return schoon

    def validate(self, data):
        van, tot = data.get('datum_van'), data.get('datum_tot')
        if (van and not tot) or (tot and not van):
            raise serializers.ValidationError(
                'Vul zowel een begin- als een einddatum in, of laat beide leeg.'
            )
        if van and tot and tot < van:
            raise serializers.ValidationError(
                'De einddatum mag niet voor de begindatum liggen.'
            )
        # Bij een dienst hoort altijd een periode; dat is precies waar de
        # omschrijving op de factuur over gaat.
        if data.get('ritnummers') and not van:
            raise serializers.ValidationError(
                'Kies bij een route ook de periode waarover je factureert.'
            )
        return data


class WizardFactuurSerializer(serializers.Serializer):
    """De hele wizard in één keer: bedrijf, regels en wat ermee moet gebeuren."""

    bedrijf = serializers.UUIDField()
    factuurdatum = serializers.DateField()
    regels = WizardRegelSerializer(many=True)
    opmerkingen = serializers.CharField(
        max_length=2000, required=False, allow_blank=True, default=''
    )
    definitief = serializers.BooleanField(default=False)

    def validate_regels(self, regels):
        if not regels:
            raise serializers.ValidationError('Voeg minstens één regel toe.')
        return regels

from rest_framework import serializers
from .models import InvoiceTemplate, Invoice, InvoiceLine, InvoiceStatus, Expense, ExpenseCategory


class InvoiceTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceTemplate
        fields = [
            'id', 'naam', 'beschrijving', 'layout', 'variables',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class InvoiceLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLine
        fields = [
            'id', 'invoice', 'omschrijving', 'aantal', 'eenheid',
            'prijs_per_eenheid', 'totaal', 'time_entry',
            'extra_data', 'volgorde', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'totaal', 'created_at', 'updated_at']
    
    def validate_prijs_per_eenheid(self, value):
        """Round price to 2 decimal places to avoid validation errors."""
        from decimal import Decimal, ROUND_HALF_UP
        if value is not None:
            return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return value
    
    def validate_aantal(self, value):
        """Round quantity to 2 decimal places to avoid validation errors."""
        from decimal import Decimal, ROUND_HALF_UP
        if value is not None:
            return Decimal(str(value)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
        return value
    
    def validate(self, data):
        # Log warning if modifying non-concept invoice lines
        invoice = data.get('invoice') or (self.instance.invoice if self.instance else None)
        if invoice and invoice.status != InvoiceStatus.CONCEPT:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(
                f"Modifying invoice line for non-concept invoice: {invoice.factuurnummer} "
                f"(status: {invoice.status})"
            )
        return data
    
    def create(self, validated_data):
        # Calculate line total
        validated_data['totaal'] = (
            validated_data.get('aantal', 1) * validated_data.get('prijs_per_eenheid', 0)
        )
        return super().create(validated_data)
    
    def update(self, instance, validated_data):
        # Recalculate total if quantity or price changed
        aantal = validated_data.get('aantal', instance.aantal)
        prijs = validated_data.get('prijs_per_eenheid', instance.prijs_per_eenheid)
        validated_data['totaal'] = aantal * prijs
        return super().update(instance, validated_data)


class InvoiceSerializer(serializers.ModelSerializer):
    lines = InvoiceLineSerializer(many=True, read_only=True)
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True)
    template_naam = serializers.CharField(source='template.naam', read_only=True)
    created_by_naam = serializers.CharField(source='created_by.full_name', read_only=True)
    chauffeur_naam = serializers.CharField(source='chauffeur.full_name', read_only=True, allow_null=True)
    type_display = serializers.CharField(source='get_type_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    
    class Meta:
        model = Invoice
        fields = [
            'id', 'factuurnummer', 'type', 'type_display', 'status', 'status_display',
            'template', 'template_naam', 'bedrijf', 'bedrijf_naam',
            'factuurdatum', 'vervaldatum',
            'subtotaal', 'btw_percentage', 'btw_bedrag', 'totaal',
            'opmerkingen', 'pdf_file',
            'created_by', 'created_by_naam', 'sent_at',
            'week_number', 'week_year', 'chauffeur', 'chauffeur_naam',
            'lines', 'created_at', 'updated_at'
        ]
        read_only_fields = [
            'id', 'factuurnummer', 'subtotaal', 'btw_bedrag', 'totaal',
            'pdf_file', 'created_by', 'sent_at', 'created_at', 'updated_at'
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # Creditfacturen: bedragen altijd negatief tonen
        if instance.type == 'credit':
            for field in ('subtotaal', 'btw_bedrag', 'totaal'):
                val = data.get(field)
                if val is not None and float(val) > 0:
                    data[field] = str(-abs(float(val)))
        return data


class InvoiceCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ['template', 'bedrijf', 'type', 'factuurdatum', 'vervaldatum', 'btw_percentage', 'opmerkingen', 'week_number', 'week_year', 'chauffeur']
    
    def validate_factuurdatum(self, value):
        from datetime import date, timedelta
        # Factuurdatum mag niet te ver in het verleden liggen
        min_date = date.today() - timedelta(days=365)
        if value < min_date:
            raise serializers.ValidationError("Factuurdatum mag niet meer dan 1 jaar in het verleden liggen")
        return value
    
    def validate_vervaldatum(self, value):
        from datetime import date
        if value < date.today():
            raise serializers.ValidationError("Vervaldatum mag niet in het verleden liggen")
        return value
    
    def validate(self, data):
        if data.get('vervaldatum') and data.get('factuurdatum'):
            if data['vervaldatum'] < data['factuurdatum']:
                raise serializers.ValidationError({
                    'vervaldatum': "Vervaldatum moet na factuurdatum liggen"
                })
        return data


class InvoiceUpdateSerializer(serializers.ModelSerializer):
    """Serializer voor het updaten van facturen met status validatie."""
    
    class Meta:
        model = Invoice
        fields = ['status', 'btw_percentage', 'opmerkingen', 'vervaldatum']
    
    def validate_status(self, value):
        if self.instance:
            current = self.instance.status
            # Geldige status transitions
            valid_transitions = {
                InvoiceStatus.CONCEPT: [InvoiceStatus.DEFINITIEF],
                InvoiceStatus.DEFINITIEF: [InvoiceStatus.VERZONDEN, InvoiceStatus.CONCEPT],
                InvoiceStatus.VERZONDEN: [InvoiceStatus.BETAALD],
                InvoiceStatus.BETAALD: [],  # Betaald is eindstatus
            }
            
            if value != current and value not in valid_transitions.get(current, []):
                raise serializers.ValidationError(
                    f"Ongeldige status overgang van '{current}' naar '{value}'"
                )
        return value
    
    def validate(self, data):
        # Concept facturen mogen alles wijzigen
        if self.instance and self.instance.status != InvoiceStatus.CONCEPT:
            # Niet-concept facturen mogen alleen status en opmerkingen wijzigen
            allowed_fields = {'status', 'opmerkingen'}
            for field in data.keys():
                if field not in allowed_fields:
                    raise serializers.ValidationError(
                        f"Veld '{field}' kan niet worden gewijzigd voor niet-concept facturen"
                    )
        return data


class ExpenseSerializer(serializers.ModelSerializer):
    """Serializer for expenses."""
    categorie_display = serializers.CharField(source='get_categorie_display', read_only=True)
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True)
    voertuig_kenteken = serializers.CharField(source='voertuig.kenteken', read_only=True)
    chauffeur_naam = serializers.CharField(source='chauffeur.full_name', read_only=True)
    created_by_naam = serializers.CharField(source='created_by.full_name', read_only=True)
    
    class Meta:
        model = Expense
        fields = [
            'id', 'omschrijving', 'categorie', 'categorie_display',
            'bedrag', 'btw_bedrag', 'totaal', 'datum',
            'bedrijf', 'bedrijf_naam',
            'voertuig', 'voertuig_kenteken',
            'chauffeur', 'chauffeur_naam',
            'notities', 'bijlage',
            'created_by', 'created_by_naam',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']
    
    def create(self, validated_data):
        # Calculate total if not provided
        if 'totaal' not in validated_data or not validated_data['totaal']:
            validated_data['totaal'] = (
                validated_data.get('bedrag', 0) + validated_data.get('btw_bedrag', 0)
            )
        return super().create(validated_data)


class ExpenseCategorySerializer(serializers.Serializer):
    """Serializer for expense categories."""
    value = serializers.CharField()
    label = serializers.CharField()
    
    @staticmethod
    def get_categories():
        return [
            {'value': choice[0], 'label': choice[1]}
            for choice in ExpenseCategory.choices
        ]

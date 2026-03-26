from rest_framework import serializers
from .models import BankAccount, BankTransaction, BankImport, BankAccountType


class BankAccountSerializer(serializers.ModelSerializer):
    bank_display = serializers.CharField(source='get_bank_display', read_only=True)
    created_by_naam = serializers.CharField(source='created_by.full_name', read_only=True)

    class Meta:
        model = BankAccount
        fields = [
            'id', 'naam', 'bank', 'bank_display', 'iban', 'is_active',
            'created_by', 'created_by_naam', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_by', 'created_at', 'updated_at']

    def validate_iban(self, value):
        """Basic IBAN format validation."""
        cleaned = value.replace(' ', '').upper()
        if len(cleaned) < 4 or not cleaned[:2].isalpha():
            raise serializers.ValidationError("Ongeldig IBAN formaat.")
        return cleaned


class BankImportSerializer(serializers.ModelSerializer):
    bankrekening_naam = serializers.CharField(source='bankrekening.naam', read_only=True)
    geimporteerd_door_naam = serializers.CharField(
        source='geimporteerd_door.full_name', read_only=True
    )

    class Meta:
        model = BankImport
        fields = [
            'id', 'bankrekening', 'bankrekening_naam', 'bestandsnaam',
            'bestandsformaat', 'status', 'aantal_transacties', 'aantal_gematcht',
            'foutmelding', 'geimporteerd_door', 'geimporteerd_door_naam', 'created_at',
        ]
        read_only_fields = [
            'id', 'bestandsformaat', 'status', 'aantal_transacties',
            'aantal_gematcht', 'foutmelding', 'geimporteerd_door', 'created_at',
        ]


class BankTransactionSerializer(serializers.ModelSerializer):
    match_status_display = serializers.CharField(source='get_match_status_display', read_only=True)
    bankrekening_naam = serializers.CharField(source='bankrekening.naam', read_only=True)
    gekoppelde_factuur_nummer = serializers.CharField(
        source='gekoppelde_factuur.factuurnummer', read_only=True
    )

    class Meta:
        model = BankTransaction
        fields = [
            'id', 'bankrekening', 'bankrekening_naam',
            'datum', 'bedrag', 'naam_tegenpartij', 'rekeningnummer_tegenpartij',
            'omschrijving', 'mutatiesoort', 'referentie',
            'match_status', 'match_status_display',
            'gekoppelde_factuur', 'gekoppelde_factuur_nummer', 'gevonden_factuurnummer',
            'importbestand', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'bankrekening', 'datum', 'bedrag', 'naam_tegenpartij',
            'rekeningnummer_tegenpartij', 'omschrijving', 'mutatiesoort',
            'referentie', 'gevonden_factuurnummer', 'importbestand',
            'created_at', 'updated_at',
        ]


class ManualMatchSerializer(serializers.Serializer):
    """Serializer for manually linking a transaction to an invoice."""
    factuur_id = serializers.UUIDField(required=True)


class BankAccountTypeSerializer(serializers.Serializer):
    value = serializers.CharField()
    label = serializers.CharField()

    @staticmethod
    def get_choices():
        return [{'value': v, 'label': l} for v, l in BankAccountType.choices]

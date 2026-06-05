from rest_framework import serializers
from .models import Company, MailingListContact


class MailingListContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = MailingListContact
        fields = [
            'id', 'bedrijf', 'naam', 'email', 'functie', 'is_active',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class CompanySerializer(serializers.ModelSerializer):
    mailing_contacts = MailingListContactSerializer(many=True, read_only=True)
    mailing_contacts_count = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = [
            'id', 'naam', 'kvk', 'telefoon', 'contactpersoon',
            'email', 'adres', 'postcode', 'stad', 'land',
            'mailing_contacts', 'mailing_contacts_count',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_mailing_contacts_count(self, obj):
        return obj.mailing_contacts.filter(is_active=True).count()

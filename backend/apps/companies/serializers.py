from rest_framework import serializers
from .models import Company, HerinneringInstelling, MailingListContact


class HerinneringInstellingSerializer(serializers.ModelSerializer):
    dagen_reeks = serializers.SerializerMethodField()

    class Meta:
        model = HerinneringInstelling
        fields = [
            'id', 'bedrijf', 'actief', 'interval_dagen', 'max_herinneringen',
            'dagen_reeks', 'updated_at',
        ]
        read_only_fields = ['id', 'bedrijf', 'updated_at']

    def get_dagen_reeks(self, obj):
        return obj.dagen_reeks()


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
    volgbare_voertuigen_detail = serializers.SerializerMethodField()
    herinneringen = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = [
            'id', 'naam', 'kvk', 'telefoon', 'contactpersoon',
            'email', 'adres', 'postcode', 'stad', 'land',
            'volgbare_voertuigen', 'volgbare_voertuigen_detail',
            'mailing_contacts', 'mailing_contacts_count', 'herinneringen',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_herinneringen(self, obj):
        instelling = getattr(obj, 'herinnering_instelling', None)
        if instelling is None:
            return {'actief': False, 'interval_dagen': 7, 'max_herinneringen': 3, 'dagen_reeks': []}
        return {
            'actief': instelling.actief,
            'interval_dagen': instelling.interval_dagen,
            'max_herinneringen': instelling.max_herinneringen,
            'dagen_reeks': instelling.dagen_reeks() if instelling.actief else [],
        }

    def get_mailing_contacts_count(self, obj):
        return obj.mailing_contacts.filter(is_active=True).count()

    def get_volgbare_voertuigen_detail(self, obj):
        return [
            {'id': str(v.id), 'kenteken': v.kenteken, 'type_wagen': v.type_wagen}
            for v in obj.volgbare_voertuigen.all()
        ]

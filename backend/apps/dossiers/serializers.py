"""Serializers voor dossiers."""
from rest_framework import serializers
from .models import DossierType, Dossier, DossierReactie, DossierBijlage, Organisatie, Contactpersoon, DossierMailLog


class ContactpersoonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contactpersoon
        fields = ['id', 'organisatie', 'naam', 'email', 'telefoon', 'functie', 'created_at']
        read_only_fields = ['id', 'created_at']


class OrganisatieSerializer(serializers.ModelSerializer):
    contactpersonen = ContactpersoonSerializer(many=True, read_only=True)

    class Meta:
        model = Organisatie
        fields = ['id', 'naam', 'email', 'telefoon', 'opmerkingen', 'contactpersonen', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class OrganisatieListSerializer(serializers.ModelSerializer):
    contactpersoon_count = serializers.SerializerMethodField()

    class Meta:
        model = Organisatie
        fields = ['id', 'naam', 'email', 'telefoon', 'contactpersoon_count', 'created_at']
        read_only_fields = ['id', 'created_at']

    def get_contactpersoon_count(self, obj):
        return obj.contactpersonen.count()


class DossierMailLogSerializer(serializers.ModelSerializer):
    verzonden_door_naam = serializers.SerializerMethodField()
    type_naam = serializers.CharField(source='type.naam', read_only=True, allow_null=True)

    class Meta:
        model = DossierMailLog
        fields = ['id', 'ontvangers', 'onderwerp', 'type', 'type_naam', 'verzonden_door', 'verzonden_door_naam', 'verzonden_op']
        read_only_fields = ['id', 'verzonden_op']

    def get_verzonden_door_naam(self, obj):
        if obj.verzonden_door:
            return obj.verzonden_door.full_name or obj.verzonden_door.email
        return None


class DossierTypeSerializer(serializers.ModelSerializer):
    in_gebruik = serializers.SerializerMethodField()

    class Meta:
        model = DossierType
        fields = ['id', 'naam', 'actief', 'in_gebruik', 'created_at']
        read_only_fields = ['id', 'created_at']

    def get_in_gebruik(self, obj):
        return obj.dossiers.exists()


class DossierBijlageSerializer(serializers.ModelSerializer):
    bestand_url = serializers.SerializerMethodField()

    class Meta:
        model = DossierBijlage
        fields = ['id', 'bestandsnaam', 'mimetype', 'grootte', 'uploaded_at', 'bestand_url']
        read_only_fields = ['id', 'uploaded_at', 'bestand_url']

    def get_bestand_url(self, obj):
        from apps.core.file_signing import sign_file_field
        url = sign_file_field(obj.bestand)
        if not url:
            return None
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url


class DossierReactieSerializer(serializers.ModelSerializer):
    auteur_naam = serializers.SerializerMethodField()
    bijlagen = DossierBijlageSerializer(many=True, read_only=True)

    class Meta:
        model = DossierReactie
        fields = ['id', 'dossier', 'auteur', 'auteur_naam', 'tekst', 'intern', 'created_at', 'bijlagen']
        read_only_fields = ['id', 'dossier', 'auteur', 'created_at']

    def get_auteur_naam(self, obj):
        if obj.auteur:
            return obj.auteur.full_name or obj.auteur.email
        return None


class DossierListSerializer(serializers.ModelSerializer):
    type_naam = serializers.CharField(source='type.naam', read_only=True)
    instuurder_naam = serializers.SerializerMethodField()
    betreft_naam = serializers.SerializerMethodField()
    heeft_bijlage = serializers.SerializerMethodField()
    reactie_count = serializers.SerializerMethodField()
    organisatie_naam = serializers.CharField(source='organisatie.naam', read_only=True, allow_null=True)

    class Meta:
        model = Dossier
        fields = [
            'id', 'onderwerp', 'type', 'type_naam',
            'instuurder', 'instuurder_naam',
            'betreft_user', 'betreft_chauffeur', 'betreft_naam',
            'organisatie', 'organisatie_naam',
            'heeft_bijlage', 'reactie_count', 'created_at', 'updated_at',
        ]

    def get_instuurder_naam(self, obj):
        if obj.instuurder:
            return obj.instuurder.full_name or obj.instuurder.email
        return None

    def get_betreft_naam(self, obj):
        person = obj.betreft
        if person:
            return person.full_name or person.email
        return None

    def get_heeft_bijlage(self, obj):
        if obj.bijlagen.exists():
            return True
        return DossierBijlage.objects.filter(reactie__dossier=obj).exists()

    def get_reactie_count(self, obj):
        user = self.context.get('request').user if self.context.get('request') else None
        qs = obj.reacties.all()
        if user and not user.is_admin and not user.has_module_permission('manage_dossiers'):
            qs = qs.filter(intern=False)
        return qs.count()


class DossierDetailSerializer(serializers.ModelSerializer):
    type_naam = serializers.CharField(source='type.naam', read_only=True)
    instuurder_naam = serializers.SerializerMethodField()
    betreft_naam = serializers.SerializerMethodField()
    bijlagen = DossierBijlageSerializer(many=True, read_only=True)
    reacties = serializers.SerializerMethodField()
    organisatie_naam = serializers.CharField(source='organisatie.naam', read_only=True, allow_null=True)
    organisatie_contactpersonen = serializers.SerializerMethodField()
    maillogs = DossierMailLogSerializer(many=True, read_only=True)

    class Meta:
        model = Dossier
        fields = [
            'id', 'onderwerp', 'inhoud', 'type', 'type_naam',
            'instuurder', 'instuurder_naam',
            'betreft_user', 'betreft_chauffeur', 'betreft_naam',
            'organisatie', 'organisatie_naam', 'organisatie_contactpersonen',
            'bijlagen', 'reacties', 'maillogs', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'instuurder', 'created_at', 'updated_at']

    def get_instuurder_naam(self, obj):
        if obj.instuurder:
            return obj.instuurder.full_name or obj.instuurder.email
        return None

    def get_betreft_naam(self, obj):
        person = obj.betreft
        if person:
            return person.full_name or person.email
        return None

    def get_organisatie_contactpersonen(self, obj):
        if obj.organisatie:
            return ContactpersoonSerializer(obj.organisatie.contactpersonen.all(), many=True).data
        return []

    def get_reacties(self, obj):
        user = self.context.get('request').user if self.context.get('request') else None
        qs = obj.reacties.all()
        if user and not user.is_admin and not user.has_module_permission('manage_dossiers'):
            qs = qs.filter(intern=False)
        return DossierReactieSerializer(qs, many=True, context=self.context).data


class DossierCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Dossier
        fields = ['id', 'onderwerp', 'inhoud', 'type', 'betreft_user', 'betreft_chauffeur', 'organisatie', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate(self, data):
        betreft_user = data.get('betreft_user')
        betreft_chauffeur = data.get('betreft_chauffeur')
        if not betreft_user and not betreft_chauffeur:
            raise serializers.ValidationError("Geef 'betreft_user' of 'betreft_chauffeur' op.")
        if betreft_user and betreft_chauffeur:
            raise serializers.ValidationError("Vul slechts één van 'betreft_user' of 'betreft_chauffeur' in.")
        return data

from django.db import transaction
from rest_framework import serializers
from .models import Vehicle, VehicleBedrijf, VehicleRitnummer
from .rdw import dagen_tot
from .rdw_sync import RDW_VELDEN
from .ritnummers import _vandaag

# De gegevens die uit het kentekenregister komen. Altijd alleen-lezen: ze
# worden bijgewerkt via de ververs-knop, niet met de hand.
RDW_LEESVELDEN = RDW_VELDEN + ['rdw_opgehaald_op', 'rdw_status']


def iso_week_label(datum):
    """Geef 'week 37 (2026)' bij een datum, of een lege tekst bij None."""
    if not datum:
        return ''
    jaar, week, _dag = datum.isocalendar()
    return f'week {week} ({jaar})'


class VehicleRitnummerSerializer(serializers.ModelSerializer):
    """Een ritnummer met de datum vanaf wanneer het geldt."""
    weeknummer = serializers.SerializerMethodField()
    is_huidig = serializers.SerializerMethodField()

    class Meta:
        model = VehicleRitnummer
        fields = [
            'id', 'vehicle', 'ritnummer', 'geldig_vanaf', 'weeknummer',
            'notitie', 'is_huidig', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_weeknummer(self, obj):
        return iso_week_label(obj.geldig_vanaf)

    def get_is_huidig(self, obj):
        """Geldt deze periode vandaag?"""
        vandaag = _vandaag()
        if obj.geldig_vanaf and obj.geldig_vanaf > vandaag:
            return False
        later = VehicleRitnummer.objects.filter(
            vehicle_id=obj.vehicle_id, geldig_vanaf__lte=vandaag,
        )
        if obj.geldig_vanaf is not None:
            later = later.filter(geldig_vanaf__gt=obj.geldig_vanaf)
        return not later.exists()

    def validate(self, attrs):
        vehicle = attrs.get('vehicle') or getattr(self.instance, 'vehicle', None)
        vanaf = attrs.get('geldig_vanaf', getattr(self.instance, 'geldig_vanaf', None))
        if vehicle is None:
            raise serializers.ValidationError({'vehicle': 'Kies een voertuig.'})

        qs = VehicleRitnummer.objects.filter(vehicle=vehicle, geldig_vanaf=vanaf)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({
                'geldig_vanaf': (
                    'Er bestaat al een periode zonder ingangsdatum voor deze wagen.'
                    if vanaf is None else
                    f'Er bestaat al een periode die op {vanaf} ingaat.'
                )
            })
        return attrs


class VehicleBedrijfSerializer(serializers.ModelSerializer):
    """Een bedrijf met de datum vanaf wanneer de wagen ervoor rijdt."""
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True)
    weeknummer = serializers.SerializerMethodField()
    is_huidig = serializers.SerializerMethodField()

    class Meta:
        model = VehicleBedrijf
        fields = [
            'id', 'vehicle', 'bedrijf', 'bedrijf_naam', 'geldig_vanaf',
            'weeknummer', 'notitie', 'is_huidig', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def get_weeknummer(self, obj):
        return iso_week_label(obj.geldig_vanaf)

    def get_is_huidig(self, obj):
        """Geldt deze periode vandaag?"""
        vandaag = _vandaag()
        if obj.geldig_vanaf and obj.geldig_vanaf > vandaag:
            return False
        later = VehicleBedrijf.objects.filter(
            vehicle_id=obj.vehicle_id, geldig_vanaf__lte=vandaag,
        )
        if obj.geldig_vanaf is not None:
            later = later.filter(geldig_vanaf__gt=obj.geldig_vanaf)
        return not later.exists()

    def validate(self, attrs):
        vehicle = attrs.get('vehicle') or getattr(self.instance, 'vehicle', None)
        vanaf = attrs.get('geldig_vanaf', getattr(self.instance, 'geldig_vanaf', None))
        if vehicle is None:
            raise serializers.ValidationError({'vehicle': 'Kies een voertuig.'})

        qs = VehicleBedrijf.objects.filter(vehicle=vehicle, geldig_vanaf=vanaf)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError({
                'geldig_vanaf': (
                    'Er bestaat al een periode zonder ingangsdatum voor deze wagen.'
                    if vanaf is None else
                    f'Er bestaat al een periode die op {vanaf} ingaat.'
                )
            })
        return attrs


class VehicleSerializer(serializers.ModelSerializer):
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True, allow_null=True)
    # Zet de bestaande actieve regel met hetzelfde kenteken op inactief, zodat
    # een wagen onder een nieuw ritnummer verder kan zonder dat de oude regel
    # (en daarmee de historie) verdwijnt.
    vervang_actief = serializers.BooleanField(write_only=True, required=False, default=False)
    # Alle ritnummers van deze wagen door de tijd heen, oudste eerst.
    ritnummer_periodes = VehicleRitnummerSerializer(many=True, read_only=True)
    # Datum waarop het opgegeven ritnummer ingaat. Verplicht zodra het
    # ritnummer van een bestaande wagen wijzigt, tenzij `ritnummer_corrigeren`
    # meekomt: zonder datum zou de lopende periode overschreven worden en
    # verspringt de historie met terugwerkende kracht.
    ritnummer_vanaf = serializers.DateField(write_only=True, required=False, allow_null=True)
    # Expliciete keuze om de lopende periode te overschrijven, voor het
    # herstellen van een typefout in plaats van een echte wissel.
    ritnummer_corrigeren = serializers.BooleanField(
        write_only=True, required=False, default=False)
    # Alle bedrijven waarvoor deze wagen gereden heeft, oudste eerst.
    bedrijf_periodes = VehicleBedrijfSerializer(many=True, read_only=True)
    # Datum waarop het opgegeven bedrijf ingaat; zelfde regels als hierboven.
    bedrijf_vanaf = serializers.DateField(write_only=True, required=False, allow_null=True)
    bedrijf_corrigeren = serializers.BooleanField(
        write_only=True, required=False, default=False)
    # Aantal dagen tot de keuring verloopt; negatief als die al voorbij is.
    rdw_apk_dagen = serializers.SerializerMethodField()
    rdw_tachograaf_dagen = serializers.SerializerMethodField()

    class Meta:
        model = Vehicle
        fields = [
            'id', 'kenteken', 'type_wagen', 'ritnummer',
            'bedrijf', 'bedrijf_naam', 'minimum_weken_per_jaar',
            'actief', 'created_at', 'updated_at', 'vervang_actief',
            'ritnummer_periodes', 'ritnummer_vanaf', 'ritnummer_corrigeren',
            'bedrijf_periodes', 'bedrijf_vanaf', 'bedrijf_corrigeren',
            'rdw_apk_dagen', 'rdw_tachograaf_dagen',
        ] + RDW_LEESVELDEN
        read_only_fields = [
            'id', 'created_at', 'updated_at',
            'rdw_apk_dagen', 'rdw_tachograaf_dagen',
        ] + RDW_LEESVELDEN
        extra_kwargs = {
            'kenteken': {
                'validators': [],  # Remove DRF's auto UniqueValidator; we handle uniqueness in validate()
            }
        }

    def get_rdw_apk_dagen(self, obj):
        return dagen_tot(obj.rdw_apk_vervaldatum)

    def get_rdw_tachograaf_dagen(self, obj):
        return dagen_tot(obj.rdw_tachograaf_vervaldatum)

    def validate_kenteken(self, value):
        """Normalize kenteken to uppercase."""
        return value.upper()

    def validate(self, attrs):
        """Check kenteken uniqueness only when the vehicle will be active."""
        kenteken = attrs.get('kenteken')
        actief = attrs.get('actief')
        vervang_actief = attrs.get('vervang_actief', False)

        # If editing an existing vehicle, fall back to its current values
        if self.instance:
            if kenteken is None:
                kenteken = self.instance.kenteken
            if actief is None:
                actief = self.instance.actief
        else:
            # New vehicle: fall back to the model field's default
            if actief is None:
                actief = Vehicle._meta.get_field('actief').get_default()

        # Only check uniqueness if this vehicle will be active
        if actief and kenteken and not vervang_actief:
            qs = Vehicle.objects.select_related('bedrijf').filter(
                kenteken__iexact=kenteken, actief=True,
            )
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            bestaand = qs.first()
            if bestaand is not None:
                # Geef de conflicterende regel mee zodat de UI kan vragen of
                # die op inactief gezet mag worden.
                raise serializers.ValidationError({
                    'kenteken': (
                        f"{bestaand.kenteken} staat al actief"
                        + (f" op ritnummer {bestaand.ritnummer}" if bestaand.ritnummer else '')
                        + ". Zet die regel eerst op inactief."
                    ),
                    'kenteken_conflict': {
                        'id': str(bestaand.id),
                        'kenteken': bestaand.kenteken,
                        'ritnummer': bestaand.ritnummer,
                        'type_wagen': bestaand.type_wagen,
                        'bedrijf_naam': bestaand.bedrijf.naam if bestaand.bedrijf else '',
                    },
                })

        self._valideer_ingangsdatum(attrs)
        return attrs

    def _valideer_ingangsdatum(self, attrs):
        """Een wissel van ritnummer of bedrijf moet een ingangsdatum krijgen.

        Zonder datum overschrijft het signaal de periode die vandaag geldt, en
        dan verspringt de historie met terugwerkende kracht: planning,
        tolheffing en facturatie van eerdere maanden gaan dan ineens op het
        nieuwe nummer staan. Wie juist een typefout herstelt kiest bewust voor
        `ritnummer_corrigeren` / `bedrijf_corrigeren`.
        """
        if self.instance is None:
            return

        nieuw_ritnummer = attrs.get('ritnummer')
        if (nieuw_ritnummer is not None
                and (nieuw_ritnummer or '').strip() != (self.instance.ritnummer or '').strip()
                and not attrs.get('ritnummer_vanaf')
                and not attrs.get('ritnummer_corrigeren')):
            raise serializers.ValidationError({
                'ritnummer_vanaf': (
                    'Geef op vanaf welke datum ritnummer '
                    f"{(nieuw_ritnummer or '').strip() or '(leeg)'} geldt. "
                    'Gaat het om het herstellen van een typefout, kies dan '
                    'uitdrukkelijk voor corrigeren met terugwerkende kracht.'
                ),
            })

        nieuw_bedrijf = attrs.get('bedrijf')
        if (nieuw_bedrijf is not None
                and getattr(nieuw_bedrijf, 'pk', nieuw_bedrijf) != self.instance.bedrijf_id
                and not attrs.get('bedrijf_vanaf')
                and not attrs.get('bedrijf_corrigeren')):
            raise serializers.ValidationError({
                'bedrijf_vanaf': (
                    'Geef op vanaf welke datum deze wagen voor het nieuwe '
                    'bedrijf rijdt. Gaat het om het herstellen van een fout, '
                    'kies dan uitdrukkelijk voor corrigeren met terugwerkende '
                    'kracht.'
                ),
            })

    def _deactiveer_vorige(self, kenteken, exclude_pk=None):
        """Zet eerdere actieve regels met hetzelfde kenteken op inactief."""
        qs = Vehicle.objects.filter(kenteken__iexact=kenteken, actief=True)
        if exclude_pk is not None:
            qs = qs.exclude(pk=exclude_pk)
        return qs.update(actief=False)

    def create(self, validated_data):
        vervang_actief = validated_data.pop('vervang_actief', False)
        validated_data.pop('ritnummer_vanaf', None)
        validated_data.pop('bedrijf_vanaf', None)
        validated_data.pop('ritnummer_corrigeren', None)
        validated_data.pop('bedrijf_corrigeren', None)
        with transaction.atomic():
            if vervang_actief and validated_data.get('actief', True):
                self._deactiveer_vorige(validated_data['kenteken'])
            # De open periode wordt automatisch aangemaakt door het signaal.
            return super().create(validated_data)

    def update(self, instance, validated_data):
        vervang_actief = validated_data.pop('vervang_actief', False)
        vanaf = validated_data.pop('ritnummer_vanaf', None)
        bedrijf_vanaf = validated_data.pop('bedrijf_vanaf', None)
        validated_data.pop('ritnummer_corrigeren', None)
        validated_data.pop('bedrijf_corrigeren', None)
        nieuw_ritnummer = validated_data.get('ritnummer')
        nieuw_bedrijf = validated_data.get('bedrijf')
        with transaction.atomic():
            if vervang_actief and validated_data.get('actief', instance.actief):
                self._deactiveer_vorige(
                    validated_data.get('kenteken', instance.kenteken),
                    exclude_pk=instance.pk,
                )
            if vanaf and nieuw_ritnummer is not None:
                # Nieuw ritnummer pas vanaf een datum: het ritnummer van de
                # wagen zelf blijft ongemoeid, de periode bepaalt de rest.
                validated_data.pop('ritnummer', None)
            if bedrijf_vanaf and nieuw_bedrijf is not None:
                # Idem voor het bedrijf: de wagen blijft tot die datum bij het
                # huidige bedrijf horen, zodat de tolheffing van daarvoor niet
                # met terugwerkende kracht verspringt.
                validated_data.pop('bedrijf', None)
            # Eerst de wagen opslaan, daarna pas de periodes. Andersom zou het
            # opslaan van de wagen de zojuist aangemaakte periode meteen weer
            # overschrijven met de oude waarde.
            instance = super().update(instance, validated_data)
            if vanaf and nieuw_ritnummer is not None:
                VehicleRitnummer.objects.update_or_create(
                    vehicle=instance, geldig_vanaf=vanaf,
                    defaults={'ritnummer': (nieuw_ritnummer or '').strip()},
                )
            if bedrijf_vanaf and nieuw_bedrijf is not None:
                VehicleBedrijf.objects.update_or_create(
                    vehicle=instance, geldig_vanaf=bedrijf_vanaf,
                    defaults={'bedrijf': nieuw_bedrijf},
                )
            if (vanaf and nieuw_ritnummer is not None) or (
                    bedrijf_vanaf and nieuw_bedrijf is not None):
                # De signalen kunnen de wagen bijgewerkt hebben.
                instance.refresh_from_db()
            return instance

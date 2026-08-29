from django.db import transaction
from rest_framework import serializers
from .models import Vehicle

class VehicleSerializer(serializers.ModelSerializer):
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True, allow_null=True)
    # Zet de bestaande actieve regel met hetzelfde kenteken op inactief, zodat
    # een wagen onder een nieuw ritnummer verder kan zonder dat de oude regel
    # (en daarmee de historie) verdwijnt.
    vervang_actief = serializers.BooleanField(write_only=True, required=False, default=False)

    class Meta:
        model = Vehicle
        fields = [
            'id', 'kenteken', 'type_wagen', 'ritnummer',
            'bedrijf', 'bedrijf_naam', 'minimum_weken_per_jaar',
            'actief', 'created_at', 'updated_at', 'vervang_actief'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
        extra_kwargs = {
            'kenteken': {
                'validators': [],  # Remove DRF's auto UniqueValidator; we handle uniqueness in validate()
            }
        }

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

        return attrs

    def _deactiveer_vorige(self, kenteken, exclude_pk=None):
        """Zet eerdere actieve regels met hetzelfde kenteken op inactief."""
        qs = Vehicle.objects.filter(kenteken__iexact=kenteken, actief=True)
        if exclude_pk is not None:
            qs = qs.exclude(pk=exclude_pk)
        return qs.update(actief=False)

    def create(self, validated_data):
        vervang_actief = validated_data.pop('vervang_actief', False)
        with transaction.atomic():
            if vervang_actief and validated_data.get('actief', True):
                self._deactiveer_vorige(validated_data['kenteken'])
            return super().create(validated_data)

    def update(self, instance, validated_data):
        vervang_actief = validated_data.pop('vervang_actief', False)
        with transaction.atomic():
            if vervang_actief and validated_data.get('actief', instance.actief):
                self._deactiveer_vorige(
                    validated_data.get('kenteken', instance.kenteken),
                    exclude_pk=instance.pk,
                )
            return super().update(instance, validated_data)

from rest_framework import serializers
from .models import Vehicle

class VehicleSerializer(serializers.ModelSerializer):
    bedrijf_naam = serializers.CharField(source='bedrijf.naam', read_only=True, allow_null=True)
    
    class Meta:
        model = Vehicle
        fields = [
            'id', 'kenteken', 'type_wagen', 'ritnummer',
            'bedrijf', 'bedrijf_naam', 'minimum_weken_per_jaar',
            'actief', 'created_at', 'updated_at'
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
        if actief and kenteken:
            qs = Vehicle.objects.filter(kenteken__iexact=kenteken, actief=True)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError({
                    'kenteken': "Er bestaat al een actief voertuig met dit kenteken."
                })

        return attrs

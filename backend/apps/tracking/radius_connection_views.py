"""API voor het beheren van losse Radius-koppelingen.

Elke koppeling heeft een eigen API-token: één voor telematica (GPS en ritten)
en één voor de tank- en laadkaarten (daar zitten de facturen in). Het token
wordt versleuteld opgeslagen en komt nooit terug in een response; we geven
alleen terug of er een token is ingesteld.
"""
import logging

from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdminOnly

from .models import RadiusConnection
from .radius_service import RadiusError, get_customers, test_connection
from .security import RadiusConnectionTestThrottle, RadiusConnectionThrottle

logger = logging.getLogger('tracking')


class RadiusConnectionSerializer(serializers.ModelSerializer):
    """Koppeling zonder het token; `heeft_token` zegt of er één is ingesteld."""

    api_token = serializers.CharField(
        write_only=True, required=False, allow_blank=True,
        trim_whitespace=True, max_length=512,
        style={'input_type': 'password'},
    )
    heeft_token = serializers.SerializerMethodField()
    soort_label = serializers.CharField(source='get_soort_display', read_only=True)

    class Meta:
        model = RadiusConnection
        fields = [
            'id', 'naam', 'soort', 'soort_label', 'api_token', 'heeft_token',
            'customer_id', 'start_datum', 'actief',
            'laatste_controle', 'laatste_resultaat', 'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'heeft_token', 'soort_label',
            'laatste_controle', 'laatste_resultaat', 'created_at', 'updated_at',
        ]

    def get_heeft_token(self, obj) -> bool:
        return bool(obj.api_token)

    def validate_api_token(self, waarde):
        # Een leeg veld bij een wijziging betekent "token ongemoeid laten".
        if not waarde:
            if self.instance is None:
                raise serializers.ValidationError('Geef een Radius API token op.')
            return ''
        if len(waarde) < 20:
            raise serializers.ValidationError('Dit lijkt geen geldig Radius API token.')
        return waarde

    def update(self, instance, validated_data):
        if not validated_data.get('api_token'):
            validated_data.pop('api_token', None)
        return super().update(instance, validated_data)


class RadiusConnectionViewSet(viewsets.ModelViewSet):
    """
    /api/tracking/radius/koppelingen/

    Alleen beheerders. Het token is write-only en wordt versleuteld opgeslagen.
    """
    queryset = RadiusConnection.objects.all()
    serializer_class = RadiusConnectionSerializer
    permission_classes = [IsAdminOnly]
    throttle_classes = [RadiusConnectionThrottle]

    def get_throttles(self):
        # Lezen kost niets; de lijst wordt na elke bewerking opnieuw opgehaald.
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return []
        if self.action in ('test', 'klanten'):
            return [RadiusConnectionTestThrottle()]
        return super().get_throttles()

    def perform_create(self, serializer):
        serializer.save(aangemaakt_door=self.request.user)

    @action(detail=True, methods=['post'])
    def test(self, request, pk=None):
        """Controleer of het token van deze koppeling werkt."""
        koppeling = self.get_object()
        from django.utils import timezone

        try:
            resultaat = test_connection(connection=koppeling)
            melding = 'Verbinding in orde'
            ok = True
        except RadiusError as exc:
            resultaat = None
            melding = str(exc) or 'Verbinding mislukt'
            ok = False
        except Exception:
            logger.exception('Onverwachte fout bij het testen van Radius-koppeling %s', koppeling.pk)
            resultaat = None
            melding = 'Onverwachte fout bij het testen van de verbinding'
            ok = False

        koppeling.laatste_controle = timezone.now()
        koppeling.laatste_resultaat = melding[:255]
        koppeling.save(update_fields=['laatste_controle', 'laatste_resultaat', 'updated_at'])

        return Response(
            {'ok': ok, 'detail': melding, 'resultaat': resultaat},
            status=status.HTTP_200_OK if ok else status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=['get'])
    def klanten(self, request, pk=None):
        """De Radius-klanten die bij dit token horen."""
        koppeling = self.get_object()
        try:
            return Response({'resultaten': get_customers(connection=koppeling)})
        except RadiusError as exc:
            return Response({'detail': str(exc) or 'Klanten ophalen mislukt'},
                            status=status.HTTP_400_BAD_REQUEST)

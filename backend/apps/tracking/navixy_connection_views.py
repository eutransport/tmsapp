"""API voor het beheren van de Navixy-koppeling en de gekoppelde trackers.

De API-sleutel wordt versleuteld opgeslagen en komt nooit terug in een
response; we geven alleen terug of er een sleutel is ingesteld. Alleen
beheerders mogen hier bij.
"""
import logging

from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.permissions import IsAdminOnly

from .models import NavixyConnection, NavixyTracker
from .navixy_service import NavixyError, get_trackers, test_connection
from .security import NavixyConnectionTestThrottle, NavixyConnectionThrottle

logger = logging.getLogger('tracking')


class NavixyTrackerSerializer(serializers.ModelSerializer):
    class Meta:
        model = NavixyTracker
        fields = [
            'id', 'koppeling', 'tracker_id', 'kenteken', 'omschrijving',
            'actief', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_kenteken(self, waarde):
        waarde = (waarde or '').strip().upper()
        if not waarde:
            raise serializers.ValidationError('Geef een kenteken op.')
        return waarde

    def validate_tracker_id(self, waarde):
        if waarde <= 0:
            raise serializers.ValidationError('Een tracker-id is een positief nummer.')
        return waarde

    def validate(self, gegevens):
        # De databasebeperking vangt dit ook af, maar dan krijgt de gebruiker
        # een onbegrijpelijke foutmelding in plaats van een duidelijke.
        koppeling = gegevens.get('koppeling') or getattr(self.instance, 'koppeling', None)
        tracker_id = gegevens.get('tracker_id', getattr(self.instance, 'tracker_id', None))
        if koppeling is not None and tracker_id is not None:
            bestaat = NavixyTracker.objects.filter(
                koppeling=koppeling, tracker_id=tracker_id,
            ).exclude(pk=getattr(self.instance, 'pk', None))
            if bestaat.exists():
                raise serializers.ValidationError(
                    {'tracker_id': 'Deze tracker is al gekoppeld.'}
                )
        return gegevens


class NavixyConnectionSerializer(serializers.ModelSerializer):
    """Koppeling zonder de sleutel; `heeft_sleutel` zegt of er één is ingesteld."""

    api_key = serializers.CharField(
        write_only=True, required=False, allow_blank=True,
        trim_whitespace=True, max_length=512,
        style={'input_type': 'password'},
    )
    heeft_sleutel = serializers.SerializerMethodField()
    trackers = NavixyTrackerSerializer(many=True, read_only=True)

    class Meta:
        model = NavixyConnection
        fields = [
            'id', 'naam', 'api_key', 'heeft_sleutel', 'basis_url', 'actief',
            'laatste_controle', 'laatste_resultaat', 'trackers',
            'created_at', 'updated_at',
        ]
        read_only_fields = [
            'id', 'heeft_sleutel', 'trackers',
            'laatste_controle', 'laatste_resultaat', 'created_at', 'updated_at',
        ]

    def get_heeft_sleutel(self, obj) -> bool:
        return bool(obj.api_key)

    def validate_api_key(self, waarde):
        # Een leeg veld bij een wijziging betekent "sleutel ongemoeid laten".
        if not waarde:
            if self.instance is None:
                raise serializers.ValidationError('Geef een Navixy API-sleutel op.')
            return ''
        if len(waarde) < 16:
            raise serializers.ValidationError('Dit lijkt geen geldige Navixy API-sleutel.')
        return waarde

    def validate_basis_url(self, waarde):
        waarde = (waarde or '').strip()
        if not waarde:
            return 'https://api.navixy.com/v2'
        # Zonder deze controle zou een beheerder de sleutel naar een willekeurige
        # server kunnen laten sturen.
        if not waarde.startswith('https://'):
            raise serializers.ValidationError('Het API-adres moet met https:// beginnen.')
        return waarde.rstrip('/')

    def update(self, instance, validated_data):
        if not validated_data.get('api_key'):
            validated_data.pop('api_key', None)
        return super().update(instance, validated_data)


class NavixyConnectionViewSet(viewsets.ModelViewSet):
    """
    /api/tracking/navixy/koppelingen/

    Alleen beheerders. De sleutel is write-only en wordt versleuteld opgeslagen.
    """
    queryset = NavixyConnection.objects.prefetch_related('trackers').all()
    serializer_class = NavixyConnectionSerializer
    permission_classes = [IsAdminOnly]
    throttle_classes = [NavixyConnectionThrottle]

    def get_throttles(self):
        # Lezen kost niets; de lijst wordt na elke bewerking opnieuw opgehaald.
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return []
        if self.action in ('test', 'beschikbaar'):
            return [NavixyConnectionTestThrottle()]
        return super().get_throttles()

    def perform_create(self, serializer):
        serializer.save(aangemaakt_door=self.request.user)

    def _resultaat_vastleggen(self, koppeling, melding):
        koppeling.laatste_controle = timezone.now()
        koppeling.laatste_resultaat = melding[:255]
        koppeling.save(update_fields=['laatste_controle', 'laatste_resultaat', 'updated_at'])

    @action(detail=True, methods=['post'])
    def test(self, request, pk=None):
        """Controleer of de sleutel van deze koppeling werkt."""
        koppeling = self.get_object()
        try:
            resultaat = test_connection(koppeling)
            melding = f"Verbinding in orde, {resultaat['trackers']} tracker(s) gevonden"
            ok = True
        except NavixyError as fout:
            resultaat = None
            melding = str(fout) or 'Verbinding mislukt'
            ok = False
        except Exception:
            logger.exception('Onverwachte fout bij het testen van Navixy-koppeling %s', koppeling.pk)
            resultaat = None
            melding = 'Onverwachte fout bij het testen van de verbinding'
            ok = False

        self._resultaat_vastleggen(koppeling, melding)
        return Response(
            {'ok': ok, 'detail': melding, 'resultaat': resultaat},
            status=status.HTTP_200_OK if ok else status.HTTP_400_BAD_REQUEST,
        )

    @action(detail=True, methods=['get'])
    def beschikbaar(self, request, pk=None):
        """De trackers die bij deze sleutel horen, om uit te kiezen."""
        koppeling = self.get_object()
        try:
            return Response({'resultaten': get_trackers(koppeling)})
        except NavixyError as fout:
            return Response({'detail': str(fout) or 'Trackers ophalen mislukt'},
                            status=status.HTTP_400_BAD_REQUEST)


class NavixyTrackerViewSet(viewsets.ModelViewSet):
    """
    /api/tracking/navixy/trackers/

    Koppelt een Navixy tracker-nummer aan een kenteken uit het wagenpark.
    """
    queryset = NavixyTracker.objects.select_related('koppeling').all()
    serializer_class = NavixyTrackerSerializer
    permission_classes = [IsAdminOnly]
    throttle_classes = [NavixyConnectionThrottle]

    def get_throttles(self):
        if self.request.method in ('GET', 'HEAD', 'OPTIONS'):
            return []
        return super().get_throttles()

    def get_queryset(self):
        queryset = super().get_queryset()
        koppeling = self.request.query_params.get('koppeling')
        if koppeling:
            queryset = queryset.filter(koppeling_id=koppeling)
        return queryset

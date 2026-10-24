"""
Beheer-API voor geo-blocking. Uitsluitend toegankelijk voor admins.

Deze endpoints zijn bewust vrijgesteld van de geo-middleware, zodat je jezelf
altijd weer kunt binnenlaten als een regel te streng blijkt.
"""
import logging

from django.db.models import Count
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.ip_utils import get_client_ip
from apps.core.permissions import IsAdminOnly

from .models import (
    EnforcementMode,
    GeoAccessLog,
    GeoBlockSettings,
    GeoRule,
    IPRule,
    LogDecision,
    ROLE_CHOICES,
    RuleAction,
)
from .serializers import (
    GeoAccessLogSerializer,
    GeoBlockSettingsSerializer,
    GeoRuleSerializer,
    IPRuleSerializer,
)
from .services import (
    database_available,
    evaluate,
    get_database_path,
    invalidate_rules_cache,
    lookup_country,
    role_for_user,
)

logger = logging.getLogger(__name__)


class GeoBlockSettingsView(APIView):
    """Ophalen en bijwerken van de globale instellingen."""

    permission_classes = [IsAuthenticated, IsAdminOnly]

    def get(self, request):
        config = GeoBlockSettings.load()
        data = GeoBlockSettingsSerializer(config).data
        data['database_beschikbaar'] = database_available()
        data['database_pad'] = get_database_path()
        return Response(data)

    def put(self, request):
        config = GeoBlockSettings.load()
        serializer = GeoBlockSettingsSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        nieuwe = serializer.validated_data
        wil_blokkeren = nieuwe.get('enabled', config.enabled) and (
            nieuwe.get('mode', config.mode) == EnforcementMode.ENFORCE
        )

        # Veiligheidscontrole: sluit de beheerder zichzelf hiermee buiten?
        if wil_blokkeren and not request.data.get('force'):
            probleem = self._zou_zichzelf_blokkeren(request, config, nieuwe)
            if probleem:
                return Response(
                    {
                        'detail': probleem,
                        'code': 'zelf_uitsluiten',
                        'hint': 'Voeg eerst een regel of IP-uitzondering toe, '
                                'of stuur force=true als je dit zeker weet.',
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )

        serializer.save(updated_by=request.user)
        invalidate_rules_cache()
        return Response(GeoBlockSettingsSerializer(GeoBlockSettings.load()).data)

    @staticmethod
    def _zou_zichzelf_blokkeren(request, config, nieuwe):
        """Controleer of de huidige beheerder na deze wijziging nog binnenkomt."""
        bypass = nieuwe.get('allow_superuser_bypass', config.allow_superuser_bypass)
        if bypass and request.user.is_superuser:
            return ''

        # Simuleer de nieuwe instellingen zonder ze op te slaan.
        proef = GeoBlockSettings(
            enabled=True,
            mode=EnforcementMode.ENFORCE,
            default_action=nieuwe.get('default_action', config.default_action),
            block_unknown_country=nieuwe.get('block_unknown_country', config.block_unknown_country),
            allow_superuser_bypass=bypass,
        )
        ip = get_client_ip(request)
        uitkomst = evaluate(ip, role_for_user(request.user), config=proef)
        if uitkomst['allowed']:
            return ''
        land = uitkomst.get('country') or 'onbekend'
        return (
            f'Met deze instelling word je zelf geblokkeerd. Jouw IP is {ip} '
            f'(land: {land}) en de regels wijzen dat af.'
        )


class GeoRuleViewSet(viewsets.ModelViewSet):
    queryset = GeoRule.objects.all()
    serializer_class = GeoRuleSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    pagination_class = None

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
        invalidate_rules_cache()

    def perform_update(self, serializer):
        serializer.save()
        invalidate_rules_cache()

    def perform_destroy(self, instance):
        instance.delete()
        invalidate_rules_cache()


class IPRuleViewSet(viewsets.ModelViewSet):
    queryset = IPRule.objects.all()
    serializer_class = IPRuleSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    pagination_class = None

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)
        invalidate_rules_cache()

    def perform_update(self, serializer):
        serializer.save()
        invalidate_rules_cache()

    def perform_destroy(self, instance):
        instance.delete()
        invalidate_rules_cache()


class GeoAccessLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = GeoAccessLogSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]

    def get_queryset(self):
        qs = GeoAccessLog.objects.select_related('user').all()
        decision = self.request.query_params.get('decision')
        if decision:
            qs = qs.filter(decision=decision)
        land = self.request.query_params.get('country')
        if land:
            qs = qs.filter(country_code=land.upper())
        return qs

    @action(detail=False, methods=['get'])
    def samenvatting(self, request):
        """Tellingen per land en per beslissing over de laatste 7 dagen."""
        sinds = timezone.now() - timezone.timedelta(days=7)
        basis = GeoAccessLog.objects.filter(created_at__gte=sinds)

        per_land = list(
            basis.exclude(decision=LogDecision.ALLOWED)
            .values('country_code')
            .annotate(aantal=Count('id'))
            .order_by('-aantal')[:15]
        )
        per_beslissing = list(
            basis.values('decision').annotate(aantal=Count('id')).order_by('-aantal')
        )
        return Response(
            {
                'periode_dagen': 7,
                'totaal': basis.count(),
                'per_land': per_land,
                'per_beslissing': per_beslissing,
            }
        )

    @action(detail=False, methods=['delete'])
    def opschonen(self, request):
        aantal, _ = GeoAccessLog.objects.all().delete()
        return Response({'verwijderd': aantal})


class GeoStatusView(APIView):
    """
    Toont het IP en land zoals de server die ziet, plus de keuzelijsten.

    Dit is het belangrijkste hulpmiddel om te voorkomen dat je jezelf
    buitensluit: hier zie je precies wat de regels op jou zouden doen.
    """

    permission_classes = [IsAuthenticated, IsAdminOnly]

    def get(self, request):
        config = GeoBlockSettings.load()
        ip = get_client_ip(request)
        rol = role_for_user(request.user)
        uitkomst = evaluate(ip, rol, config=config)

        return Response(
            {
                'jouw_ip': ip,
                'jouw_land': lookup_country(ip),
                'jouw_rol': rol,
                'huidige_uitkomst': {
                    'toegestaan': uitkomst['allowed'],
                    'zou_blokkeren': uitkomst['would_block'],
                    'reden': uitkomst['reason'],
                },
                'database_beschikbaar': database_available(),
                'database_pad': get_database_path(),
                'rollen': [{'waarde': k, 'label': v} for k, v in ROLE_CHOICES],
                'acties': [{'waarde': k, 'label': v} for k, v in RuleAction.choices],
                'modi': [{'waarde': k, 'label': v} for k, v in EnforcementMode.choices],
            }
        )


class GeoTestView(APIView):
    """Proefdraaien: wat zou er gebeuren met dit IP en deze rol?"""

    permission_classes = [IsAuthenticated, IsAdminOnly]

    def post(self, request):
        ip = (request.data.get('ip') or '').strip()
        rol = (request.data.get('rol') or '*').strip()
        if not ip:
            return Response(
                {'detail': 'Geef een IP-adres op.'}, status=status.HTTP_400_BAD_REQUEST
            )

        config = GeoBlockSettings.load()
        # Forceer een realistische beoordeling, ook als alles nu uitstaat.
        proef = GeoBlockSettings(
            enabled=True,
            mode=EnforcementMode.ENFORCE,
            default_action=config.default_action,
            block_unknown_country=config.block_unknown_country,
            allow_superuser_bypass=False,
        )
        uitkomst = evaluate(ip, rol, config=proef)
        return Response(
            {
                'ip': ip,
                'rol': rol,
                'land': uitkomst['country'],
                'toegestaan': uitkomst['allowed'],
                'reden': uitkomst['reason'],
            }
        )

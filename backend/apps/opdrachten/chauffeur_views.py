"""Opdrachten zoals de chauffeur ze ziet en afhandelt."""
from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.drivers.models import Driver

from . import mail
from . import push
from .chauffeur_serializers import (
    AfmeldSerializer,
    BegonnenSerializer,
    ChauffeurOpdrachtSerializer,
    FaseNotitieSerializer,
    NietGeleverdSerializer,
)
from .models import Opdracht, OpdrachtFase, OpdrachtStatus
from .serializers import OpdrachtBijlageSerializer
from .views import _bijlage_opslaan, _eta_regel
from . import eta as eta_module


class MijnOpdrachtenViewSet(viewsets.ReadOnlyModelViewSet):
    """Alleen de opdrachten die aan de ingelogde chauffeur zijn toegewezen."""

    permission_classes = [IsAuthenticated]
    serializer_class = ChauffeurOpdrachtSerializer
    parser_classes = [MultiPartParser, FormParser, *viewsets.ReadOnlyModelViewSet.parser_classes]
    filterset_fields = ['status']
    ordering = ['volgorde', 'created_at']

    def _chauffeur(self):
        chauffeur = Driver.objects.filter(gekoppelde_gebruiker=self.request.user).first()
        if chauffeur is None:
            raise PermissionDenied('Uw account is niet aan een chauffeur gekoppeld.')
        return chauffeur

    def get_queryset(self):
        queryset = (
            Opdracht.objects
            .select_related('bedrijf', 'chauffeur')
            .prefetch_related('bijlagen', 'regels')
            .filter(chauffeur=self._chauffeur())
        )
        # Standaard alleen het werk van nu; ingetrokken opdrachten verdwijnen meteen.
        if self.action == 'list' and not self.request.query_params.get('status'):
            if self.request.query_params.get('archief') in ('1', 'true', 'ja'):
                queryset = queryset.filter(
                    status__in=[OpdrachtStatus.AFGELEVERD, OpdrachtStatus.NIET_GELEVERD]
                ).order_by('-afgeleverd_op', '-niet_geleverd_op', '-updated_at')
            else:
                queryset = queryset.filter(
                    status__in=[OpdrachtStatus.NIEUW, OpdrachtStatus.GESTART]
                )

        zoek = (self.request.query_params.get('search') or '').strip()
        if zoek:
            queryset = queryset.filter(
                Q(ritnummer__icontains=zoek)
                | Q(klant_naam__icontains=zoek)
                | Q(plaats__icontains=zoek)
            )
        return queryset

    def paginate_queryset(self, queryset):
        # De lopende lijst blijft ongepagineerd; het archief groeit eindeloos.
        if self.request.query_params.get('archief') not in ('1', 'true', 'ja'):
            return None
        return super().paginate_queryset(queryset)

    @action(detail=True, methods=['post'])
    def starten(self, request, pk=None):
        opdracht = self.get_object()
        if opdracht.status != OpdrachtStatus.NIEUW:
            raise ValidationError('Deze opdracht kan niet meer gestart worden.')

        chauffeur = self._chauffeur()
        opdracht.status = OpdrachtStatus.GESTART
        opdracht.gestart_op = timezone.now()
        opdracht.kenteken = getattr(chauffeur.voertuig, 'kenteken', '') or ''
        opdracht.eta_start_minuten = None
        opdracht.fase = OpdrachtFase.ONDERWEG
        opdracht.aangekomen_op = None
        opdracht.aangekomen_automatisch = False
        opdracht.wachten_sinds = None
        opdracht.laden_gestart_op = None
        opdracht.lossen_gestart_op = None
        opdracht.save(update_fields=[
            'status', 'gestart_op', 'kenteken', 'eta_start_minuten',
            'fase', 'aangekomen_op', 'aangekomen_automatisch', 'wachten_sinds',
            'laden_gestart_op', 'lossen_gestart_op', 'updated_at'
        ])

        eta_module.ververs([opdracht], geforceerd=True)
        mail.meld_gestart(opdracht)
        push.meld_gestart(opdracht)
        return Response(self.get_serializer(opdracht).data)

    def _notitie_bijwerken(self, opdracht, serializer, velden):
        """Een tussenstap mag altijd een notitie meesturen, net als bij afmelden."""
        reactie = serializer.validated_data.get('chauffeur_reactie')
        if reactie:
            bestaand = (opdracht.chauffeur_reactie or '').strip()
            opdracht.chauffeur_reactie = f'{bestaand}\n{reactie}'.strip() if bestaand else reactie
            velden.append('chauffeur_reactie')

    @action(detail=True, methods=['post'])
    def aangekomen(self, request, pk=None):
        """De chauffeur meldt zelf dat hij bij de klant is."""
        opdracht = self.get_object()
        if opdracht.status != OpdrachtStatus.GESTART:
            raise ValidationError('Deze opdracht is niet onderweg.')
        if opdracht.is_ter_plaatse:
            raise ValidationError('U bent al aangekomen gemeld.')

        serializer = FaseNotitieSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        velden = ['fase', 'aangekomen_op', 'aangekomen_automatisch', 'updated_at']
        opdracht.fase = OpdrachtFase.AANGEKOMEN
        opdracht.aangekomen_op = serializer.validated_data.get('tijdstip') or timezone.now()
        opdracht.aangekomen_automatisch = False
        self._notitie_bijwerken(opdracht, serializer, velden)
        opdracht.save(update_fields=velden)

        push.meld_aangekomen(opdracht)
        return Response(self.get_serializer(opdracht).data)

    @action(detail=True, methods=['post'], url_path='wachten-op-klant')
    def wachten_op_klant(self, request, pk=None):
        opdracht = self.get_object()
        if opdracht.status != OpdrachtStatus.GESTART:
            raise ValidationError('Deze opdracht is niet onderweg.')
        if not opdracht.is_ter_plaatse:
            raise ValidationError('Meld eerst dat u bij de klant bent.')
        if opdracht.fase == OpdrachtFase.WACHTEN:
            raise ValidationError('U staat al als wachtend genoteerd.')

        serializer = FaseNotitieSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        velden = ['fase', 'wachten_sinds', 'updated_at']
        opdracht.fase = OpdrachtFase.WACHTEN
        opdracht.wachten_sinds = serializer.validated_data.get('tijdstip') or timezone.now()
        self._notitie_bijwerken(opdracht, serializer, velden)
        opdracht.save(update_fields=velden)

        push.meld_wachten(opdracht)
        return Response(self.get_serializer(opdracht).data)

    @action(detail=True, methods=['post'])
    def begonnen(self, request, pk=None):
        """Begonnen met laden of lossen; de soort moet bij het werk van de opdracht passen."""
        opdracht = self.get_object()
        if opdracht.status != OpdrachtStatus.GESTART:
            raise ValidationError('Deze opdracht is niet onderweg.')
        if not opdracht.is_ter_plaatse:
            raise ValidationError('Meld eerst dat u bij de klant bent.')

        serializer = BegonnenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        soort = serializer.validated_data.get('soort')
        if soort is None:
            # Bij maar één werksoort hoeft de chauffeur niets te kiezen.
            soort = 'laden' if opdracht.werk_laden and not opdracht.werk_lossen else 'lossen'
        if soort == 'laden' and not opdracht.werk_laden:
            raise ValidationError('Bij deze opdracht hoeft niet geladen te worden.')
        if soort == 'lossen' and not opdracht.werk_lossen:
            raise ValidationError('Bij deze opdracht hoeft niet gelost te worden.')

        nu = serializer.validated_data.get('tijdstip') or timezone.now()
        velden = ['fase', 'updated_at']
        if soort == 'laden':
            opdracht.fase = OpdrachtFase.BEZIG_LADEN
            opdracht.laden_gestart_op = nu
            velden.append('laden_gestart_op')
        else:
            opdracht.fase = OpdrachtFase.BEZIG_LOSSEN
            opdracht.lossen_gestart_op = nu
            velden.append('lossen_gestart_op')
        self._notitie_bijwerken(opdracht, serializer, velden)
        opdracht.save(update_fields=velden)

        push.meld_begonnen(opdracht, soort)
        return Response(self.get_serializer(opdracht).data)

    @action(detail=False, methods=['get'])
    def eta(self, request):
        lopend = list(
            Opdracht.objects
            .select_related('chauffeur__voertuig')
            .filter(chauffeur=self._chauffeur(), status=OpdrachtStatus.GESTART)
        )
        eta_module.ververs(lopend)
        return Response([_eta_regel(o) for o in lopend])

    @action(detail=True, methods=['post'])
    def afmelden(self, request, pk=None):
        opdracht = self.get_object()
        if opdracht.status not in (OpdrachtStatus.NIEUW, OpdrachtStatus.GESTART):
            raise ValidationError('Deze opdracht is al afgehandeld.')
        if not opdracht.is_bezig:
            werk = {'laden': 'laden', 'lossen': 'lossen'}.get(
                opdracht.werksoort, 'laden of lossen'
            )
            raise ValidationError(
                f'Meld eerst dat u bent aangekomen en begonnen bent met {werk}.'
            )

        serializer = AfmeldSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        opdracht.status = OpdrachtStatus.AFGELEVERD
        opdracht.afgeleverd_op = serializer.validated_data.get('afgeleverd_op') or timezone.now()
        reactie = serializer.validated_data.get('chauffeur_reactie')
        if reactie is not None:
            opdracht.chauffeur_reactie = reactie
        if not opdracht.kenteken:
            opdracht.kenteken = getattr(self._chauffeur().voertuig, 'kenteken', '') or ''
        opdracht.save(update_fields=[
            'status', 'afgeleverd_op', 'chauffeur_reactie', 'kenteken', 'updated_at'
        ])

        mail.meld_afgeleverd(opdracht)
        push.meld_afgeleverd(opdracht)
        return Response(self.get_serializer(opdracht).data)

    @action(detail=True, methods=['post'], url_path='niet-geleverd')
    def niet_geleverd(self, request, pk=None):
        opdracht = self.get_object()
        if opdracht.status not in (OpdrachtStatus.NIEUW, OpdrachtStatus.GESTART):
            raise ValidationError('Deze opdracht is al afgehandeld.')

        serializer = NietGeleverdSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        opdracht.status = OpdrachtStatus.NIET_GELEVERD
        opdracht.niet_geleverd_op = (
            serializer.validated_data.get('niet_geleverd_op') or timezone.now()
        )
        opdracht.niet_geleverd_reden = serializer.validated_data['niet_geleverd_reden']
        if not opdracht.kenteken:
            opdracht.kenteken = getattr(self._chauffeur().voertuig, 'kenteken', '') or ''
        opdracht.save(update_fields=[
            'status', 'niet_geleverd_op', 'niet_geleverd_reden', 'kenteken', 'updated_at'
        ])

        mail.meld_niet_geleverd(opdracht)
        push.meld_niet_geleverd(opdracht)
        return Response(self.get_serializer(opdracht).data)

    @action(detail=True, methods=['post'])
    def reactie(self, request, pk=None):
        opdracht = self.get_object()
        if opdracht.status == OpdrachtStatus.INGETROKKEN:
            raise ValidationError('Deze opdracht is ingetrokken.')

        opdracht.chauffeur_reactie = str(request.data.get('chauffeur_reactie', ''))[:5000]
        opdracht.save(update_fields=['chauffeur_reactie', 'updated_at'])
        return Response(self.get_serializer(opdracht).data)

    @action(detail=True, methods=['post'], url_path='bijlagen')
    def bijlage_toevoegen(self, request, pk=None):
        opdracht = self.get_object()
        if opdracht.status == OpdrachtStatus.INGETROKKEN:
            raise ValidationError('Deze opdracht is ingetrokken.')
        bijlage = _bijlage_opslaan(opdracht, request)
        return Response(
            OpdrachtBijlageSerializer(bijlage).data, status=status.HTTP_201_CREATED
        )

"""API voor het opdrachtgeversportaal en de beheerdersinzage."""
from django.db import transaction
from django.db.models import Case, Count, IntegerField, OuterRef, Subquery, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.permissions import IsAdminOrManagerStrict, IsOpdrachtgever
from apps.drivers.models import Driver

from . import eta as eta_module
from . import mail
from .models import (
    Opdracht,
    OpdrachtBijlage,
    OpdrachtKlant,
    OpdrachtMailInstelling,
    OpdrachtStatus,
    volgend_ritnummer,
)
from .serializers import (
    ChauffeurKeuzeSerializer,
    OpdrachtBijlageSerializer,
    OpdrachtKlantSerializer,
    OpdrachtMailInstellingSerializer,
    OpdrachtSerializer,
    OpdrachtVolgordeSerializer,
)

MAX_BIJLAGE_BYTES = 10 * 1024 * 1024

TOEGESTANE_EXTENSIES = (
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif',
    '.pdf', '.xls', '.xlsx', '.xlsm', '.csv',
)
TOEGESTANE_MIMETYPES = (
    'image/',
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel.sheet.macroenabled.12',
    'text/csv',
)


def _eta_regel(opdracht):
    return {
        'id': str(opdracht.id),
        'eta_aankomst': opdracht.eta_aankomst,
        'eta_minuten': opdracht.eta_minuten,
        'eta_start_minuten': opdracht.eta_start_minuten,
        'eta_afstand_km': opdracht.eta_afstand_km,
        'eta_bijgewerkt_op': opdracht.eta_bijgewerkt_op,
        'eta_fout': opdracht.eta_fout,
    }


def _basis_queryset():
    return (
        Opdracht.objects
        .select_related('bedrijf', 'chauffeur', 'aangemaakt_door')
        .prefetch_related('bijlagen')
    )


class PortaalOpdrachtViewSet(viewsets.ModelViewSet):
    """Opdrachten van de ingelogde opdrachtgever."""

    permission_classes = [IsAuthenticated, IsOpdrachtgever]
    serializer_class = OpdrachtSerializer
    parser_classes = [MultiPartParser, FormParser, *viewsets.ModelViewSet.parser_classes]
    filterset_fields = ['status', 'chauffeur']
    search_fields = ['klant_naam', 'plaats', 'adres', 'contactpersoon']
    ordering_fields = ['volgorde', 'created_at', 'afgeleverd_op', 'status']
    # Geen vaste ordering: get_queryset bepaalt de volgorde zelf.
    ordering = None

    @property
    def bedrijf_id(self):
        return self.request.user.opdrachtgever_bedrijf_id

    def get_queryset(self):
        queryset = _basis_queryset().filter(bedrijf_id=self.bedrijf_id)
        params = self.request.query_params
        vandaag = timezone.localdate()

        if params.get('vandaag') == 'aangemaakt':
            queryset = queryset.filter(created_at__date=vandaag)
        elif params.get('vandaag') == 'afgeleverd':
            queryset = queryset.filter(afgeleverd_op__date=vandaag)

        if params.get('open') == '1':
            queryset = queryset.filter(
                status__in=[OpdrachtStatus.NIEUW, OpdrachtStatus.GESTART]
            )
        if params.get('klant'):
            queryset = queryset.filter(klant_naam__iexact=params['klant'].strip())

        # Onderweg gaat voor; daarbinnen telt de handmatige volgorde, die voor
        # nieuwe opdrachten bovenaan begint.
        return queryset.annotate(
            voorrang=Case(
                When(status=OpdrachtStatus.GESTART, then=Value(0)),
                default=Value(1),
                output_field=IntegerField(),
            )
        ).order_by('voorrang', 'volgorde', '-created_at')

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['bedrijf_id'] = self.bedrijf_id
        return context

    @action(detail=False, methods=['get'], url_path='volgend-ritnummer')
    def ritnummer_voorstel(self, request):
        return Response({'ritnummer': volgend_ritnummer()})

    @action(detail=False, methods=['get'])
    def eta(self, request):
        """Ververst hooguit eens per tien minuten en geeft de stand per opdracht."""
        lopend = list(
            Opdracht.objects
            .select_related('chauffeur__voertuig')
            .filter(bedrijf_id=self.bedrijf_id, status=OpdrachtStatus.GESTART)
        )
        eta_module.ververs(lopend)
        return Response([_eta_regel(o) for o in lopend])

    def perform_create(self, serializer):
        eerste = (
            Opdracht.objects.filter(bedrijf_id=self.bedrijf_id)
            .order_by('volgorde').values_list('volgorde', flat=True).first()
        )
        opdracht = serializer.save(
            bedrijf_id=self.bedrijf_id,
            aangemaakt_door=self.request.user,
            volgorde=(eerste or 1) - 1,
        )
        _klant_bijwerken(opdracht)

    def _weiger_als_afgehandeld(self, opdracht):
        if opdracht.status in (
            OpdrachtStatus.AFGELEVERD,
            OpdrachtStatus.NIET_GELEVERD,
            OpdrachtStatus.INGETROKKEN,
        ):
            raise ValidationError('Deze opdracht is al afgehandeld.')

    def perform_update(self, serializer):
        self._weiger_als_afgehandeld(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        # Verwijderen mag ook na afloop; de opdrachtgever bevestigt dat in het scherm.
        instance.delete()

    @action(detail=True, methods=['post'])
    def intrekken(self, request, pk=None):
        opdracht = self.get_object()
        self._weiger_als_afgehandeld(opdracht)
        opdracht.status = OpdrachtStatus.INGETROKKEN
        opdracht.ingetrokken_op = timezone.now()
        opdracht.save(update_fields=['status', 'ingetrokken_op', 'updated_at'])
        return Response(self.get_serializer(opdracht).data)

    @action(detail=True, methods=['post'], url_path='mail-opnieuw')
    def mail_opnieuw(self, request, pk=None):
        opdracht = self.get_object()
        gelukt = mail.opnieuw_versturen(opdracht)
        opdracht.refresh_from_db()
        return Response({
            'verstuurd': bool(gelukt),
            'fout': opdracht.laatste_mail_fout,
            'opdracht': self.get_serializer(opdracht).data,
        })

    @action(detail=False, methods=['post'])
    def rangschikken(self, request):
        serializer = OpdrachtVolgordeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data['volgorde']

        eigen = dict(
            Opdracht.objects.filter(bedrijf_id=self.bedrijf_id, id__in=ids)
            .values_list('id', 'id')
        )
        if len(eigen) != len(set(ids)):
            raise ValidationError('Niet alle opdrachten horen bij uw bedrijf.')

        with transaction.atomic():
            for positie, opdracht_id in enumerate(ids, start=1):
                Opdracht.objects.filter(id=opdracht_id).update(volgorde=positie)
        return Response({'bijgewerkt': len(ids)})

    @action(detail=True, methods=['post'], url_path='bijlagen')
    def bijlage_toevoegen(self, request, pk=None):
        opdracht = self.get_object()
        # Bijlagen mogen ook na afloop nog; alleen een ingetrokken opdracht is dicht.
        if opdracht.status == OpdrachtStatus.INGETROKKEN:
            raise ValidationError('Deze opdracht is ingetrokken.')
        bijlage = _bijlage_opslaan(opdracht, request)
        return Response(
            OpdrachtBijlageSerializer(bijlage).data, status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=['get'])
    def chauffeurs(self, request):
        chauffeurs = Driver.objects.filter(bedrijf_id=self.bedrijf_id).order_by('naam')
        return Response(ChauffeurKeuzeSerializer(chauffeurs, many=True).data)

    @action(detail=False, methods=['get', 'patch'], url_path='mailinstelling')
    def mailinstelling(self, request):
        instelling, _ = OpdrachtMailInstelling.objects.get_or_create(
            bedrijf_id=self.bedrijf_id
        )
        if request.method == 'GET':
            return Response(OpdrachtMailInstellingSerializer(instelling).data)

        serializer = OpdrachtMailInstellingSerializer(
            instelling, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


def _bijlage_opslaan(opdracht, request):
    bestand = request.FILES.get('bestand')
    if not bestand:
        raise ValidationError({'bestand': 'Geen bestand ontvangen.'})
    if bestand.size > MAX_BIJLAGE_BYTES:
        raise ValidationError({'bestand': 'Bestand is groter dan 10 MB.'})

    naam = (bestand.name or '').lower()
    mimetype = (getattr(bestand, 'content_type', '') or '').lower()
    if not naam.endswith(TOEGESTANE_EXTENSIES) or (
        mimetype and not mimetype.startswith(TOEGESTANE_MIMETYPES)
    ):
        raise ValidationError(
            {'bestand': 'Alleen afbeeldingen, PDF- of Excel-bestanden zijn toegestaan.'}
        )

    return OpdrachtBijlage.objects.create(
        opdracht=opdracht,
        bestand=bestand,
        bestandsnaam=bestand.name[:255],
        geupload_door=request.user,
    )


def _klant_bijwerken(opdracht):
    """Nieuwe klantnaam belandt vanzelf in het adresboek; bestaande blijft ongemoeid."""
    naam = (opdracht.klant_naam or '').strip()
    if not naam:
        return
    OpdrachtKlant.objects.get_or_create(
        bedrijf_id=opdracht.bedrijf_id,
        naam=naam,
        defaults={
            'adres': opdracht.adres,
            'postcode': opdracht.postcode,
            'plaats': opdracht.plaats,
            'contactpersoon': opdracht.contactpersoon,
            'telefoon': opdracht.telefoon,
            'geopend_tot': opdracht.geopend_tot,
        },
    )


class PortaalKlantViewSet(viewsets.ModelViewSet):
    """Het eigen adresboek van de opdrachtgever."""

    permission_classes = [IsAuthenticated, IsOpdrachtgever]
    serializer_class = OpdrachtKlantSerializer
    search_fields = ['naam', 'plaats', 'adres', 'contactpersoon']
    ordering_fields = ['naam', 'plaats', 'created_at']
    ordering = ['naam']

    @property
    def bedrijf_id(self):
        return self.request.user.opdrachtgever_bedrijf_id

    def get_queryset(self):
        aantal = (
            Opdracht.objects
            .filter(bedrijf_id=OuterRef('bedrijf_id'), klant_naam__iexact=OuterRef('naam'))
            .values('bedrijf_id')
            .annotate(n=Count('id'))
            .values('n')
        )
        return (
            OpdrachtKlant.objects
            .filter(bedrijf_id=self.bedrijf_id)
            .annotate(aantal_opdrachten=Coalesce(Subquery(aantal, output_field=IntegerField()), 0))
        )

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context['bedrijf_id'] = self.bedrijf_id
        return context

    def perform_create(self, serializer):
        serializer.save(bedrijf_id=self.bedrijf_id)


class BeheerOpdrachtViewSet(viewsets.ReadOnlyModelViewSet):
    """Alle opdrachten van alle opdrachtgevers, voor kantoor en beheer."""

    permission_classes = [IsAuthenticated, IsAdminOrManagerStrict]
    serializer_class = OpdrachtSerializer
    queryset = _basis_queryset()
    filterset_fields = ['status', 'chauffeur', 'bedrijf']
    search_fields = ['klant_naam', 'plaats', 'adres', 'contactpersoon', 'bedrijf__naam']
    ordering_fields = ['created_at', 'afgeleverd_op', 'status', 'volgorde']
    ordering = ['-created_at']

"""Views voor dossiers."""
import logging
import os
from django.core.mail import EmailMessage, get_connection
from django.db.models import Q
from django.http import FileResponse
from django.shortcuts import get_object_or_404

from apps.core.models import AppSettings
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser

from .models import DossierType, Dossier, DossierReactie, DossierBijlage, Organisatie, Contactpersoon, DossierMailLog
from .serializers import (
    DossierTypeSerializer,
    DossierListSerializer,
    DossierDetailSerializer,
    DossierCreateSerializer,
    DossierReactieSerializer,
    DossierBijlageSerializer,
    OrganisatieSerializer,
    OrganisatieListSerializer,
    ContactpersoonSerializer,
)

logger = logging.getLogger(__name__)

PAGE_SIZE = 15


def _is_dossier_manager(user):
    """True for admin or users with manage_dossiers permission."""
    return user.is_admin or user.has_module_permission('manage_dossiers')


class DossierTypeViewSet(viewsets.ModelViewSet):
    """CRUD voor dossiertypen (alleen beheerders)."""
    serializer_class = DossierTypeSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Altijd volledige lijst teruggeven (geen paginering)

    def get_queryset(self):
        return DossierType.objects.all()

    def _check_manager(self, request):
        if not _is_dossier_manager(request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Geen toegang.")

    def list(self, request, *args, **kwargs):
        if not _is_dossier_manager(request.user):
            qs = DossierType.objects.filter(actief=True)
            return Response(DossierTypeSerializer(qs, many=True).data)
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._check_manager(request)
        instance = self.get_object()
        if instance.dossiers.exists():
            instance.actief = False
            instance.save()
            return Response({'detail': 'Type is in gebruik en wordt gedeactiveerd.'}, status=status.HTTP_200_OK)
        instance.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DossierViewSet(viewsets.ModelViewSet):
    """CRUD voor dossiers."""
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        user = self.request.user
        if _is_dossier_manager(user):
            qs = Dossier.objects.select_related(
                'type', 'instuurder', 'betreft_user', 'betreft_chauffeur'
            ).prefetch_related('bijlagen', 'reacties')
        elif user.is_chauffeur:
            qs = Dossier.objects.select_related(
                'type', 'instuurder', 'betreft_user', 'betreft_chauffeur'
            ).prefetch_related('bijlagen', 'reacties').filter(betreft_chauffeur=user)
        else:
            qs = Dossier.objects.none()

        type_id = self.request.query_params.get('type')
        if type_id:
            qs = qs.filter(type_id=type_id)

        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(onderwerp__icontains=search)

        return qs

    def get_serializer_class(self):
        if self.action == 'list':
            return DossierListSerializer
        if self.action == 'create':
            return DossierCreateSerializer
        return DossierDetailSerializer

    def _check_manager(self, request):
        if not _is_dossier_manager(request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Geen toegang.")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        try:
            page = max(1, int(request.query_params.get('page', 1)))
        except (ValueError, TypeError):
            page = 1
        start = (page - 1) * PAGE_SIZE
        end = start + PAGE_SIZE
        total = qs.count()
        items = qs[start:end]
        serializer = DossierListSerializer(items, many=True, context={'request': request})
        return Response({
            'count': total,
            'page': page,
            'page_size': PAGE_SIZE,
            'total_pages': max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE),
            'results': serializer.data,
        })

    def create(self, request, *args, **kwargs):
        self._check_manager(request)
        serializer = DossierCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        dossier = serializer.save(instuurder=request.user)

        files = request.FILES.getlist('bijlagen')
        for f in files:
            DossierBijlage.objects.create(
                dossier=dossier,
                bestand=f,
                bestandsnaam=f.name,
                mimetype=f.content_type or '',
                grootte=f.size,
                geupload_door=request.user,
            )

        return Response(DossierDetailSerializer(dossier, context={'request': request}).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        serializer = DossierDetailSerializer(instance, context={'request': request})
        return Response(serializer.data)

    def update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post', 'get'], url_path='reacties', parser_classes=[MultiPartParser, FormParser, JSONParser])
    def reacties(self, request, pk=None):
        if request.method == 'GET':
            return self._list_reacties(request, pk)
        return self._add_reactie(request, pk)

    def _list_reacties(self, request, pk=None):
        dossier = self.get_object()
        qs = dossier.reacties.all()
        if not _is_dossier_manager(request.user):
            qs = qs.filter(intern=False)
        return Response(DossierReactieSerializer(qs, many=True, context={'request': request}).data)

    def _add_reactie(self, request, pk=None):
        dossier = self.get_object()
        tekst = request.data.get('tekst', '').strip()
        if not tekst:
            return Response({'tekst': 'Dit veld is verplicht.'}, status=status.HTTP_400_BAD_REQUEST)

        intern = False
        if _is_dossier_manager(request.user):
            intern = str(request.data.get('intern', 'false')).lower() in ('true', '1', 'yes')

        reactie = DossierReactie.objects.create(
            dossier=dossier,
            auteur=request.user,
            tekst=tekst,
            intern=intern,
        )

        files = request.FILES.getlist('bijlagen')
        for f in files:
            DossierBijlage.objects.create(
                reactie=reactie,
                bestand=f,
                bestandsnaam=f.name,
                mimetype=f.content_type or '',
                grootte=f.size,
                geupload_door=request.user,
            )

        return Response(DossierReactieSerializer(reactie, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='bijlagen', parser_classes=[MultiPartParser, FormParser])
    def upload_bijlage(self, request, pk=None):
        self._check_manager(request)
        dossier = self.get_object()
        files = request.FILES.getlist('bijlagen')
        if not files:
            return Response({'error': 'Geen bestand(en) meegestuurd.'}, status=status.HTTP_400_BAD_REQUEST)
        created = []
        for f in files:
            bijlage = DossierBijlage.objects.create(
                dossier=dossier,
                bestand=f,
                bestandsnaam=f.name,
                mimetype=f.content_type or '',
                grootte=f.size,
                geupload_door=request.user,
            )
            created.append(bijlage)
        return Response(DossierBijlageSerializer(created, many=True, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path=r'bijlagen/(?P<bijlage_id>[^/.]+)/download')
    def download_bijlage(self, request, pk=None, bijlage_id=None):
        """Download a dossier or reactie attachment.

        Access is granted to anyone who can retrieve the parent dossier
        (managers always, drivers for their own dossiers).
        """
        dossier = self.get_object()  # uses get_queryset → enforces access rules
        bijlage = get_object_or_404(
            DossierBijlage.objects.filter(
                Q(dossier=dossier) | Q(reactie__dossier=dossier)
            ),
            pk=bijlage_id,
        )

        # Hide internal reactie attachments from non-managers
        if bijlage.reactie and bijlage.reactie.intern and not _is_dossier_manager(request.user):
            return Response({'detail': 'Geen toegang.'}, status=status.HTTP_403_FORBIDDEN)

        if not bijlage.bestand:
            return Response({'detail': 'Geen bestand.'}, status=status.HTTP_404_NOT_FOUND)

        response = FileResponse(
            bijlage.bestand.open('rb'),
            filename=bijlage.bestandsnaam or os.path.basename(bijlage.bestand.name),
            content_type=bijlage.mimetype or 'application/octet-stream',
        )
        return response

    @action(detail=True, methods=['post'], url_path='stuur-mail', parser_classes=[MultiPartParser, FormParser, JSONParser])
    def stuur_mail(self, request, pk=None):
        """Stuur een e-mail vanuit het dossier."""
        self._check_manager(request)
        dossier = self.get_object()

        def _getlist(data, key):
            if hasattr(data, 'getlist'):
                return data.getlist(key)
            val = data.get(key, [])
            return val if isinstance(val, list) else [val] if val else []

        ontvangers = _getlist(request.data, 'ontvangers')
        handmatig = _getlist(request.data, 'handmatig')
        onderwerp = request.data.get('onderwerp', dossier.onderwerp)
        inhoud = request.data.get('inhoud', dossier.inhoud)
        type_id = request.data.get('type') or None
        bijlage_ids = _getlist(request.data, 'bijlage_ids')
        extra_bijlagen = request.FILES.getlist('extra_bijlagen')

        # Combine contactpersoon IDs with manual addresses
        email_adressen = list(handmatig)

        if ontvangers:
            contacten = Contactpersoon.objects.filter(id__in=ontvangers)
            email_adressen += [c.email for c in contacten]

        # Deduplicate and validate
        email_adressen = list(dict.fromkeys(e.strip() for e in email_adressen if e.strip()))

        if not email_adressen:
            return Response({'error': 'Geen ontvangers opgegeven.'}, status=status.HTTP_400_BAD_REQUEST)

        if not onderwerp.strip():
            return Response({'error': 'Onderwerp is verplicht.'}, status=status.HTTP_400_BAD_REQUEST)

        # Resolve type
        mail_type = None
        if type_id:
            try:
                mail_type = DossierType.objects.get(pk=type_id)
            except DossierType.DoesNotExist:
                return Response({'error': 'Opgegeven type bestaat niet.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            app_settings = AppSettings.get_settings()

            if not app_settings.smtp_host:
                return Response(
                    {'error': 'SMTP instellingen zijn niet geconfigureerd. Ga naar Instellingen om e-mail te configureren.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            smtp_username = (app_settings.smtp_username or '').strip()
            from_email = (app_settings.smtp_from_email or app_settings.smtp_username or '').strip()

            connection = get_connection(
                host=app_settings.smtp_host,
                port=app_settings.smtp_port,
                username=smtp_username,
                password=app_settings.smtp_password or '',
                use_tls=app_settings.smtp_use_tls,
                fail_silently=False,
            )

            email = EmailMessage(
                subject=onderwerp,
                body=inhoud,
                from_email=from_email,
                to=email_adressen,
                connection=connection,
            )

            # Bestaande dossier-bijlagen
            for bijlage_id in bijlage_ids:
                try:
                    bijlage = DossierBijlage.objects.get(pk=bijlage_id, dossier=dossier)
                    with bijlage.bestand.open('rb') as fh:
                        content = fh.read()
                    email.attach(bijlage.bestandsnaam, content, bijlage.mimetype or 'application/octet-stream')
                except DossierBijlage.DoesNotExist:
                    pass  # skip ongeldige ID's

            # Extra geüploade bijlagen
            for f in extra_bijlagen:
                email.attach(f.name, f.read(), f.content_type or 'application/octet-stream')

            email.send(fail_silently=False)
        except Exception as exc:
            logger.error("Fout bij verzenden dossiermail: %s", exc)
            return Response({'error': 'Mail kon niet worden verzonden. Controleer de mailconfiguratie.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Log the mail
        DossierMailLog.objects.create(
            dossier=dossier,
            verzonden_door=request.user,
            ontvangers=', '.join(email_adressen),
            onderwerp=onderwerp,
            type=mail_type,
        )

        return Response({'detail': f'Mail verzonden naar {len(email_adressen)} ontvanger(s).'}, status=status.HTTP_200_OK)


class OrganisatieViewSet(viewsets.ModelViewSet):
    """CRUD voor organisaties / leveranciers."""
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Altijd volledige lijst teruggeven

    def get_queryset(self):
        return Organisatie.objects.prefetch_related('contactpersonen').all()

    def get_serializer_class(self):
        if self.action == 'list':
            return OrganisatieListSerializer
        return OrganisatieSerializer

    def _check_manager(self, request):
        if not _is_dossier_manager(request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Geen toegang.")

    def create(self, request, *args, **kwargs):
        self._check_manager(request)
        serializer = OrganisatieSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        organisatie = serializer.save()

        # Optionally create contactpersonen in one call
        contactpersonen_data = request.data.get('contactpersonen', [])
        if isinstance(contactpersonen_data, list):
            for cp_data in contactpersonen_data:
                cp_ser = ContactpersoonSerializer(data={**cp_data, 'organisatie': str(organisatie.id)})
                if cp_ser.is_valid():
                    cp_ser.save()

        return Response(OrganisatieSerializer(organisatie).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().destroy(request, *args, **kwargs)


class ContactpersoonViewSet(viewsets.ModelViewSet):
    """CRUD voor contactpersonen."""
    serializer_class = ContactpersoonSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None  # Altijd volledige lijst teruggeven

    def get_queryset(self):
        qs = Contactpersoon.objects.select_related('organisatie').all()
        organisatie_id = self.request.query_params.get('organisatie')
        if organisatie_id:
            qs = qs.filter(organisatie_id=organisatie_id)
        return qs

    def _check_manager(self, request):
        if not _is_dossier_manager(request.user):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Geen toegang.")

    def create(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        self._check_manager(request)
        return super().destroy(request, *args, **kwargs)

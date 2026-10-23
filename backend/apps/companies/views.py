import logging
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from apps.core.permissions import IsAdminOrManager, HasModulePermission
from .models import Company, HerinneringInstelling, MailingListContact
from .serializers import (
    CompanySerializer,
    HerinneringInstellingSerializer,
    MailingListContactSerializer,
)

logger = logging.getLogger('accounts.security')


class CompanyViewSet(viewsets.ModelViewSet):
    """
    ViewSet for Company CRUD operations.
    - Admin/Gebruiker: Full CRUD access
    - Chauffeur: Read-only access
    """
    queryset = Company.objects.prefetch_related('mailing_contacts').select_related(
        'herinnering_instelling'
    ).all()
    serializer_class = CompanySerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager, HasModulePermission]
    module_permission = 'view_companies'
    search_fields = ['naam', 'kvk', 'contactpersoon', 'email']
    ordering_fields = ['naam', 'stad', 'created_at']
    ordering = ['naam']

    @action(detail=True, methods=['get', 'patch'], url_path='herinneringen')
    def herinneringen(self, request, pk=None):
        """Instelling voor automatische betalingsherinneringen van dit bedrijf."""
        bedrijf = self.get_object()
        instelling, _ = HerinneringInstelling.objects.get_or_create(bedrijf=bedrijf)

        if request.method == 'GET':
            return Response(HerinneringInstellingSerializer(instelling).data)

        serializer = HerinneringInstellingSerializer(
            instelling, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        logger.info(
            f"Herinneringen {bedrijf.naam}: actief={instelling.actief} "
            f"interval={instelling.interval_dagen} aantal={instelling.max_herinneringen} "
            f"door {request.user.email}"
        )
        return Response(serializer.data)
    
    def perform_create(self, serializer):
        company = serializer.save()
        logger.info(
            f"Company created: {company.naam} (ID: {company.id}) by {self.request.user.email}"
        )
    
    def perform_update(self, serializer):
        company = serializer.save()
        logger.info(
            f"Company updated: {company.naam} (ID: {company.id}) by {self.request.user.email}"
        )
    
    def perform_destroy(self, instance):
        logger.warning(
            f"Company deleted: {instance.naam} (ID: {instance.id}) by {self.request.user.email}"
        )
        instance.delete()


class MailingListContactViewSet(viewsets.ModelViewSet):
    """
    ViewSet for MailingListContact CRUD operations.
    Contacts are linked to a company for invoice mailing.
    """
    queryset = MailingListContact.objects.select_related('bedrijf').all()
    serializer_class = MailingListContactSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['bedrijf', 'is_active']
    search_fields = ['naam', 'email', 'functie']
    ordering_fields = ['naam', 'email', 'created_at']
    ordering = ['naam']

    def perform_create(self, serializer):
        contact = serializer.save()
        logger.info(
            f"MailingList contact created: {contact.naam} <{contact.email}> "
            f"for {contact.bedrijf.naam} by {self.request.user.email}"
        )

    def perform_update(self, serializer):
        contact = serializer.save()
        logger.info(
            f"MailingList contact updated: {contact.naam} <{contact.email}> "
            f"for {contact.bedrijf.naam} by {self.request.user.email}"
        )

    def perform_destroy(self, instance):
        logger.warning(
            f"MailingList contact deleted: {instance.naam} <{instance.email}> "
            f"for {instance.bedrijf.naam} by {self.request.user.email}"
        )
        instance.delete()

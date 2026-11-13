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
    HerinneringVersturenSerializer,
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

    def _herinnering_data(self, bedrijf, instelling):
        from apps.invoicing.models import FactuurHerinnering
        from apps.invoicing.tasks import openstaande_facturen

        data = dict(HerinneringInstellingSerializer(instelling).data)
        data['mailinglijst'] = [
            {'naam': c.naam, 'email': c.email}
            for c in bedrijf.mailing_contacts.filter(is_active=True).exclude(email='')
        ]
        data['bedrijf_email'] = bedrijf.email or ''

        facturen = list(openstaande_facturen(bedrijf))
        laatste = {}
        for h in (
            FactuurHerinnering.objects
            .filter(invoice__in=facturen, gelukt=True)
            .order_by('verstuurd_op')
        ):
            laatste[h.invoice_id] = h.verstuurd_op
        data['te_laat'] = [
            {
                'id': str(f.id),
                'factuurnummer': f.factuurnummer,
                'vervaldatum': f.vervaldatum,
                'totaal': str(f.totaal),
                'laatste_herinnering': laatste.get(f.id),
            }
            for f in facturen
        ]
        return data

    @action(detail=True, methods=['get', 'patch'], url_path='herinneringen')
    def herinneringen(self, request, pk=None):
        """Instelling voor automatische betalingsherinneringen van dit bedrijf."""
        bedrijf = self.get_object()
        instelling, _ = HerinneringInstelling.objects.get_or_create(bedrijf=bedrijf)

        if request.method == 'GET':
            return Response(self._herinnering_data(bedrijf, instelling))

        serializer = HerinneringInstellingSerializer(
            instelling, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        logger.info(
            f"Herinneringen {bedrijf.naam}: actief={instelling.actief} "
            f"interval={instelling.interval_dagen} aantal={instelling.max_herinneringen} "
            f"ontvangers={instelling.ontvangers} door {request.user.email}"
        )
        return Response(self._herinnering_data(bedrijf, instelling))

    @action(detail=True, methods=['post'], url_path='herinneringen/versturen')
    def herinneringen_versturen(self, request, pk=None):
        """Direct een betalingsherinnering sturen voor de te late facturen."""
        from apps.invoicing.tasks import verstuur_handmatig

        bedrijf = self.get_object()
        invoer = HerinneringVersturenSerializer(data=request.data)
        invoer.is_valid(raise_exception=True)
        ontvangers = list(dict.fromkeys(invoer.validated_data['ontvangers']))
        factuur_ids = invoer.validated_data.get('facturen') or None

        uitkomst = verstuur_handmatig(bedrijf, ontvangers, factuur_ids)
        logger.info(
            f"Handmatige herinnering {bedrijf.naam} naar {ontvangers}: "
            f"verstuurd={uitkomst['verstuurd']} fouten={len(uitkomst['fouten'])} "
            f"door {request.user.email}"
        )
        if not uitkomst['verstuurd'] and not uitkomst['fouten']:
            return Response(
                {'error': 'Er zijn geen te late facturen om een herinnering voor te sturen.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(uitkomst)
    
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

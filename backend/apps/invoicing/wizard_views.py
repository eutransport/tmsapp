"""Endpoints voor de factuurwizard.

Twee delen:

* ``FactuurWizardBedrijfViewSet`` — de beheerkant. Hier legt een beheerder vast
  welke bedrijven gefactureerd mogen worden, welke template daarbij hoort en
  welke diensten er te kiezen zijn.
* ``FactuurWizardViewSet`` — de wizard zelf. Levert de keuzelijsten en maakt op
  het eind een gewone factuur aan.

De wizard maakt bewust dezelfde Invoice/InvoiceLine-records als de bestaande
factuurmodule, zodat PDF, mailen, overzichten en omzet ongewijzigd blijven.
"""
import logging
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.core.access import accessible_company_ids
from apps.core.permissions import HasModulePermission
from .models import Invoice, InvoiceLine, InvoiceStatus, InvoiceType
from .serializers import InvoiceSerializer
from .views import InvoiceViewSet
from .wizard_models import FactuurWizardBedrijf
from .wizard_serializers import (
    FactuurWizardBedrijfSerializer,
    WizardFactuurSerializer,
)

logger = logging.getLogger('accounts.security')


class FactuurWizardBedrijfViewSet(viewsets.ModelViewSet):
    """Beheer van de wizard: welke bedrijven, welke template, welke diensten."""

    queryset = (
        FactuurWizardBedrijf.objects
        .select_related('bedrijf', 'template', 'administratie')
        .prefetch_related('diensten')
        .all()
    )
    serializer_class = FactuurWizardBedrijfSerializer
    permission_classes = [IsAuthenticated, HasModulePermission]
    module_permission = 'manage_invoice_wizard'

    def perform_create(self, serializer):
        config = serializer.save()
        logger.info(
            f"Factuurwizard: bedrijf '{config.bedrijf.naam}' ingesteld met template "
            f"'{config.template.naam}' door {self.request.user.email}"
        )

    def perform_update(self, serializer):
        config = serializer.save()
        logger.info(
            f"Factuurwizard: instelling voor '{config.bedrijf.naam}' gewijzigd "
            f"door {self.request.user.email}"
        )

    def perform_destroy(self, instance):
        naam = instance.bedrijf.naam
        instance.delete()
        logger.warning(
            f"Factuurwizard: instelling voor '{naam}' verwijderd "
            f"door {self.request.user.email}"
        )

    @action(detail=False, methods=['get'])
    def keuzelijsten(self, request):
        """Alles wat het beheerscherm nodig heeft in één keer.

        Bewust een eigen endpoint: de bestaande template- en bedrijfslijsten
        vragen om andere rechten, en wie de wizard mag instellen moet niet ook
        nog de hele factuurmodule hoeven te mogen zien.
        """
        from apps.companies.models import Company
        from apps.core.models import Administratie
        from .models import InvoiceTemplate

        return Response({
            'bedrijven': [
                {'id': str(b.id), 'naam': b.naam}
                for b in Company.objects.order_by('naam')
            ],
            'templates': [
                {'id': str(t.id), 'naam': t.naam}
                for t in InvoiceTemplate.objects.filter(is_active=True).order_by('naam')
            ],
            'administraties': [
                {'id': str(a.id), 'naam': a.naam}
                for a in Administratie.objects.order_by('naam')
            ],
        })

    @action(detail=False, methods=['get'])
    def ritnummers(self, request):
        """Routenummers zoals ze in de vloot staan, om uit te kiezen."""
        from apps.fleet.models import Vehicle

        wagens = (
            Vehicle.objects
            .filter(actief=True)
            .exclude(ritnummer='')
            .select_related('bedrijf')
            .order_by('ritnummer')
        )

        gezien = {}
        for wagen in wagens:
            nummer = (wagen.ritnummer or '').strip()
            if not nummer or nummer in gezien:
                continue
            gezien[nummer] = {
                'ritnummer': nummer,
                'kenteken': wagen.kenteken,
                'type_wagen': wagen.type_wagen,
                'bedrijf': str(wagen.bedrijf_id) if wagen.bedrijf_id else None,
                'bedrijf_naam': wagen.bedrijf.naam if wagen.bedrijf_id else '',
            }
        return Response(list(gezien.values()))


class FactuurWizardViewSet(viewsets.GenericViewSet):
    """De wizard zelf: keuzelijst ophalen en de factuur maken."""

    permission_classes = [IsAuthenticated, HasModulePermission]
    module_permission = 'use_invoice_wizard'
    queryset = FactuurWizardBedrijf.objects.none()
    serializer_class = WizardFactuurSerializer

    def _toegestane_configs(self):
        """De ingestelde bedrijven die deze gebruiker mag factureren.

        Niet-beheerders zien alleen bedrijven uit hun eigen administraties; dat
        is dezelfde afscherming als bij de bestaande facturenlijst.
        """
        configs = (
            FactuurWizardBedrijf.objects
            .filter(actief=True)
            .select_related('bedrijf', 'template', 'administratie')
            .prefetch_related('diensten')
        )
        toegestaan = accessible_company_ids(self.request.user)
        if toegestaan is not None:
            configs = configs.filter(bedrijf_id__in=toegestaan)
        return configs

    @action(detail=False, methods=['get'])
    def opties(self, request):
        """Stap 1 en 2: de bedrijven met hun template en diensten."""
        resultaat = []
        for config in self._toegestane_configs():
            resultaat.append({
                'id': str(config.id),
                'bedrijf': str(config.bedrijf_id),
                'bedrijf_naam': config.bedrijf.naam,
                'template': str(config.template_id),
                'template_naam': config.template.naam,
                'administratie': str(config.administratie_id) if config.administratie_id else None,
                'administratie_naam': config.administratie.naam if config.administratie_id else '',
                'btw_percentage': str(config.btw_percentage),
                'betaaltermijn_dagen': config.betaaltermijn_dagen,
                'diensten': [
                    {
                        'id': str(dienst.id),
                        'ritnummer': dienst.ritnummer,
                        'omschrijving': dienst.omschrijving,
                    }
                    for dienst in config.diensten.all() if dienst.actief
                ],
            })
        return Response(resultaat)

    @action(detail=False, methods=['post'])
    def aanmaken(self, request):
        """Stap 5: maak de factuur met alle regels in één keer aan."""
        serializer = WizardFactuurSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        gegevens = serializer.validated_data

        config = self._toegestane_configs().filter(
            bedrijf_id=gegevens['bedrijf']
        ).first()
        if config is None:
            return Response(
                {'error': 'Dit bedrijf staat niet (meer) in de wizard, of je hebt er geen toegang toe.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Alleen routenummers die voor dit bedrijf zijn ingesteld. Zo kan er via
        # de API geen willekeurige dienst op de factuur belanden.
        toegestane_routes = {
            dienst.ritnummer for dienst in config.diensten.all() if dienst.actief
        }
        for regel in gegevens['regels']:
            for route in regel.get('ritnummers') or []:
                if route not in toegestane_routes:
                    return Response(
                        {'error': f"Route '{route}' hoort niet bij {config.bedrijf.naam}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        factuurdatum = gegevens['factuurdatum']
        vervaldatum = factuurdatum + timedelta(days=config.betaaltermijn_dagen)

        with transaction.atomic():
            prefix, startnummer = InvoiceViewSet._resolve_invoice_numbering(
                InvoiceType.VERKOOP, config.administratie
            )
            volgnummer = InvoiceViewSet._compute_next_invoice_number(prefix, startnummer)
            factuurnummer = f"{prefix}-{volgnummer:04d}"

            factuur = Invoice.objects.create(
                factuurnummer=factuurnummer,
                type=InvoiceType.VERKOOP,
                status=InvoiceStatus.CONCEPT,
                template=config.template,
                bedrijf=config.bedrijf,
                administratie=config.administratie,
                factuurdatum=factuurdatum,
                vervaldatum=vervaldatum,
                btw_percentage=config.btw_percentage,
                opmerkingen=gegevens.get('opmerkingen', ''),
                created_by=request.user,
            )

            for volgorde, regel in enumerate(gegevens['regels']):
                bedrag = Decimal(regel['bedrag'])
                InvoiceLine.objects.create(
                    invoice=factuur,
                    omschrijving=regel['omschrijving'],
                    aantal=Decimal('1'),
                    eenheid='stuk',
                    prijs_per_eenheid=bedrag,
                    volgorde=volgorde,
                    extra_data={
                        'source': 'wizard',
                        'ritnummers': regel.get('ritnummers') or [],
                        'datum_van': regel['datum_van'].isoformat() if regel.get('datum_van') else '',
                        'datum_tot': regel['datum_tot'].isoformat() if regel.get('datum_tot') else '',
                    },
                )

            factuur.calculate_totals()

            if gegevens.get('definitief'):
                factuur.status = InvoiceStatus.DEFINITIEF
                factuur.save(update_fields=['status', 'updated_at'])

        logger.info(
            f"Factuurwizard: {factuurnummer} aangemaakt voor {config.bedrijf.naam} "
            f"({len(gegevens['regels'])} regels, status {factuur.status}) "
            f"door {request.user.email}"
        )

        factuur.refresh_from_db()
        return Response(
            InvoiceSerializer(factuur, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

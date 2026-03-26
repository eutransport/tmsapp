import logging

from django.db import IntegrityError
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import IsAdminOnly, IsAdminOrManager
from apps.core.security import sanitize_filename
from .models import BankAccount, BankImport, BankTransaction
from .serializers import (
    BankAccountSerializer,
    BankAccountTypeSerializer,
    BankImportSerializer,
    BankTransactionSerializer,
    ManualMatchSerializer,
)
from .services import (
    match_transactions_to_invoices,
    parse_ing_csv,
    parse_mt940,
)

logger = logging.getLogger('accounts.security')


class BankAccountViewSet(viewsets.ModelViewSet):
    """CRUD voor bankrekeningen (alleen admins)."""

    queryset = BankAccount.objects.all()
    serializer_class = BankAccountSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    filterset_fields = ['is_active', 'bank']
    search_fields = ['naam', 'iban']

    def perform_create(self, serializer):
        account = serializer.save(created_by=self.request.user)
        logger.info(
            "BankAccount aangemaakt: '%s' (%s) door %s",
            account.naam,
            account.iban,
            self.request.user.email,
        )

    def perform_update(self, serializer):
        account = serializer.save()
        logger.info(
            "BankAccount bijgewerkt: '%s' door %s",
            account.naam,
            self.request.user.email,
        )

    def perform_destroy(self, instance):
        naam = instance.naam
        instance.delete()
        logger.warning(
            "BankAccount verwijderd: '%s' door %s",
            naam,
            self.request.user.email,
        )

    @action(detail=False, methods=['get'])
    def bank_types(self, request):
        """Return available bank types."""
        return Response(BankAccountTypeSerializer.get_choices())


class BankImportViewSet(viewsets.ReadOnlyModelViewSet):
    """Overzicht van importbestanden (alleen admins)."""

    queryset = BankImport.objects.select_related('bankrekening', 'geimporteerd_door').all()
    serializer_class = BankImportSerializer
    permission_classes = [IsAuthenticated, IsAdminOnly]
    filterset_fields = ['bankrekening', 'status']


class BankTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    """Overzicht van banktransacties, met acties voor matching."""

    queryset = (
        BankTransaction.objects.select_related(
            'bankrekening', 'gekoppelde_factuur', 'importbestand'
        ).all()
    )
    serializer_class = BankTransactionSerializer
    permission_classes = [IsAuthenticated, IsAdminOrManager]
    filterset_fields = ['bankrekening', 'match_status', 'datum']
    search_fields = ['naam_tegenpartij', 'omschrijving', 'gevonden_factuurnummer']
    ordering_fields = ['datum', 'bedrag', 'match_status', 'created_at']
    ordering = ['-datum']

    @action(detail=True, methods=['post'])
    def manual_match(self, request, pk=None):
        """Koppel een transactie handmatig aan een factuur."""
        tx = self.get_object()
        serializer = ManualMatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from apps.invoicing.models import Invoice, InvoiceStatus

        try:
            invoice = Invoice.objects.get(pk=serializer.validated_data['factuur_id'])
        except Invoice.DoesNotExist:
            return Response(
                {'error': 'Factuur niet gevonden.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        tx.gekoppelde_factuur = invoice
        tx.gevonden_factuurnummer = invoice.factuurnummer
        tx.match_status = BankTransaction.MatchStatus.HANDMATIG
        tx.save(update_fields=['gekoppelde_factuur', 'gevonden_factuurnummer', 'match_status', 'updated_at'])

        # Mark invoice as paid if applicable
        if invoice.status in (InvoiceStatus.VERZONDEN, InvoiceStatus.DEFINITIEF):
            invoice.status = InvoiceStatus.BETAALD
            invoice.save(update_fields=['status'])
            logger.info(
                "Factuur %s handmatig op betaald gezet via transactie %s door %s",
                invoice.factuurnummer,
                tx.id,
                request.user.email,
            )

        return Response(BankTransactionSerializer(tx).data)

    @action(detail=True, methods=['post'])
    def unmatch(self, request, pk=None):
        """Verwijder de koppeling van een transactie."""
        tx = self.get_object()
        tx.gekoppelde_factuur = None
        tx.gevonden_factuurnummer = ''
        tx.match_status = BankTransaction.MatchStatus.NIEUW
        tx.save(update_fields=['gekoppelde_factuur', 'gevonden_factuurnummer', 'match_status', 'updated_at'])
        return Response(BankTransactionSerializer(tx).data)


class BankStatementImportView(APIView):
    """Upload en verwerk een bankafschrift (CSV of MT940)."""

    parser_classes = [MultiPartParser, FormParser, JSONParser]
    permission_classes = [IsAuthenticated, IsAdminOnly]

    def post(self, request):
        bankrekening_id = request.data.get('bankrekening')
        bestand = request.FILES.get('bestand')

        if not bankrekening_id:
            return Response(
                {'error': 'bankrekening is verplicht.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not bestand:
            return Response(
                {'error': 'bestand is verplicht.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            bankrekening = BankAccount.objects.get(pk=bankrekening_id, is_active=True)
        except BankAccount.DoesNotExist:
            return Response(
                {'error': 'Bankrekening niet gevonden of niet actief.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        bestandsnaam = sanitize_filename(bestand.name)
        file_content = bestand.read()

        # Determine format
        naam_lower = bestand.name.lower()
        if naam_lower.endswith('.mt940') or naam_lower.endswith('.sta') or naam_lower.endswith('.940'):
            formaat = 'mt940'
        else:
            formaat = 'csv'

        # Parse
        try:
            if formaat == 'mt940':
                raw_transactions = parse_mt940(file_content)
            else:
                raw_transactions = parse_ing_csv(file_content)
        except Exception as exc:
            logger.error("Fout bij verwerken bankafschrift: %s", exc)
            bank_import = BankImport.objects.create(
                bankrekening=bankrekening,
                bestandsnaam=bestandsnaam,
                bestandsformaat=formaat,
                status=BankImport.Status.FOUT,
                foutmelding=str(exc),
                geimporteerd_door=request.user,
            )
            return Response(
                {'error': f'Fout bij verwerken bestand: {exc}', 'import_id': str(bank_import.id)},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        # Create BankImport record first
        bank_import = BankImport.objects.create(
            bankrekening=bankrekening,
            bestandsnaam=bestandsnaam,
            bestandsformaat=formaat,
            status=BankImport.Status.VERWERKT,
            geimporteerd_door=request.user,
        )

        # Save transactions (skip duplicates)
        saved_transactions = []
        skipped = 0
        for tx_data in raw_transactions:
            try:
                tx = BankTransaction.objects.create(
                    bankrekening=bankrekening,
                    importbestand=bank_import,
                    **tx_data,
                )
                saved_transactions.append(tx)
            except IntegrityError:
                skipped += 1

        # Auto-match
        match_result = match_transactions_to_invoices(saved_transactions, save=True)
        aantal_gematcht = match_result['matched']

        # Update import counts
        bank_import.aantal_transacties = len(saved_transactions)
        bank_import.aantal_gematcht = aantal_gematcht
        bank_import.save(update_fields=['aantal_transacties', 'aantal_gematcht'])

        logger.info(
            "Bankafschrift geïmporteerd: %s (%d transacties, %d gematcht, %d dubbel) door %s",
            bestandsnaam,
            len(saved_transactions),
            aantal_gematcht,
            skipped,
            request.user.email,
        )

        return Response(
            {
                'import_id': str(bank_import.id),
                'aantal_transacties': len(saved_transactions),
                'aantal_gematcht': aantal_gematcht,
                'aantal_overgeslagen': skipped,
                'bericht': (
                    f"Geïmporteerd: {len(saved_transactions)} transacties, "
                    f"{aantal_gematcht} automatisch gematcht."
                ),
            },
            status=status.HTTP_201_CREATED,
        )


class BankRematchView(APIView):
    """Hervoer automatische matching voor alle openstaande transacties van een rekening."""

    permission_classes = [IsAuthenticated, IsAdminOnly]

    def post(self, request, bankrekening_id):
        try:
            bankrekening = BankAccount.objects.get(pk=bankrekening_id, is_active=True)
        except BankAccount.DoesNotExist:
            return Response(
                {'error': 'Bankrekening niet gevonden of niet actief.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        pending = BankTransaction.objects.filter(
            bankrekening=bankrekening,
            match_status=BankTransaction.MatchStatus.NIEUW,
            bedrag__gt=0,
        )
        result = match_transactions_to_invoices(list(pending), save=True)

        logger.info(
            "Rematch uitgevoerd voor %s: %d gematcht door %s",
            bankrekening.naam,
            result['matched'],
            request.user.email,
        )

        return Response({'matched': result['matched']})

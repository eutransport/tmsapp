"""Banking services: CSV/MT940 parsing and invoice matching."""
import csv
import io
import logging
import re
from decimal import Decimal, InvalidOperation

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# ING CSV parser
# ---------------------------------------------------------------------------
# ING export column order (NL):
#   Datum, Naam / Omschrijving, Rekening, Tegenrekening, Code,
#   Af Bij, Bedrag (EUR), Mutatiesoort, Mededelingen
ING_COLUMNS = [
    'datum', 'naam', 'rekening', 'tegenrekening', 'code',
    'af_bij', 'bedrag_str', 'mutatiesoort', 'mededelingen',
]


def _parse_ing_amount(bedrag_str: str, af_bij: str) -> Decimal:
    """Parse ING bedrag string (comma as decimal separator) and apply sign."""
    cleaned = bedrag_str.replace('.', '').replace(',', '.')
    try:
        amount = Decimal(cleaned)
    except InvalidOperation:
        raise ValueError(f"Ongeldig bedrag: {bedrag_str!r}")
    # 'Af' means debit (negative), 'Bij' means credit (positive)
    if af_bij.strip().lower() == 'af':
        amount = -abs(amount)
    else:
        amount = abs(amount)
    return amount


def parse_ing_csv(file_content: bytes) -> list[dict]:
    """
    Parse an ING CSV bank export.
    Returns a list of transaction dicts ready to be saved as BankTransaction.
    """
    # ING uses semicolon as separator and windows-1252 / latin-1 encoding
    try:
        text = file_content.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = file_content.decode('latin-1')

    reader = csv.reader(io.StringIO(text), delimiter=';')
    rows = list(reader)

    # Skip header row if present
    if not rows:
        raise ValueError("Leeg bestand")

    first_row = [c.strip().lower() for c in rows[0]]
    start = 1 if ('datum' in first_row or 'date' in first_row) else 0

    transactions = []
    for line_no, row in enumerate(rows[start:], start=start + 1):
        if not any(cell.strip() for cell in row):
            continue  # skip empty lines
        if len(row) < 9:
            logger.warning("Rij %d heeft %d kolommen (verwacht 9), overgeslagen", line_no, len(row))
            continue

        datum_str = row[0].strip()
        naam = row[1].strip()
        tegenrekening = row[3].strip()
        af_bij = row[5].strip()
        bedrag_str = row[6].strip()
        mutatiesoort = row[7].strip()
        mededelingen = row[8].strip() if len(row) > 8 else ''

        try:
            from datetime import datetime
            # ING uses YYYYMMDD format
            datum = datetime.strptime(datum_str, '%Y%m%d').date()
        except ValueError:
            try:
                from datetime import datetime
                datum = datetime.strptime(datum_str, '%d-%m-%Y').date()
            except ValueError:
                logger.warning("Ongeldig datum op rij %d: %s, overgeslagen", line_no, datum_str)
                continue

        try:
            bedrag = _parse_ing_amount(bedrag_str, af_bij)
        except ValueError as exc:
            logger.warning("Ongeldig bedrag op rij %d: %s", line_no, exc)
            continue

        transactions.append({
            'datum': datum,
            'bedrag': bedrag,
            'naam_tegenpartij': naam,
            'rekeningnummer_tegenpartij': tegenrekening,
            'omschrijving': mededelingen,
            'mutatiesoort': mutatiesoort,
            'referentie': '',
        })

    return transactions


# ---------------------------------------------------------------------------
# MT940 parser (simplified, for major Dutch banks)
# ---------------------------------------------------------------------------

def parse_mt940(file_content: bytes) -> list[dict]:
    """
    Parse a MT940 SWIFT file.
    This is a simplified parser that covers the most common fields.
    """
    try:
        text = file_content.decode('utf-8-sig')
    except UnicodeDecodeError:
        text = file_content.decode('latin-1')

    transactions = []
    current: dict = {}

    # Each transaction starts with :61: (statement line)
    for line in text.splitlines():
        line = line.rstrip()

        if line.startswith(':61:'):
            # Flush previous
            if current:
                transactions.append(current)
                current = {}

            # :61:YYMMDD[MMDD]C/DAmount
            body = line[4:]
            # Date: first 6 chars YYMMDD
            date_part = body[:6]
            try:
                from datetime import datetime
                datum = datetime.strptime(date_part, '%y%m%d').date()
            except ValueError:
                datum = None

            # Sign: next char after optional 4-char value date
            # Find C (credit) or D (debit) or RD/RC
            sign_match = re.search(r'(C|D|RD|RC)(\d+[,.]?\d*)', body[6:])
            if sign_match:
                sign = sign_match.group(1)
                amount_str = sign_match.group(2).replace(',', '.')
                try:
                    amount = Decimal(amount_str)
                except InvalidOperation:
                    amount = Decimal('0')
                if sign.startswith('D'):
                    amount = -amount
            else:
                amount = Decimal('0')

            current = {
                'datum': datum,
                'bedrag': amount,
                'naam_tegenpartij': '',
                'rekeningnummer_tegenpartij': '',
                'omschrijving': '',
                'mutatiesoort': 'MT940',
                'referentie': body,
            }

        elif line.startswith(':86:') and current:
            current['omschrijving'] = line[4:]

        elif line.startswith('/NAME/') and current:
            current['naam_tegenpartij'] = line[6:]

        elif line.startswith('/IBAN/') and current:
            current['rekeningnummer_tegenpartij'] = line[6:]

        elif current and current.get('omschrijving') and not line.startswith(':'):
            # Continuation of :86: field
            current['omschrijving'] += ' ' + line.strip()

    if current:
        transactions.append(current)

    # Filter out entries without a valid date
    return [t for t in transactions if t.get('datum') is not None]


# ---------------------------------------------------------------------------
# Invoice matching
# ---------------------------------------------------------------------------

def extract_invoice_numbers(text: str) -> list[str]:
    """
    Extract potential invoice numbers from a free-text bank description.

    Matches common Dutch invoice number patterns such as:
      F2024-001, 2024001, INV-2024-001, FACT20240001, etc.
    """
    patterns = [
        r'\bF(?:ACT(?:UUR)?)?[-\s]?(\d{4}[-/]?\d+)\b',   # F2024-001 / FACT2024-001
        r'\bINV[-\s]?(\d{4}[-/]?\d+)\b',                  # INV-2024-001
        r'\b(\d{4}[-/]\d{3,6})\b',                        # 2024-001
        r'\b(F\d{8,})\b',                                  # F20240001
        r'\bFACTUURNR\.?\s*:?\s*([A-Z0-9\-/]+)\b',       # FACTUURNR: F2024-001
        r'\bFACTUUR\s+([A-Z0-9\-/]+)\b',                  # FACTUUR F2024-001
        r'\bFACT\s+([A-Z0-9\-/]+)\b',                     # FACT F2024-001
    ]

    candidates = []
    upper_text = text.upper()
    for pattern in patterns:
        for match in re.finditer(pattern, upper_text):
            candidate = match.group(1) if match.lastindex else match.group(0)
            candidates.append(candidate.strip())

    return list(dict.fromkeys(candidates))  # deduplicate while preserving order


def match_transactions_to_invoices(transactions, save=True):
    """
    Try to match a list of BankTransaction instances to existing invoices.

    For each transaction with bedrag > 0 (bijschrijving / incoming payment):
    - Extract invoice number candidates from the description
    - Look up matching Invoice records
    - If found: link transaction and optionally mark invoice as 'betaald'

    Returns a dict with counts.
    """
    from apps.invoicing.models import Invoice, InvoiceStatus
    from .models import BankTransaction

    matched = 0
    for tx in transactions:
        if tx.match_status in (
            BankTransaction.MatchStatus.GEMATCHT,
            BankTransaction.MatchStatus.HANDMATIG,
        ):
            continue

        # Only try to match incoming payments (bijschrijvingen)
        if tx.bedrag <= 0:
            tx.match_status = BankTransaction.MatchStatus.GEEN_MATCH
            if save:
                tx.save(update_fields=['match_status'])
            continue

        candidates = extract_invoice_numbers(tx.omschrijving + ' ' + tx.naam_tegenpartij)
        invoice = None

        for candidate in candidates:
            try:
                invoice = Invoice.objects.get(factuurnummer__iexact=candidate)
                break
            except Invoice.DoesNotExist:
                # Try partial match (candidate is suffix of factuurnummer)
                results = Invoice.objects.filter(
                    factuurnummer__iendswith=candidate
                )
                if results.count() == 1:
                    invoice = results.first()
                    break

        if invoice:
            tx.gekoppelde_factuur = invoice
            tx.gevonden_factuurnummer = invoice.factuurnummer
            tx.match_status = BankTransaction.MatchStatus.GEMATCHT
            matched += 1

            # Update invoice status to betaald
            if invoice.status in (InvoiceStatus.VERZONDEN, InvoiceStatus.DEFINITIEF):
                invoice.status = InvoiceStatus.BETAALD
                if save:
                    invoice.save(update_fields=['status'])
                logger.info(
                    "Invoice %s automatisch op betaald gezet via banktransactie %s",
                    invoice.factuurnummer,
                    tx.id,
                )
        else:
            tx.match_status = BankTransaction.MatchStatus.GEEN_MATCH

        if save:
            tx.save(update_fields=['match_status', 'gekoppelde_factuur', 'gevonden_factuurnummer'])

    return {'matched': matched}

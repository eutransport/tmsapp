"""Vervang samengevatte tolpassages door de gedetailleerde van dezelfde dag.

Op factuur F-2026-0387 hing per dag een samengevatte passage uit de
Radius-factuurimport, terwijl dezelfde dag ook per passage was ingelezen. Die
gedetailleerde regels bleven daardoor open staan en konden een tweede keer
gefactureerd worden. Per dag wordt de samengevatte regel vervangen door de
gedetailleerde, maar alleen als de bedragen exact gelijk zijn.
"""
from collections import defaultdict
from decimal import Decimal

from django.db import migrations

FACTUUR = 'F-2026-0387'


def _vervang(apps, schema_editor):
    Invoice = apps.get_model('invoicing', 'Invoice')
    TollingEvent = apps.get_model('tolling', 'TollingEvent')

    factuur = Invoice.objects.filter(factuurnummer=FACTUUR).first()
    if factuur is None:
        return

    for regel in factuur.lines.all():
        if 'tolheffing' not in (regel.omschrijving or '').lower():
            continue
        gekoppeld = defaultdict(list)
        for ev in TollingEvent.objects.filter(invoice_line=regel):
            gekoppeld[(ev.license_plate_normalized, ev.start_at.date())].append(ev)

        for (plaat, dag), evs in gekoppeld.items():
            if len(evs) != 1:
                continue
            samengevat = evs[0]
            detail = list(
                TollingEvent.objects.filter(
                    license_plate_normalized=plaat,
                    invoice_line__isnull=True,
                    is_private=False,
                    start_at__date=dag,
                )
            )
            if not detail:
                continue
            totaal = sum((e.amount or Decimal('0') for e in detail), Decimal('0'))
            if totaal != (samengevat.amount or Decimal('0')):
                continue
            for e in detail:
                e.invoice_line = regel
                e.invoiced_at = samengevat.invoiced_at
                e.save(update_fields=['invoice_line', 'invoiced_at'])
            samengevat.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0023_tolafrekening_status'),
        ('invoicing', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(_vervang, migrations.RunPython.noop),
    ]

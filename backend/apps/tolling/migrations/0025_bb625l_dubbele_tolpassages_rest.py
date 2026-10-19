"""Vervolg op 0024: dagen waarop meerdere passages aan de factuurregel hingen.

Migratie 0024 sloeg dagen over met meer dan een gekoppelde passage. Hier
wordt per dag gezocht naar precies een gekoppelde passage waarvan het bedrag
exact gelijk is aan de som van de nog openstaande passages van die dag; die
wordt dan vervangen.
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
            kandidaten = [e for e in evs if (e.amount or Decimal('0')) == totaal]
            if len(kandidaten) != 1:
                continue
            samengevat = kandidaten[0]
            for e in detail:
                e.invoice_line = regel
                e.invoiced_at = samengevat.invoiced_at
                e.save(update_fields=['invoice_line', 'invoiced_at'])
            samengevat.delete()


class Migration(migrations.Migration):

    dependencies = [
        ('tolling', '0024_bb625l_dubbele_tolpassages'),
    ]

    operations = [
        migrations.RunPython(_vervang, migrations.RunPython.noop),
    ]

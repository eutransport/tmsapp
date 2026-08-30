#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genereer een SQL-script waarmee de 'gefactureerd'-markering van tolregels
uit een oude database-dump wordt teruggezet in een andere (live) database.

Alleen de tolregels met een ingevulde ``invoiced_at`` worden meegenomen. De
regels worden gekoppeld op hun vingerafdruk (starttijd, eindtijd, genormaliseerd
kenteken, bedrag en OBU) en niet op ``id``, zodat het ook werkt wanneer de
regels opnieuw zijn geimporteerd en dus nieuwe id's hebben.

Gebruik:
    python scripts/tolling_gefactureerd_uit_dump.py dump.sql.gz uitvoer.sql

Het resulterende script draait standaard als proefrun (alles wordt
teruggedraaid). Pas het toe met:
    psql -U tms_user -d tms_db -v toepassen=on -f uitvoer.sql

Regels waarvan de bijbehorende factuurregel niet meer in de doeldatabase
bestaat worden toch als gefactureerd gemarkeerd (zonder koppeling), net zoals
Django dat doet bij het verwijderen van een factuur. Met -v strikt=on worden
die regels overgeslagen.
"""
from __future__ import annotations

import gzip
import sys
from pathlib import Path

TABEL = 'public.tolling_tollingevent'
# Kolommen die in de tijdelijke tabel terechtkomen.
KOLOMMEN = [
    'id', 'start_at', 'end_at', 'license_plate_normalized',
    'amount', 'obu', 'invoiced_at', 'invoice_line_id',
]


def _open(pad: Path):
    if pad.suffix == '.gz':
        return gzip.open(pad, 'rt', encoding='utf-8', newline='')
    return open(pad, 'r', encoding='utf-8', newline='')


def lees_copy_blok(pad: Path, tabel: str) -> tuple[list[str], list[list[str]]]:
    """Geef (kolomnamen, rijen) van het COPY-blok van een plain pg_dump."""
    kolommen: list[str] | None = None
    rijen: list[list[str]] = []
    binnen = False
    with _open(pad) as fh:
        for regel in fh:
            if binnen:
                if regel.startswith('\\.'):
                    break
                rijen.append(regel.rstrip('\n').rstrip('\r').split('\t'))
                continue
            if regel.startswith('COPY %s (' % tabel):
                kolommen = regel[regel.index('(') + 1:regel.index(')')].split(', ')
                binnen = True
    if kolommen is None:
        raise SystemExit('COPY-blok voor %s niet gevonden in %s' % (tabel, pad))
    return kolommen, rijen


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 1
    dump = Path(argv[0])
    uit = Path(argv[1])
    if not dump.exists():
        raise SystemExit('Dump niet gevonden: %s' % dump)

    kolommen, rijen = lees_copy_blok(dump, TABEL)
    idx = {naam: kolommen.index(naam) for naam in KOLOMMEN}
    gefactureerd = [r for r in rijen if r[idx['invoiced_at']] != '\\N']

    print('Tolregels in dump      : %d' % len(rijen))
    print('Gefactureerde regels   : %d' % len(gefactureerd))
    if not gefactureerd:
        raise SystemExit('Geen gefactureerde regels gevonden; niets te doen.')

    regels: list[str] = []
    w = regels.append
    w('-- Automatisch gegenereerd door scripts/tolling_gefactureerd_uit_dump.py')
    w('-- Bron: %s' % dump.name)
    w('-- Aantal gefactureerde tolregels: %d' % len(gefactureerd))
    w('--')
    w('-- Proefrun (verandert niets, toont alleen het rapport):')
    w('--   psql -U tms_user -d tms_db -f %s' % uit.name)
    w('-- Definitief toepassen:')
    w('--   psql -U tms_user -d tms_db -v toepassen=on -f %s' % uit.name)
    w('-- Regels zonder bestaande factuurregel overslaan:')
    w('--   ... -v strikt=on')
    w('')
    w('\\set ON_ERROR_STOP on')
    w('\\if :{?toepassen}')
    w('\\else')
    w('\\set toepassen off')
    w('\\endif')
    w('\\if :{?strikt}')
    w('\\else')
    w('\\set strikt off')
    w('\\endif')
    w('')
    w('BEGIN;')
    w('')
    w('CREATE TEMP TABLE tol_gefactureerd (')
    w('    id uuid,')
    w('    start_at timestamp with time zone,')
    w('    end_at timestamp with time zone,')
    w('    license_plate_normalized character varying(32),')
    w('    amount numeric(10,2),')
    w('    obu character varying(64),')
    w('    invoiced_at timestamp with time zone,')
    w('    invoice_line_id uuid')
    w(') ON COMMIT DROP;')
    w('')
    w('COPY tol_gefactureerd (%s) FROM stdin;' % ', '.join(KOLOMMEN))
    for r in gefactureerd:
        w('\t'.join(r[idx[naam]] for naam in KOLOMMEN))
    w('\\.')
    w('')
    w('CREATE INDEX ON tol_gefactureerd (start_at, license_plate_normalized);')
    w('ANALYZE tol_gefactureerd;')
    w('')
    w("\\echo '--- Rapport vooraf ---------------------------------------'")
    w('SELECT')
    w('    count(*) AS regels_in_bestand,')
    w('    count(e.id) AS gevonden_in_database,')
    w('    count(*) FILTER (WHERE e.id IS NULL) AS niet_gevonden,')
    w('    count(*) FILTER (WHERE e.invoiced_at IS NOT NULL) AS reeds_gemarkeerd,')
    w('    count(*) FILTER (WHERE e.id IS NOT NULL AND e.invoiced_at IS NULL) AS wordt_bijgewerkt')
    w('FROM tol_gefactureerd b')
    w('LEFT JOIN public.tolling_tollingevent e')
    w('       ON e.start_at = b.start_at')
    w('      AND e.end_at = b.end_at')
    w('      AND e.license_plate_normalized = b.license_plate_normalized')
    w('      AND e.amount = b.amount')
    w('      AND e.obu = b.obu;')
    w('')
    w("\\echo '--- Ontbrekende factuurregels (FK kan niet gezet worden) --'")
    w('SELECT b.invoice_line_id, count(*) AS tolregels')
    w('FROM tol_gefactureerd b')
    w('WHERE b.invoice_line_id IS NOT NULL')
    w('  AND NOT EXISTS (SELECT 1 FROM public.invoicing_invoiceline l'
      ' WHERE l.id = b.invoice_line_id)')
    w('GROUP BY b.invoice_line_id')
    w('ORDER BY 2 DESC;')
    w('')
    w("\\echo '--- Niet-teruggevonden tolregels (max. 20) ----------------'")
    w('SELECT b.license_plate_normalized, b.start_at, b.amount')
    w('FROM tol_gefactureerd b')
    w('WHERE NOT EXISTS (')
    w('    SELECT 1 FROM public.tolling_tollingevent e')
    w('     WHERE e.start_at = b.start_at')
    w('       AND e.end_at = b.end_at')
    w('       AND e.license_plate_normalized = b.license_plate_normalized')
    w('       AND e.amount = b.amount')
    w('       AND e.obu = b.obu)')
    w('ORDER BY b.start_at')
    w('LIMIT 20;')
    w('')
    w("\\echo '--- Bijwerken --------------------------------------------'")
    w('-- Alleen regels die nog niet als gefactureerd staan, zodat het script')
    w('-- meerdere keren gedraaid kan worden zonder iets te overschrijven.')
    w('UPDATE public.tolling_tollingevent e')
    w('   SET invoiced_at = b.invoiced_at,')
    w('       invoice_line_id = CASE')
    w('           WHEN EXISTS (SELECT 1 FROM public.invoicing_invoiceline l')
    w('                         WHERE l.id = b.invoice_line_id)')
    w('           THEN b.invoice_line_id')
    w('           ELSE e.invoice_line_id')
    w('       END')
    w('  FROM tol_gefactureerd b')
    w(' WHERE e.start_at = b.start_at')
    w('   AND e.end_at = b.end_at')
    w('   AND e.license_plate_normalized = b.license_plate_normalized')
    w('   AND e.amount = b.amount')
    w('   AND e.obu = b.obu')
    w('   AND e.invoiced_at IS NULL')
    w('   -- In strikte modus alleen regels waarvan de factuurregel nog bestaat.')
    w("   AND (:'strikt' = 'off' OR EXISTS (SELECT 1"
      ' FROM public.invoicing_invoiceline l WHERE l.id = b.invoice_line_id));')
    w('')
    w("\\echo '--- Rapport achteraf -------------------------------------'")
    w('SELECT')
    w('    count(*) FILTER (WHERE e.invoiced_at IS NOT NULL) AS nu_gemarkeerd,')
    w('    count(*) FILTER (WHERE e.invoice_line_id IS NOT NULL) AS met_factuurregel')
    w('FROM tol_gefactureerd b')
    w('JOIN public.tolling_tollingevent e')
    w('  ON e.start_at = b.start_at')
    w(' AND e.end_at = b.end_at')
    w(' AND e.license_plate_normalized = b.license_plate_normalized')
    w(' AND e.amount = b.amount')
    w(' AND e.obu = b.obu;')
    w('')
    w('\\if :toepassen')
    w("\\echo '>> Wijzigingen worden definitief vastgelegd.'")
    w('COMMIT;')
    w('\\else')
    w("\\echo '>> PROEFRUN: alles wordt teruggedraaid."
      " Draai met  -v toepassen=on  om het echt door te voeren.'")
    w('ROLLBACK;')
    w('\\endif')
    w('')

    uit.parent.mkdir(parents=True, exist_ok=True)
    uit.write_text('\n'.join(regels), encoding='utf-8', newline='\n')
    print('Geschreven naar        : %s (%d regels)' % (uit, len(regels)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))

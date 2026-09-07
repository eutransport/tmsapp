"""Km-overzicht voor op de factuur.

De tolheffing wordt vaak los geïmporteerd over een heel andere periode dan de
ritten die op de factuur staan. Eén optelsom levert dan een scheve verhouding
op. Daarom rekent deze module per geïmporteerde tolheffingsperiode, en meldt
hij het apart wanneer er voor een gefactureerde week helemaal geen tolheffing
is.

Beide factuurlayouts gebruiken dezelfde berekening, zodat ze niet uit elkaar
kunnen lopen.
"""
import logging
import re
from datetime import date

logger = logging.getLogger(__name__)

# 'Rit 1115518034 - 24-8-2026 (390 km)'
_RIT_KM = re.compile(r'\(\s*(\d+(?:[.,]\d+)?)\s*km\s*\)\s*$', re.IGNORECASE)
_RIT_DATUM = re.compile(r'(\d{1,2})-(\d{1,2})-(\d{4})')
# 'Tolheffing - BB-949-N - E&UTRANS2; (Totaal 9105 KM) 01-07 t/m 31-07'
_TOL_KM = re.compile(r'Totaal\s+(\d+(?:[.,]\d+)?)\s*km', re.IGNORECASE)
_TOL_PERIODE = re.compile(r'(\d{1,2}-\d{1,2})\s*(?:t/m|tm)\s*(\d{1,2}-\d{1,2})', re.IGNORECASE)


def _getal(waarde):
    """Nederlandse notatie met twee decimalen."""
    return f'{waarde:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def _periode_label(van, tot):
    """Korte omschrijving van een periode; binnen één week het weeknummer."""
    if van == tot:
        return van.strftime('%d-%m')
    jaar_van, week_van, _ = van.isocalendar()
    jaar_tot, week_tot, _ = tot.isocalendar()
    if jaar_van == jaar_tot and week_van == week_tot:
        return f'week {week_van}'
    return f"{van.strftime('%d-%m')} t/m {tot.strftime('%d-%m')}"


def _tolheffing_periodes(invoice):
    """Per tolheffing-factuurregel de eigen periode, km en kentekens.

    Elke losse import staat als eigen regel op de factuur, dus die regels
    bepalen de indeling. De gekoppelde events zijn leidend; staat een regel
    los van events, dan wordt teruggevallen op de omschrijving.
    """
    periodes = []
    for line in invoice.lines.all():
        omschrijving = line.omschrijving or ''
        if not omschrijving.lower().startswith('tolheffing'):
            continue

        events = []
        try:
            events = list(line.tolling_events.all())
        except Exception:  # pragma: no cover - defensief
            events = []

        dagen = [ev.start_at.date() for ev in events if getattr(ev, 'start_at', None)]
        if dagen:
            periodes.append({
                'van': min(dagen),
                'tot': max(dagen),
                'label': _periode_label(min(dagen), max(dagen)),
                'km': sum(float(ev.distance_km or 0) for ev in events),
                'kentekens': {
                    ev.license_plate_normalized for ev in events
                    if getattr(ev, 'license_plate_normalized', '')
                },
            })
            continue

        # Terugval: de omschrijving bevat de km en meestal ook de periode.
        gevonden_km = _TOL_KM.search(omschrijving)
        if not gevonden_km:
            continue
        try:
            km = float(gevonden_km.group(1).replace(',', '.'))
        except ValueError:
            continue
        gevonden_periode = _TOL_PERIODE.search(omschrijving)
        periodes.append({
            'van': None,
            'tot': None,
            'label': (
                f'{gevonden_periode.group(1)} t/m {gevonden_periode.group(2)}'
                if gevonden_periode else 'periode onbekend'
            ),
            'km': km,
            'kentekens': set(),
        })
    return periodes


def _ritten_per_week(invoice):
    """De gefactureerde ritten, opgeteld per ISO-week."""
    per_week = {}
    for line in invoice.lines.all():
        omschrijving = line.omschrijving or ''
        if not omschrijving.lower().startswith('rit'):
            continue

        rit_datum = None
        km = None
        entry = getattr(line, 'time_entry', None)
        if entry is not None:
            rit_datum = getattr(entry, 'datum', None)
            km = float(getattr(entry, 'totaal_km', 0) or 0)

        if rit_datum is None:
            gevonden = _RIT_DATUM.search(omschrijving)
            if gevonden:
                try:
                    rit_datum = date(int(gevonden.group(3)), int(gevonden.group(2)),
                                     int(gevonden.group(1)))
                except ValueError:
                    rit_datum = None
        if not km:
            gevonden = _RIT_KM.search(omschrijving)
            if gevonden:
                try:
                    km = float(gevonden.group(1).replace(',', '.'))
                except ValueError:
                    km = 0.0
        if rit_datum is None or not km or km <= 0:
            continue

        jaar, week, _ = rit_datum.isocalendar()
        vak = per_week.get((jaar, week))
        if vak is None:
            per_week[(jaar, week)] = {'km': km, 'van': rit_datum, 'tot': rit_datum}
        else:
            vak['km'] += km
            if rit_datum < vak['van']:
                vak['van'] = rit_datum
            if rit_datum > vak['tot']:
                vak['tot'] = rit_datum
    return per_week


def _ritkm_in_periode(van, tot, kentekens):
    """Gereden km uit de urenregistratie binnen deze periode en kentekens."""
    from apps.timetracking.models import TimeEntry
    from apps.tolling.models import normalize_plate

    totaal = 0.0
    for rit in TimeEntry.objects.filter(datum__gte=van, datum__lte=tot):
        if kentekens and normalize_plate(rit.kenteken or '') not in kentekens:
            continue
        totaal += float(rit.totaal_km or 0)
    return totaal


def bouw_km_tabel(invoice):
    """Rijen voor het km-kaartje: per tolheffingsperiode een eigen regel.

    Levert `[kop, rij, ...]` waarbij elke rij bestaat uit periode, tolheffing,
    ritregistratie en verhouding. Zonder tolheffing op de factuur komt er niets
    terug en blijft het kaartje dus achterwege, net als voorheen.
    """
    try:
        periodes = _tolheffing_periodes(invoice)
        if not periodes:
            return []

        rijen = [['Periode', 'Tolheffing', 'Ritregistratie', 'Verhouding']]
        for periode in periodes:
            tol_km = f"{_getal(periode['km'])} km"
            if periode['van'] is None:
                # Zonder events weten we de periode niet; verhouding overslaan.
                rijen.append([periode['label'], tol_km, 'onbekend', '-'])
                continue
            rit_km = _ritkm_in_periode(periode['van'], periode['tot'],
                                       periode['kentekens'])
            if rit_km > 0:
                rijen.append([
                    periode['label'],
                    tol_km,
                    f'{_getal(rit_km)} km',
                    f"{_getal(periode['km'] / rit_km * 100)} %",
                ])
            else:
                # Zonder ritregistratie is een verhouding zinloos.
                rijen.append([periode['label'], tol_km, 'niet aanwezig', '-'])

        # Weken die wel op de factuur staan maar niet door tolheffing gedekt
        # worden: dat hoort zichtbaar te zijn in plaats van scheef mee te tellen.
        per_week = _ritten_per_week(invoice)
        for sleutel in sorted(per_week):
            vak = per_week[sleutel]
            gedekt = any(
                periode['van'] is not None
                and periode['van'] <= vak['tot']
                and periode['tot'] >= vak['van']
                for periode in periodes
            )
            if not gedekt:
                rijen.append([
                    f'week {sleutel[1]}',
                    'niet aanwezig',
                    f"{_getal(vak['km'])} km",
                    '-',
                ])

        return rijen
    except Exception as fout:  # pragma: no cover - de PDF moet altijd lukken
        logger.warning(f'Km-overzicht kon niet berekend worden: {fout}')
        return []

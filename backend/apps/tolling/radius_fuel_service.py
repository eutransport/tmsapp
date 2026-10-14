"""Tolregels ophalen uit de Radius fuel-API en omzetten naar factuurregels.

De API is een betrouwbaardere bron dan de PDF: elke transactie komt als los
veld binnen, inclusief de landcode. We zetten de transacties om naar dezelfde
``Factuur``-structuur als de PDF-lezer, zodat de analyse en de import er maar
in een vorm hoeven te bestaan.

Let op: de filters van de Radius fuel-API werken niet; ``from_date`` en
soortgelijke parameters worden genegeerd en leveren altijd alles op. We
filteren daarom zelf op periode.
"""
import logging
from datetime import datetime, timezone as dt_timezone
from decimal import Decimal, InvalidOperation

from django.utils import timezone

from apps.tracking.models import RadiusConnection
from apps.tracking.radius_service import RadiusError, api_get

from .radius_factuur_parser import Factuur, FactuurRegel
from .radius_fuel import is_tolregel, kaart_index, kenteken_uit_transactie, land_uit_transactie

logger = logging.getLogger(__name__)

KAARTEN_ENDPOINT = '/fuel/cards/'
TRANSACTIES_ENDPOINT = '/fuel/transactions/'


def _lijst(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get('results') or data.get('data') or []
    return []


def _bedrag(waarde) -> Decimal:
    try:
        return Decimal(str(waarde or '0'))
    except (InvalidOperation, TypeError):
        return Decimal('0')


def _lokaal_tijdstip(waarde):
    """``tran_date`` komt als ISO-tijd in UTC binnen."""
    tekst = str(waarde or '').strip()
    if not tekst:
        return None
    try:
        moment = datetime.fromisoformat(tekst.replace('Z', '+00:00'))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt_timezone.utc)
    return timezone.localtime(moment, timezone.get_current_timezone())


def _naar_regel(transactie, kaarten) -> FactuurRegel | None:
    moment = _lokaal_tijdstip(transactie.get('tran_date'))
    kenteken = kenteken_uit_transactie(transactie, kaarten)
    if moment is None or not kenteken:
        return None

    bruto = _bedrag(transactie.get('gross_amount'))
    netto = _bedrag(transactie.get('net_amount'))
    return FactuurRegel(
        datum=moment.strftime('%d/%m/%Y'),
        tijdstip=moment.strftime('%H:%M'),
        kenteken=kenteken,
        station=str(transactie.get('site_name') or ''),
        product=str(transactie.get('product_description') or ''),
        hoeveelheid=_bedrag(transactie.get('quantity')),
        eenheidsprijs=_bedrag(transactie.get('net_unit_price')),
        totaal=bruto or netto,
        btw_tarief='',
        btw_bedrag=_bedrag(transactie.get('vat_amount')),
        bruto=bruto,
        kaartnummer=str(transactie.get('card_no') or ''),
        land=land_uit_transactie(transactie),
    )


def _sleutel(transactie):
    """Transactienummer, met een samengestelde terugval."""
    return transactie.get('tran_no') or (
        transactie.get('tran_date'), transactie.get('card_no'),
        transactie.get('gross_amount'), transactie.get('site_no'),
    )


def haal_tolregels(van=None, tot=None, connection=None):
    """
    Haal de toltransacties van alle actieve tankkaartkoppelingen op.

    Geeft een tuple (regels, overgeslagen, koppelingen) terug. ``overgeslagen``
    telt de toltransacties waarvan geen kenteken te bepalen was; die mogen niet
    stilzwijgend verdwijnen.
    """
    koppelingen = ([connection] if connection is not None else
                   list(RadiusConnection.objects.filter(soort='fuel', actief=True)
                        .order_by('naam')))
    if not koppelingen:
        raise RadiusError('Er is geen actieve koppeling voor tank- en laadkaarten.')

    gezien = set()
    regels = []
    overgeslagen = []
    verslag = []

    for koppeling in koppelingen:
        try:
            kaarten = kaart_index(_lijst(api_get(KAARTEN_ENDPOINT, connection=koppeling)))
            transacties = _lijst(api_get(TRANSACTIES_ENDPOINT, connection=koppeling))
        except RadiusError as exc:
            verslag.append({'connection': koppeling.naam, 'error': str(exc)})
            continue

        aantal = 0
        for transactie in transacties:
            if not is_tolregel(transactie):
                continue
            sleutel = _sleutel(transactie)
            if sleutel in gezien:
                continue
            gezien.add(sleutel)

            regel = _naar_regel(transactie, kaarten)
            if regel is None:
                overgeslagen.append({
                    'koppeling': koppeling.naam,
                    'datum': str(transactie.get('tran_date') or ''),
                    'kaart': str(transactie.get('card_no') or ''),
                    'bedrag': str(transactie.get('gross_amount') or ''),
                    'reden': 'geen kenteken op de kaart of transactie',
                })
                continue

            datum = regel.tijdstempel.date()
            if (van and datum < van) or (tot and datum > tot):
                continue
            regels.append(regel)
            aantal += 1

        verslag.append({'connection': koppeling.naam, 'tolregels': aantal,
                        'transacties': len(transacties)})

    regels.sort(key=lambda r: (r.tijdstempel, r.kenteken))
    return regels, overgeslagen, verslag


def bouw_factuur(van=None, tot=None, connection=None):
    """Zet de opgehaalde tolregels om in een ``Factuur`` voor analyse of import."""
    regels, overgeslagen, verslag = haal_tolregels(van, tot, connection=connection)
    factuur = Factuur(
        factuurnummer='Radius API',
        factuurdatum=timezone.localdate().isoformat(),
        regels=regels,
    )
    return factuur, overgeslagen, verslag

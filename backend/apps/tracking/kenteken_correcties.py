"""Kentekens rechttrekken die Radius verkeerd aanlevert.

Radius levert twee wagens met omgedraaide letters: 31-BNL-8 en 32-BNL-8,
terwijl ze in de vloot en op de tolbestanden 31-BLN-8 en 32-BLN-8 heten.
Daardoor sloten hun ritten nergens op aan. De fout zit bij de bron, dus
corrigeren we bij binnenkomst; de vloot zelf blijft leidend.

Let op: 36-BNL-9 en 79-BNL-8 zijn wel degelijk BNL. Alleen de kentekens die
hier met name genoemd staan worden aangepast.
"""
from __future__ import annotations

import re

# Zoals Radius het levert -> zoals het hoort.
CORRECTIES = {
    '31BNL8': '31-BLN-8',
    '32BNL8': '32-BLN-8',
}


def _kaal(waarde: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', (waarde or '').upper())


def corrigeer_kenteken(waarde: str) -> str:
    """Geef het juiste kenteken, of de oorspronkelijke waarde."""
    return CORRECTIES.get(_kaal(waarde), waarde)

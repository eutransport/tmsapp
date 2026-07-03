"""Free geocoding via OpenStreetMap Nominatim.

We respect their usage policy: 1 request/second, a real User-Agent, and we
cache results in the Django cache to avoid hammering the service. Callers
provide already-sanitised address strings.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

import requests
from django.core.cache import cache

logger = logging.getLogger(__name__)

NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'
USER_AGENT = 'TMS-LoadList/1.0 (transport route optimizer)'
REQUEST_INTERVAL = 1.05  # seconds — Nominatim asks for max 1 req/s
CACHE_TTL = 60 * 60 * 24 * 30  # 30 days
_last_call_ts = 0.0


@dataclass
class GeocodeResult:
    lat: float
    lng: float
    formatted: str
    confidence: str  # 'high' | 'medium' | 'low'


def _throttle():
    global _last_call_ts
    now = time.monotonic()
    wait = REQUEST_INTERVAL - (now - _last_call_ts)
    if wait > 0:
        time.sleep(wait)
    _last_call_ts = time.monotonic()


def geocode(address: str, country_hint: str = '') -> Optional[GeocodeResult]:
    """Return best-guess coordinates for an address, or None."""
    query = (address or '').strip()
    if len(query) < 4 or len(query) > 250:
        return None

    cache_key = f'loadlist:geo:{country_hint.lower()}:{query.lower()}'
    hit = cache.get(cache_key)
    if hit == '__none__':
        return None
    if hit:
        return GeocodeResult(**hit)

    params = {
        'q': query,
        'format': 'jsonv2',
        'limit': 1,
        'addressdetails': 0,
    }
    if country_hint:
        # ISO 3166-1 alpha-2 code; ignore anything longer as it might be a full name
        cc = country_hint.strip().lower()[:2]
        if cc.isalpha():
            params['countrycodes'] = cc

    _throttle()
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params=params,
            headers={'User-Agent': USER_AGENT, 'Accept-Language': 'nl,en'},
            timeout=15,
        )
    except requests.RequestException as exc:
        logger.warning('Geocode request failed for %r: %s', query, exc)
        return None

    if resp.status_code != 200:
        logger.warning('Geocode returned %s for %r', resp.status_code, query)
        return None

    try:
        data = resp.json()
    except ValueError:
        return None

    if not isinstance(data, list) or not data:
        cache.set(cache_key, '__none__', CACHE_TTL)
        return None

    top = data[0]
    try:
        lat = float(top['lat'])
        lng = float(top['lon'])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None

    importance = float(top.get('importance', 0) or 0)
    if importance >= 0.5:
        conf = 'high'
    elif importance >= 0.3:
        conf = 'medium'
    else:
        conf = 'low'

    result = GeocodeResult(
        lat=lat,
        lng=lng,
        formatted=str(top.get('display_name', ''))[:300],
        confidence=conf,
    )
    cache.set(cache_key, result.__dict__, CACHE_TTL)
    return result


@dataclass
class AddressSuggestion:
    label: str
    lat: float
    lng: float


def suggest(query: str, limit: int = 6, country_hint: str = 'nl,be,de,lu,fr') -> list[AddressSuggestion]:
    """Autocomplete-style search. Cached for 24h per query."""
    q = (query or '').strip()
    if len(q) < 3 or len(q) > 120:
        return []

    cache_key = f'loadlist:suggest:{country_hint}:{q.lower()}'
    hit = cache.get(cache_key)
    if hit is not None:
        return [AddressSuggestion(**item) for item in hit]

    params = {
        'q': q,
        'format': 'jsonv2',
        'limit': max(1, min(int(limit), 10)),
        'addressdetails': 0,
    }
    if country_hint:
        params['countrycodes'] = country_hint

    _throttle()
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params=params,
            headers={'User-Agent': USER_AGENT, 'Accept-Language': 'nl,en'},
            timeout=8,
        )
    except requests.RequestException as exc:
        logger.warning('Suggest request failed for %r: %s', q, exc)
        return []

    if resp.status_code != 200:
        return []

    try:
        data = resp.json()
    except ValueError:
        return []

    out: list[AddressSuggestion] = []
    if isinstance(data, list):
        for item in data:
            try:
                lat = float(item['lat'])
                lng = float(item['lon'])
            except (KeyError, TypeError, ValueError):
                continue
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                continue
            label = str(item.get('display_name', ''))[:250]
            if label:
                out.append(AddressSuggestion(label=label, lat=lat, lng=lng))

    cache.set(cache_key, [s.__dict__ for s in out], 60 * 60 * 24)
    return out

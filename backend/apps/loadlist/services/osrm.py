"""Road distance/duration matrix via the free OSRM public router.

We use the `/table/v1/driving/` endpoint which returns an N×N matrix of
driving distances (meters) and durations (seconds) between all input points
in one HTTP call. Fall back to haversine (straight-line) if OSRM is
unreachable or refuses the request.
"""
from __future__ import annotations

import json
import logging
import math
import urllib.parse
import urllib.request
from typing import Optional

logger = logging.getLogger(__name__)

Point = tuple[float, float]  # (lat, lng)

OSRM_TABLE_URL = 'https://router.project-osrm.org/table/v1/driving/'
REQUEST_TIMEOUT = 20  # seconds


def _haversine_m(a: Point, b: Point) -> float:
    lat1, lon1 = a
    lat2, lon2 = b
    r = 6_371_000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _haversine_matrix(points: list[Point]) -> tuple[list[list[float]], list[list[float]]]:
    n = len(points)
    dist = [[0.0] * n for _ in range(n)]
    dur = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            d = _haversine_m(points[i], points[j])
            dist[i][j] = dist[j][i] = d
            # Assume 60 km/h average for the fallback
            t = d / (60_000.0 / 3600.0)
            dur[i][j] = dur[j][i] = t
    return dist, dur


def road_matrix(points: list[Point]) -> tuple[list[list[float]], list[list[float]], str]:
    """Return (distance_m, duration_s, source) for all pairs of `points`.

    Source is 'osrm' on success, 'haversine' on fallback. Length limit: OSRM
    public server accepts up to ~100 coordinates per call.
    """
    if not points:
        return [], [], 'osrm'
    if len(points) > 95:
        # Too big for one call — degrade to haversine to keep it simple.
        d, t = _haversine_matrix(points)
        return d, t, 'haversine'

    # OSRM expects lon,lat order
    coord_str = ';'.join(f'{lng:.6f},{lat:.6f}' for lat, lng in points)
    url = OSRM_TABLE_URL + urllib.parse.quote(coord_str, safe=',;') + '?annotations=distance,duration'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'TMS-LoadList/1.0'})
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        if data.get('code') != 'Ok':
            raise ValueError(f"OSRM code={data.get('code')}")
        dist = data.get('distances') or []
        dur = data.get('durations') or []
        if not dist or not dur or len(dist) != len(points):
            raise ValueError('OSRM returned unexpected shape')
        # OSRM may return nulls for unreachable pairs — patch with haversine.
        for i in range(len(points)):
            for j in range(len(points)):
                if dist[i][j] is None:
                    dist[i][j] = _haversine_m(points[i], points[j])
                if dur[i][j] is None:
                    dur[i][j] = dist[i][j] / (60_000.0 / 3600.0)
        return dist, dur, 'osrm'
    except Exception as exc:
        logger.warning('OSRM table failed, falling back to haversine: %s', exc)
        d, t = _haversine_matrix(points)
        return d, t, 'haversine'

"""Route optimization: solve the "visit all stops from a fixed start" TSP.

For typical loads (5–40 stops) a greedy nearest-neighbor seed + full 2-opt
local search finds an optimal or near-optimal tour in milliseconds. No
external dependency required.
"""
from __future__ import annotations

import math
from typing import Iterable

Point = tuple[float, float]  # (lat, lng)


def haversine_m(a: Point, b: Point) -> float:
    """Great-circle distance in meters between two (lat, lng) points."""
    lat1, lon1 = a
    lat2, lon2 = b
    r = 6_371_000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlmb = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _tour_length(points: list[Point], order: list[int]) -> float:
    """Length of the open tour points[0] -> points[order[0]] -> ... points[order[-1]].

    Here index 0 in `points` is the depot/start. `order` lists indices >= 1.
    """
    total = 0.0
    prev = points[0]
    for idx in order:
        cur = points[idx]
        total += haversine_m(prev, cur)
        prev = cur
    return total


def _nearest_neighbor(points: list[Point]) -> list[int]:
    n = len(points)
    remaining = set(range(1, n))
    order: list[int] = []
    current = 0
    while remaining:
        nxt = min(remaining, key=lambda i: haversine_m(points[current], points[i]))
        order.append(nxt)
        remaining.remove(nxt)
        current = nxt
    return order


def _two_opt(points: list[Point], order: list[int], max_passes: int = 50) -> list[int]:
    """Standard 2-opt local search. Returns an improved order."""
    n = len(order)
    if n < 3:
        return order

    best = order[:]
    best_len = _tour_length(points, best)

    for _ in range(max_passes):
        improved = False
        for i in range(n - 1):
            for j in range(i + 1, n):
                # Reverse the segment [i:j+1]
                candidate = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                candidate_len = _tour_length(points, candidate)
                if candidate_len + 1e-6 < best_len:
                    best = candidate
                    best_len = candidate_len
                    improved = True
        if not improved:
            break

    return best


def optimize(start: Point, stops: Iterable[Point]) -> tuple[list[int], float]:
    """Compute the delivery order.

    Args:
        start: (lat, lng) of depot / start point.
        stops: iterable of (lat, lng) tuples for each stop, in original order.

    Returns:
        (delivery_order, total_distance_m) where delivery_order is a list of
        indices into the original `stops` iterable, in the order they should
        be visited from `start`.
    """
    stops_list = list(stops)
    if not stops_list:
        return [], 0.0

    points: list[Point] = [start] + stops_list
    order = _nearest_neighbor(points)
    order = _two_opt(points, order)
    # `order` holds indices into `points` (1-based relative to stops).
    delivery = [i - 1 for i in order]
    return delivery, _tour_length(points, order)

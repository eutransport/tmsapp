"""Route optimization with time-window support.

Design:
- Route is a **closed loop**: depot -> stops -> depot. The vehicle always
  returns to its starting location.
- Stops with a time window (start and/or end) are visited **in ascending time
  order** — the AI-extracted time is treated as a hard sequencing constraint
  because a driver cannot be at a customer before they open.
- Stops without a time window are inserted greedily at the position that
  minimizes total added distance (classic "cheapest insertion" heuristic).
- After insertion, a 2-opt local search runs and rejects any swap that would
  break the time-windowed ordering.

For typical loads (5-40 stops) this yields a near-optimal tour in milliseconds.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Optional

Point = tuple[float, float]  # (lat, lng)


@dataclass
class StopSpec:
    index: int                       # original index in the caller's list
    point: Point
    tw_start_min: Optional[int]      # minutes since midnight, or None
    tw_end_min: Optional[int]        # minutes since midnight, or None

    @property
    def sort_key(self) -> Optional[int]:
        """Key used to order time-windowed stops. Prefer start, else end."""
        if self.tw_start_min is not None:
            return self.tw_start_min
        return self.tw_end_min


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


def _leg(a_idx: int, b_idx: int, matrix: Optional[list[list[float]]], points: list[Point]) -> float:
    """Distance between two matrix indices. Index 0 = depot, 1..N = stops."""
    if matrix is not None:
        return matrix[a_idx][b_idx]
    a = points[a_idx]
    b = points[b_idx]
    return haversine_m(a, b)


def _closed_tour_length(
    depot: Point,
    ordered: list[StopSpec],
    matrix: Optional[list[list[float]]] = None,
    points: Optional[list[Point]] = None,
) -> float:
    if not ordered:
        return 0.0
    if matrix is not None and points is not None:
        total = matrix[0][ordered[0].index + 1]
        for i in range(1, len(ordered)):
            total += matrix[ordered[i - 1].index + 1][ordered[i].index + 1]
        total += matrix[ordered[-1].index + 1][0]
        return total
    total = haversine_m(depot, ordered[0].point)
    for i in range(1, len(ordered)):
        total += haversine_m(ordered[i - 1].point, ordered[i].point)
    total += haversine_m(ordered[-1].point, depot)
    return total


def _cheapest_insertion(
    depot: Point,
    base: list[StopSpec],
    extras: list[StopSpec],
    matrix: Optional[list[list[float]]] = None,
) -> list[StopSpec]:
    """Insert each extra stop at the position minimizing added tour length."""
    route = list(base)

    def leg(from_idx: Optional[int], to_idx: Optional[int], from_pt: Point, to_pt: Point) -> float:
        # None => depot (matrix row/col 0)
        if matrix is not None:
            fi = 0 if from_idx is None else from_idx + 1
            ti = 0 if to_idx is None else to_idx + 1
            return matrix[fi][ti]
        return haversine_m(from_pt, to_pt)

    for stop in extras:
        best_pos = 0
        best_delta = float('inf')
        for pos in range(len(route) + 1):
            prev_idx = route[pos - 1].index if pos > 0 else None
            next_idx = route[pos].index if pos < len(route) else None
            prev_point = route[pos - 1].point if pos > 0 else depot
            next_point = route[pos].point if pos < len(route) else depot
            old_leg = leg(prev_idx, next_idx, prev_point, next_point)
            new_leg = (
                leg(prev_idx, stop.index, prev_point, stop.point)
                + leg(stop.index, next_idx, stop.point, next_point)
            )
            delta = new_leg - old_leg
            if delta < best_delta:
                best_delta = delta
                best_pos = pos
        route.insert(best_pos, stop)
    return route


def _two_opt_respecting_windows(
    depot: Point,
    route: list[StopSpec],
    matrix: Optional[list[list[float]]] = None,
    points: Optional[list[Point]] = None,
    max_passes: int = 30,
) -> list[StopSpec]:
    """2-opt local search that keeps time-windowed stops in ascending order."""
    n = len(route)
    if n < 3:
        return route

    def valid(candidate: list[StopSpec]) -> bool:
        prev_key: Optional[int] = None
        for s in candidate:
            k = s.sort_key
            if k is None:
                continue
            if prev_key is not None and k < prev_key:
                return False
            prev_key = k
        return True

    best = route[:]
    best_len = _closed_tour_length(depot, best, matrix, points)

    for _ in range(max_passes):
        improved = False
        # ── 2-opt: reverse subsegments ──────────────────────────────────
        for i in range(n - 1):
            for j in range(i + 1, n):
                candidate = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                if not valid(candidate):
                    continue
                cand_len = _closed_tour_length(depot, candidate, matrix, points)
                if cand_len + 1e-6 < best_len:
                    best = candidate
                    best_len = cand_len
                    improved = True
        # ── or-opt: relocate segments of length 1..3 to a better spot ──
        # This catches "cluster splitting" that 2-opt can't fix, e.g.
        # A → B → C_far → D → E → F → B (where B belongs next to E).
        n_cur = len(best)
        for seg_len in (1, 2, 3):
            for i in range(n_cur - seg_len + 1):
                segment = best[i:i + seg_len]
                remainder = best[:i] + best[i + seg_len:]
                for insert_at in range(len(remainder) + 1):
                    if insert_at == i:
                        continue  # same position
                    candidate = remainder[:insert_at] + segment + remainder[insert_at:]
                    if not valid(candidate):
                        continue
                    cand_len = _closed_tour_length(depot, candidate, matrix, points)
                    if cand_len + 1e-6 < best_len:
                        best = candidate
                        best_len = cand_len
                        improved = True
                        break  # restart segment loop with new `best`
                else:
                    continue
                break
        if not improved:
            break
    return best


def optimize_with_windows(
    start: Point,
    stops: Iterable[tuple[Point, Optional[int], Optional[int]]],
    distance_matrix: Optional[list[list[float]]] = None,
    duration_matrix: Optional[list[list[float]]] = None,
) -> tuple[list[int], float, float]:
    """Compute a closed-loop delivery order respecting time windows.

    Args:
        start: (lat, lng) of depot. The route ends here too.
        stops: iterable of (point, tw_start_min, tw_end_min) tuples. Time
               values are minutes since midnight, or None if no window.
        distance_matrix: optional (N+1)×(N+1) road-distance matrix (meters).
            Index 0 = depot, indices 1..N = stops in input order. When
            provided the optimiser uses real road distance instead of
            haversine bird's-eye.
        duration_matrix: optional (N+1)×(N+1) driving-duration matrix
            (seconds), used to compute total drive time.

    Returns:
        (delivery_order, total_distance_m, total_duration_s). `delivery_order`
        lists original indices in visit order (depot not included).
    """
    specs = [
        StopSpec(index=i, point=pt, tw_start_min=ws, tw_end_min=we)
        for i, (pt, ws, we) in enumerate(stops)
    ]
    if not specs:
        return [], 0.0, 0.0

    points_all: list[Point] = [start] + [s.point for s in specs]

    # ── Try the proper VRP solver first (OR-Tools GUIDED_LOCAL_SEARCH) ──
    # This handles dense urban clusters much better than 2-opt/or-opt alone.
    from .vrp_solver import solve_tsp

    ortools_order: Optional[list[int]] = None
    if distance_matrix is not None:
        tws = [(s.tw_start_min, s.tw_end_min) for s in specs]
        ortools_order = solve_tsp(
            distance_matrix=distance_matrix,
            time_windows=tws,
            duration_matrix=duration_matrix,
            service_time_min=10,
            time_limit_s=5,
        )

    if ortools_order is not None:
        # Convert stop indices back to StopSpec order
        route = [specs[i] for i in ortools_order]
    else:
        # Fallback: legacy heuristic
        windowed = [s for s in specs if s.sort_key is not None]
        unwindowed = [s for s in specs if s.sort_key is None]
        windowed.sort(key=lambda s: s.sort_key or 0)
        route = _cheapest_insertion(start, windowed, unwindowed, distance_matrix)
        route = _two_opt_respecting_windows(start, route, distance_matrix, points_all)

    order = [s.index for s in route]
    total_m = _closed_tour_length(start, route, distance_matrix, points_all)

    total_s = 0.0
    if duration_matrix is not None and route:
        total_s += duration_matrix[0][route[0].index + 1]
        for i in range(1, len(route)):
            total_s += duration_matrix[route[i - 1].index + 1][route[i].index + 1]
        total_s += duration_matrix[route[-1].index + 1][0]

    return order, total_m, total_s


def optimize(start: Point, stops: Iterable[Point]) -> tuple[list[int], float]:
    """Legacy entry point (no time windows). Closed-loop with 2-opt."""
    stops_list = list(stops)
    if not stops_list:
        return [], 0.0
    order, dist, _ = optimize_with_windows(start, [(pt, None, None) for pt in stops_list])
    return order, dist

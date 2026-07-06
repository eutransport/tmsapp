"""Vehicle Routing Problem solver using Google OR-Tools.

This is a *proper* VRP solver that beats hand-rolled heuristics on dense
urban clusters where 2-opt/or-opt get stuck in local optima. It uses
GUIDED_LOCAL_SEARCH with a wall-clock time budget.

Falls back to the caller's simpler heuristic when OR-Tools is not installed
or fails to find a solution (extremely rare for TSP-sized problems).
"""
from __future__ import annotations

import logging
from typing import Optional

logger = logging.getLogger(__name__)

Point = tuple[float, float]  # (lat, lng)


def solve_tsp(
    distance_matrix: list[list[float]],
    time_windows: Optional[list[tuple[Optional[int], Optional[int]]]] = None,
    duration_matrix: Optional[list[list[float]]] = None,
    service_time_min: int = 10,
    depot_open_min: Optional[int] = None,
    depot_close_min: Optional[int] = None,
    time_limit_s: int = 5,
) -> Optional[list[int]]:
    """Return the optimal visit order for a single-vehicle closed tour.

    Args:
        distance_matrix: (N+1)×(N+1) matrix in meters. Index 0 = depot,
            1..N = stops. Symmetric or asymmetric both fine.
        time_windows: optional list of (start_min, end_min) tuples for each
            stop (N entries, one per stop, NOT including the depot). Values
            are minutes since midnight; use None for "no constraint".
        duration_matrix: (N+1)×(N+1) matrix in seconds for driving durations.
            Required when time_windows is provided; otherwise ignored.
        service_time_min: fixed drop-off time per stop (added at arrival).
        depot_open_min / depot_close_min: global window for the depot.
        time_limit_s: solver wall-clock budget.

    Returns:
        Ordered list of stop indices (1-based, but *offset by -1* so index 0
        in the return refers to the first stop, i.e. matrix row 1). Returns
        None if OR-Tools is unavailable or no feasible solution was found.
    """
    try:
        from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    except ImportError:
        logger.info('ortools not installed — skipping VRP solver')
        return None

    n_nodes = len(distance_matrix)
    if n_nodes < 2:
        return []
    n_stops = n_nodes - 1

    # OR-Tools works with integers — scale meters to int (already ~integer).
    int_dist = [[int(round(x)) for x in row] for row in distance_matrix]

    manager = pywrapcp.RoutingIndexManager(n_nodes, 1, 0)  # 1 vehicle, depot=0
    routing = pywrapcp.RoutingModel(manager)

    def distance_cb(from_index: int, to_index: int) -> int:
        return int_dist[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    transit_idx = routing.RegisterTransitCallback(distance_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    # Time dimension (only if we have durations + windows)
    use_time = time_windows is not None and duration_matrix is not None and any(
        (tw[0] is not None or tw[1] is not None) for tw in (time_windows or [])
    )
    if use_time:
        service_s = service_time_min * 60
        int_dur = [[int(round(x)) for x in row] for row in duration_matrix]  # type: ignore[arg-type]

        def time_cb(from_index: int, to_index: int) -> int:
            f = manager.IndexToNode(from_index)
            t = manager.IndexToNode(to_index)
            # Service time is added when leaving a customer node (not the depot).
            return int_dur[f][t] + (service_s if f != 0 else 0)

        time_idx = routing.RegisterTransitCallback(time_cb)
        horizon = 24 * 3600
        routing.AddDimension(
            time_idx,
            horizon,      # allow waiting at a stop until its window opens
            horizon,      # max total time
            False,        # don't force start cumul to zero
            'Time',
        )
        time_dim = routing.GetDimensionOrDie('Time')

        # Depot window
        depot_open_s = (depot_open_min or 0) * 60
        depot_close_s = (depot_close_min or (24 * 60 - 1)) * 60
        for vehicle_id in range(1):
            index = routing.Start(vehicle_id)
            time_dim.CumulVar(index).SetRange(depot_open_s, depot_close_s)
            end_index = routing.End(vehicle_id)
            time_dim.CumulVar(end_index).SetRange(depot_open_s, depot_close_s)

        # Per-stop windows
        for stop_i, (ws, we) in enumerate(time_windows or []):  # type: ignore[arg-type]
            node = stop_i + 1
            index = manager.NodeToIndex(node)
            lo = (ws or 0) * 60
            hi = (we or (24 * 60 - 1)) * 60
            if lo <= hi:
                time_dim.CumulVar(index).SetRange(lo, hi)

    # Search parameters — GUIDED_LOCAL_SEARCH is the killer combo for TSP/VRP.
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromSeconds(max(1, min(int(time_limit_s), 30)))

    solution = routing.SolveWithParameters(params)
    if solution is None:
        logger.warning('OR-Tools returned no solution for %d nodes', n_nodes)
        return None

    order: list[int] = []
    index = routing.Start(0)
    while not routing.IsEnd(index):
        node = manager.IndexToNode(index)
        if node != 0:  # skip depot
            order.append(node - 1)  # convert to 0-based stop index
        index = solution.Value(routing.NextVar(index))
    if len(order) != n_stops:
        logger.warning('OR-Tools returned partial tour (%d/%d stops)', len(order), n_stops)
        return None
    return order

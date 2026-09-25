"""Edge weight & impedance models for flood-aware routing."""

from typing import Any, Dict, List, Optional
import networkx as nx

from app.core.logging import get_logger

logger = get_logger("routing.weights")

IMPASSABLE_PENALTY = 1e9  # Effectively infinite weight for impassable flooded roads



def get_edge_flood_penalty(base_time_s: float, depth_m: float) -> tuple[float, bool]:
    """
    Computes modified edge traversal time based on water depth.

    Thresholds:
    - depth >= 0.30m (HIGH/CRITICAL): Impassable for passenger vehicles.
    - depth 0.15m - 0.30m (MODERATE): Severe speed reduction (3.0x).
    - depth 0.05m - 0.15m (LOW): Caution / mild reduction (1.3x).
    - depth < 0.05m: Dry road (1.0x).

    Returns (effective_weight_s, is_impassable)
    """
    d = max(float(depth_m), 0.0)

    if d >= 0.30:
        return IMPASSABLE_PENALTY, True
    elif d >= 0.15:
        return base_time_s * 3.0, False
    elif d >= 0.05:
        return base_time_s * 1.3, False
    else:
        return base_time_s, False


def apply_flood_depths_to_graph(
    graph: nx.DiGraph,
    flooded_segments: Optional[Dict[str, float]] = None,
    default_depth_m: float = 0.0,
) -> int:
    """
    Updates the weight of every edge in the graph.
    flooded_segments maps edge_id or road_id to water depth in meters.
    Returns the number of impassable edges detected.
    """
    flood_map = flooded_segments or {}
    impassable_count = 0

    for u, v, data in graph.edges(data=True):
        edge_id = data.get("edge_id", "")
        # Look up depth by specific segment id or road prefix
        depth = flood_map.get(edge_id, default_depth_m)
        if depth == 0.0:
            prefix = edge_id.rsplit("_", 1)[0]
            depth = flood_map.get(prefix, default_depth_m)

        weight, impassable = get_edge_flood_penalty(data.get("base_time_s", 1.0), depth)
        data["weight"] = weight
        data["water_depth_m"] = depth
        data["impassable"] = impassable

        if impassable:
            impassable_count += 1

    logger.debug(f"Applied flood weights: {impassable_count} segments marked impassable")
    return impassable_count

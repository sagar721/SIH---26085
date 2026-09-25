"""Shortest safe pathfinding algorithm with flood avoidance for Mumbai."""

from typing import Any, Dict, List, Optional, Tuple
import networkx as nx

from app.core.exceptions import RoutingError
from app.core.logging import get_logger
from app.routing.graph import RoadNetworkGraph, road_network
from app.routing.weights import IMPASSABLE_PENALTY, apply_flood_depths_to_graph

logger = get_logger("routing.pathfinding")


class SafeRouter:
    """Computes flood-aware evacuation and emergency routes."""

    def __init__(self, network: Optional[RoadNetworkGraph] = None) -> None:
        self.network = network or road_network

    def _ensure_graph(self) -> nx.DiGraph:
        if not self.network._built:
            self.network.build_from_geojson()
        return self.network.graph

    def compute_safe_route(
        self,
        start_lon: float,
        start_lat: float,
        dest_lon: float,
        dest_lat: float,
        flooded_segments: Optional[Dict[str, float]] = None,
    ) -> Dict[str, Any]:
        """
        Calculates safe route avoiding flooded sections between start and destination.
        Returns GeoJSON route response with distance, duration, and clearance status.
        """
        graph = self._ensure_graph()

        if graph.number_of_nodes() == 0:
            return {
                "status": "UNAVAILABLE",
                "error": "Road network graph is empty; OSM road data not loaded",
                "result_type": "DERIVED",
            }

        start_node = self.network.find_nearest_node(start_lon, start_lat)
        dest_node = self.network.find_nearest_node(dest_lon, dest_lat)

        if not start_node or not dest_node:
            return {
                "status": "UNAVAILABLE",
                "error": "Could not map start or destination coordinates to road network",
                "result_type": "DERIVED",
            }

        if start_node == dest_node:
            return {
                "status": "AVAILABLE",
                "clearance": "SAFE",
                "distance_m": 0.0,
                "duration_minutes": 0.0,
                "result_type": "DERIVED",
                "geojson": {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": [[start_lon, start_lat], [dest_lon, dest_lat]]},
                    "properties": {"status": "AT_DESTINATION"},
                },
                "hazards_encountered": 0,
            }

        # Apply flood depth penalties to graph edges
        apply_flood_depths_to_graph(graph, flooded_segments=flooded_segments)

        # 1. Compute Safe Route
        try:
            safe_node_path = nx.shortest_path(graph, source=start_node, target=dest_node, weight="weight")
            safe_path_cost = nx.shortest_path_length(graph, source=start_node, target=dest_node, weight="weight")
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return {
                "status": "IMPASSABLE",
                "error": "No viable route exists; destination is topologically isolated or cut off by flood waters",
                "clearance": "BLOCKED",
                "result_type": "DERIVED",
            }

        if safe_path_cost >= IMPASSABLE_PENALTY:
            return {
                "status": "IMPASSABLE",
                "error": "All viable road routes exceed critical flood depth thresholds (>= 0.30m)",
                "clearance": "BLOCKED",
                "result_type": "DERIVED",
            }

        # 2. Extract safe route geometry, distance, and duration
        route_coords: List[List[float]] = []
        total_distance_m = 0.0
        total_duration_s = 0.0
        hazards_count = 0
        max_water_depth_m = 0.0

        for i in range(len(safe_node_path) - 1):
            u, v = safe_node_path[i], safe_node_path[i + 1]
            edge_data = graph.get_edge_data(u, v) or {}

            seg_coords = edge_data.get("geometry", [])
            if seg_coords:
                if not route_coords:
                    route_coords.extend(seg_coords)
                else:
                    route_coords.extend(seg_coords[1:])

            length = edge_data.get("length_m", 0.0)
            base_time = edge_data.get("base_time_s", 0.0)
            depth = edge_data.get("water_depth_m", 0.0)

            total_distance_m += length
            total_duration_s += base_time * (3.0 if depth >= 0.15 else (1.3 if depth >= 0.05 else 1.0))

            if depth >= 0.05:
                hazards_count += 1
            if depth > max_water_depth_m:
                max_water_depth_m = depth

        clearance_status = "SAFE"
        if max_water_depth_m >= 0.15:
            clearance_status = "CAUTION_PASSABLE"

        return {
            "status": "AVAILABLE",
            "clearance": clearance_status,
            "distance_m": round(total_distance_m, 1),
            "distance_km": round(total_distance_m / 1000.0, 2),
            "duration_minutes": round(total_duration_s / 60.0, 1),
            "max_water_depth_m": round(max_water_depth_m, 2),
            "hazards_encountered": hazards_count,
            "result_type": "DERIVED",
            "geojson": {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": route_coords if route_coords else [[start_lon, start_lat], [dest_lon, dest_lat]],
                },
                "properties": {
                    "start": [start_lon, start_lat],
                    "destination": [dest_lon, dest_lat],
                    "distance_m": round(total_distance_m, 1),
                    "duration_minutes": round(total_duration_s / 60.0, 1),
                    "clearance": clearance_status,
                },
            },
        }


safe_router = SafeRouter()

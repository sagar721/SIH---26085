"""Road network graph builder for Mumbai flood-aware routing."""

from typing import Any, Dict, List, Optional, Tuple
import networkx as nx
from scipy.spatial import cKDTree
from shapely.geometry import Point, shape

from app.core.logging import get_logger
from app.gis.crs import calculate_metric_length_m, to_projected_metric
from app.services.gis_service import gis_service

logger = get_logger("routing.graph")

DEFAULT_SPEEDS_KMH = {
    "motorway": 70.0,
    "trunk": 60.0,
    "primary": 50.0,
    "secondary": 40.0,
    "tertiary": 30.0,
    "residential": 25.0,
    "living_street": 15.0,
    "unclassified": 25.0,
}
FALLBACK_SPEED_KMH = 30.0


class RoadNetworkGraph:
    """Directed graph representing the topological street network in Mumbai."""

    def __init__(self) -> None:
        self.graph: nx.DiGraph = nx.DiGraph()
        self.node_spatial_index: List[Tuple[str, float, float, Tuple[float, float]]] = []
        self._node_ids: List[str] = []
        self._node_kdtree: Optional[cKDTree] = None
        self._built: bool = False

    def build_from_geojson(self, road_features: Optional[List[Dict[str, Any]]] = None) -> nx.DiGraph:
        """Constructs a routable directed graph from GeoJSON road LineStrings."""
        self.graph.clear()
        self.node_spatial_index.clear()
        self._node_ids.clear()
        self._node_kdtree = None

        if road_features is None:
            roads_data = gis_service.get_roads()
            road_features = roads_data.get("features", [])

        if not road_features:
            logger.warning("No road features available to build road network graph")
            self._built = False
            return self.graph

        segment_count = 0
        for feat in road_features:
            geom = feat.get("geometry")
            if not geom or geom.get("type") != "LineString":
                continue

            coords = geom.get("coordinates", [])
            if len(coords) < 2:
                continue

            props = feat.get("properties") or {}
            road_id = str(props.get("id") or props.get("osm_id") or segment_count)
            highway = props.get("highway", "unclassified")
            oneway = str(props.get("oneway", "no")).lower() in ("yes", "true", "1")
            speed_kmh = DEFAULT_SPEEDS_KMH.get(highway, FALLBACK_SPEED_KMH)
            speed_ms = max(speed_kmh * (1000.0 / 3600.0), 1.0)

            # Subdivide line into individual pairwise road segments
            for i in range(len(coords) - 1):
                p1_lon, p1_lat = coords[i][0], coords[i][1]
                p2_lon, p2_lat = coords[i + 1][0], coords[i + 1][1]

                node_u = f"{p1_lon:.6f},{p1_lat:.6f}"
                node_v = f"{p2_lon:.6f},{p2_lat:.6f}"

                # Calculate true ground metric length in meters using UTM 43N
                geom_segment = {"type": "LineString", "coordinates": [[p1_lon, p1_lat], [p2_lon, p2_lat]]}
                shapely_seg = shape(geom_segment)
                length_m = calculate_metric_length_m(shapely_seg)
                if length_m <= 0:
                    length_m = 1.0

                base_time_s = length_m / speed_ms

                # Record node coordinates
                if node_u not in self.graph:
                    p1_proj = to_projected_metric(Point(p1_lon, p1_lat))
                    self.graph.add_node(node_u, lon=p1_lon, lat=p1_lat, x=p1_proj.x, y=p1_proj.y)
                    self.node_spatial_index.append((node_u, p1_proj.x, p1_proj.y, (p1_lon, p1_lat)))

                if node_v not in self.graph:
                    p2_proj = to_projected_metric(Point(p2_lon, p2_lat))
                    self.graph.add_node(node_v, lon=p2_lon, lat=p2_lat, x=p2_proj.x, y=p2_proj.y)
                    self.node_spatial_index.append((node_v, p2_proj.x, p2_proj.y, (p2_lon, p2_lat)))

                # Add forward edge
                self.graph.add_edge(
                    node_u,
                    node_v,
                    edge_id=f"{road_id}_{i}",
                    length_m=length_m,
                    base_time_s=base_time_s,
                    weight=base_time_s,
                    highway=highway,
                    water_depth_m=0.0,
                    impassable=False,
                    geometry=[[p1_lon, p1_lat], [p2_lon, p2_lat]],
                )

                # Add reverse edge unless strictly one-way
                if not oneway:
                    self.graph.add_edge(
                        node_v,
                        node_u,
                        edge_id=f"{road_id}_{i}_rev",
                        length_m=length_m,
                        base_time_s=base_time_s,
                        weight=base_time_s,
                        highway=highway,
                        water_depth_m=0.0,
                        impassable=False,
                        geometry=[[p2_lon, p2_lat], [p1_lon, p1_lat]],
                    )

                segment_count += 1

        if self.node_spatial_index:
            self._node_ids = [entry[0] for entry in self.node_spatial_index]
            self._node_kdtree = cKDTree(
                [(entry[1], entry[2]) for entry in self.node_spatial_index]
            )

        self._built = len(self.graph.nodes) > 0
        logger.info(
            f"Road network graph built: {self.graph.number_of_nodes()} nodes, {self.graph.number_of_edges()} edges"
        )
        return self.graph

    def find_nearest_node(self, lon: float, lat: float) -> Optional[str]:
        """Find the closest road graph node to target coordinates using UTM 43N metric distance."""
        if not self.node_spatial_index:
            return None

        target_proj = to_projected_metric(Point(lon, lat))
        tx, ty = target_proj.x, target_proj.y

        if self._node_kdtree is None or not self._node_ids:
            return None

        _, nearest_index = self._node_kdtree.query((tx, ty), k=1)
        return self._node_ids[int(nearest_index)]


road_network = RoadNetworkGraph()

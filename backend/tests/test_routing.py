import pytest
import networkx as nx

from app.routing.graph import RoadNetworkGraph
from app.routing.weights import (
    IMPASSABLE_PENALTY,
    apply_flood_depths_to_graph,
    get_edge_flood_penalty,
)
from app.routing.pathfinding import SafeRouter


@pytest.fixture
def sample_road_features():
    """A 3-node linear road network: A -> B -> C and C -> B -> A."""
    return [
        {
            "type": "Feature",
            "properties": {"id": "road_1", "highway": "primary", "oneway": "no"},
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [72.8600, 19.0700],  # Node A (Kurla)
                    [72.8700, 19.0750],  # Node B (Midpoint)
                    [72.8800, 19.0800],  # Node C (BKC / Kalina)
                ],
            },
        }
    ]


def test_road_network_graph_construction(sample_road_features):
    net = RoadNetworkGraph()
    graph = net.build_from_geojson(sample_road_features)

    assert graph.number_of_nodes() == 3
    # Two bidirectional segments: A<->B and B<->C => 4 directed edges
    assert graph.number_of_edges() == 4

    nearest = net.find_nearest_node(72.8601, 19.0701)
    assert nearest is not None
    assert nearest.startswith("72.860000")


def test_flood_penalty_weight_calculation():
    base_time = 100.0

    # Dry road (<0.05m): 1.0x
    w, impassable = get_edge_flood_penalty(base_time, depth_m=0.02)
    assert w == pytest.approx(100.0)
    assert not impassable

    # Low flood (0.05m - 0.15m): 1.3x
    w, impassable = get_edge_flood_penalty(base_time, depth_m=0.10)
    assert w == pytest.approx(130.0)
    assert not impassable

    # Moderate flood (0.15m - 0.30m): 3.0x
    w, impassable = get_edge_flood_penalty(base_time, depth_m=0.20)
    assert w == pytest.approx(300.0)
    assert not impassable

    # Critical flood (>= 0.30m): impassable
    w, impassable = get_edge_flood_penalty(base_time, depth_m=0.45)
    assert w >= IMPASSABLE_PENALTY
    assert impassable


def test_safe_router_computes_route(sample_road_features):
    net = RoadNetworkGraph()
    net.build_from_geojson(sample_road_features)
    router = SafeRouter(network=net)

    # Route from Node A to Node C
    result = router.compute_safe_route(
        start_lon=72.8600,
        start_lat=19.0700,
        dest_lon=72.8800,
        dest_lat=19.0800,
    )

    assert result["status"] == "AVAILABLE"
    assert result["clearance"] == "SAFE"
    assert result["distance_m"] > 0
    assert result["geojson"]["geometry"]["type"] == "LineString"
    assert len(result["geojson"]["geometry"]["coordinates"]) >= 3


def test_safe_router_detects_impassable_flood(sample_road_features):
    net = RoadNetworkGraph()
    net.build_from_geojson(sample_road_features)
    router = SafeRouter(network=net)

    # Completely sever the only road with 0.50m flood water
    result = router.compute_safe_route(
        start_lon=72.8600,
        start_lat=19.0700,
        dest_lon=72.8800,
        dest_lat=19.0800,
        flooded_segments={"road_1": 0.50},
    )

    assert result["status"] == "IMPASSABLE"
    assert result["clearance"] == "BLOCKED"

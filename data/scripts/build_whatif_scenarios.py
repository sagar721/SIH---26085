"""PHASE 4 — Baseline vs. drainage-intervention what-if comparison.

Runs flood_propagation_engine.run_flood_simulation() TWICE over the same
SIMULATED design-storm rainfall (see flood_propagation_engine.py) with two
different drainage-capacity multipliers applied to the Phase-2 ESTIMATED
per-node capacity:

  - "baseline" (0.7x): today's assumed real-world condition — drains
    conveying less than their nominal design capacity due to siltation /
    encroachment / deferred maintenance, i.e. the "heavily strained
    underground drainage networks" the problem statement itself names.
  - "intervention" (1.3x): a SIMULATED hypothetical where that capacity is
    restored AND moderately expanded (e.g. desilting plus larger pipes on
    the worst bottlenecks) — a hypothetical scenario for comparison, never
    a planned or funded MCGM project.

Both multipliers are documented, round-number ESTIMATED assumptions, not
measured before/after engineering figures. Output is a per-zone comparison
of flooded extent, max depth, onset time, and which real roads/infrastructure
fall near a flooded drainage node in each scenario (proximity-based, not a
hydraulic overland-flow solve).
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, PILOT_ZONES, get_logger, now_iso, write_json
from flood_propagation_engine import (
    BASELINE_DRAINAGE_EFFICIENCY,
    DESIGN_STORM_MM_HR,
    DESIGN_STORM_PEAK_SOURCE,
    NODE_BASIN_AREA_M2,
    OUT_DIR as PROPAGATION_DIR,
    run_flood_simulation,
)

log = get_logger("build_whatif_scenarios")

OUT_DIR = DATA_ROOT / "processed" / "flood_model" / "whatif"
FLOOD_MODEL_DIR = DATA_ROOT / "processed" / "flood_model"

INTERVENTION_CAPACITY_MULTIPLIER = 1.3
FLOOD_IMPACT_DEPTH_THRESHOLD_M = 0.15  # PS's own "15-30cm" bin floor — moderate-and-above only
PROXIMITY_THRESHOLD_M = 40.0  # ~ one drainage-graph node spacing (see build_drainage_graph.py GRID_SIZE)

SCENARIOS = {
    "baseline": BASELINE_DRAINAGE_EFFICIENCY,
    "intervention": INTERVENTION_CAPACITY_MULTIPLIER,
}


def haversine_m(lon1, lat1, lon2, lat2):
    R = 6371000.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlambda / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def nearest_flooded_distance_m(point_lon, point_lat, flooded_lonlat: np.ndarray) -> float:
    if len(flooded_lonlat) == 0:
        return float("inf")
    # Small zone (few km) — plain equirectangular approx is accurate enough here,
    # avoids a scipy.spatial dependency just for a same-order-of-magnitude filter.
    dlon = flooded_lonlat[:, 0] - point_lon
    dlat = flooded_lonlat[:, 1] - point_lat
    lat_scale = np.cos(np.radians(point_lat))
    dist_deg = np.sqrt((dlon * lat_scale) ** 2 + dlat ** 2)
    nearest_idx = int(np.argmin(dist_deg))
    return float(haversine_m(point_lon, point_lat, flooded_lonlat[nearest_idx, 0], flooded_lonlat[nearest_idx, 1]))


def road_midpoint(geom) -> tuple[float, float]:
    coords = geom["coordinates"]
    mid = coords[len(coords) // 2]
    return mid[0], mid[1]


def peak_flooded_points(zone_id: str, scenario_label: str) -> np.ndarray:
    """Returns Nx2 array of [lon, lat] for graph nodes at >= FLOOD_IMPACT_DEPTH_THRESHOLD_M
    depth at the timestep of peak flooding for this scenario run."""
    import json

    with open(PROPAGATION_DIR / f"{zone_id}_{scenario_label}_summary.json") as f:
        summary = json.load(f)
    peak_frame = max(summary["frames"], key=lambda fr: fr["max_depth_m"])
    with open(PROPAGATION_DIR / peak_frame["file"]) as f:
        fc = json.load(f)
    pts = [
        feat["geometry"]["coordinates"]
        for feat in fc["features"]
        if feat["properties"]["depth_m"] >= FLOOD_IMPACT_DEPTH_THRESHOLD_M
    ]
    return np.array(pts) if pts else np.zeros((0, 2))


def impacted_features(zone_id: str, flooded_lonlat: np.ndarray) -> dict:
    import json

    roads_path = FLOOD_MODEL_DIR / f"{zone_id}_roads_risk.geojson"
    infra_path = FLOOD_MODEL_DIR / f"{zone_id}_infrastructure_risk.geojson"

    affected_roads = []
    if roads_path.exists():
        with open(roads_path) as f:
            roads = json.load(f)["features"]
        for feat in roads:
            lon, lat = road_midpoint(feat["geometry"])
            d = nearest_flooded_distance_m(lon, lat, flooded_lonlat)
            if d <= PROXIMITY_THRESHOLD_M:
                p = feat["properties"]
                affected_roads.append({
                    "osm_id": p.get("osm_id"), "name": p.get("name"), "highway": p.get("highway"),
                    "distance_to_flooded_node_m": round(d, 1),
                })

    affected_infra = []
    if infra_path.exists():
        with open(infra_path) as f:
            infra = json.load(f)["features"]
        for feat in infra:
            lon, lat = feat["geometry"]["coordinates"]
            d = nearest_flooded_distance_m(lon, lat, flooded_lonlat)
            if d <= PROXIMITY_THRESHOLD_M:
                p = feat["properties"]
                affected_infra.append({
                    "name": p.get("NAME") or p.get("name"), "type": p.get("TYPE") or p.get("amenity"),
                    "distance_to_flooded_node_m": round(d, 1),
                })

    return {
        "affected_road_count": len(affected_roads),
        "affected_roads_sample": affected_roads[:15],
        "affected_infrastructure_count": len(affected_infra),
        "affected_infrastructure": affected_infra,
    }


def run_zone_comparison(zone_id: str) -> dict:
    scenario_summaries = {}
    for name, multiplier in SCENARIOS.items():
        scenario_summaries[name] = run_flood_simulation(
            zone_id, DESIGN_STORM_MM_HR, f"whatif_{name}",
            f"SIMULATED design-storm scenario (same rainfall as flood_propagation_engine.py's default run). "
            f"{DESIGN_STORM_PEAK_SOURCE}",
            capacity_multiplier=multiplier,
        )

    comparison = {}
    for name in SCENARIOS:
        s = scenario_summaries[name]
        flooded_pts = peak_flooded_points(zone_id, f"whatif_{name}")
        impact = impacted_features(zone_id, flooded_pts)
        peak_flooded_node_count = max(fr["flooded_node_count"] for fr in s["frames"])
        comparison[name] = {
            "capacity_multiplier": SCENARIOS[name],
            "max_depth_m": s["max_depth_m_overall"],
            "flood_onset_minutes": s["flood_onset_minutes"],
            "peak_flooded_node_count": peak_flooded_node_count,
            "peak_flooded_area_m2_estimate": round(peak_flooded_node_count * NODE_BASIN_AREA_M2, 1),
            **impact,
        }

    base, interv = comparison["baseline"], comparison["intervention"]
    delta = {
        "max_depth_m_reduction": round(base["max_depth_m"] - interv["max_depth_m"], 4),
        "flooded_area_m2_reduction": round(base["peak_flooded_area_m2_estimate"] - interv["peak_flooded_area_m2_estimate"], 1),
        "affected_roads_reduction": base["affected_road_count"] - interv["affected_road_count"],
        "affected_infrastructure_reduction": base["affected_infrastructure_count"] - interv["affected_infrastructure_count"],
        "onset_delay_minutes": (
            None if base["flood_onset_minutes"] is None or interv["flood_onset_minutes"] is None
            else interv["flood_onset_minutes"] - base["flood_onset_minutes"]
        ),
    }

    result = {
        "zone_id": zone_id,
        "status": "COMPLETE",
        "scenario_type": "SIMULATED — hypothetical drainage-capacity comparison for demonstration. "
                          "NOT a planned or funded MCGM infrastructure project.",
        "rainfall_scenario": "SIMULATED design storm (see flood_propagation_engine.py DESIGN_STORM_MM_HR)",
        "proximity_threshold_m": PROXIMITY_THRESHOLD_M,
        "flood_impact_depth_threshold_m": FLOOD_IMPACT_DEPTH_THRESHOLD_M,
        "comparison": comparison,
        "delta_baseline_minus_intervention": delta,
        "generated_at": now_iso(),
    }
    write_json(OUT_DIR / f"{zone_id}_whatif_comparison.json", result, log)
    return result


def main():
    results = {}
    for zone_id in PILOT_ZONES:
        results[zone_id] = run_zone_comparison(zone_id)

    log.info("=== What-if comparison summary ===")
    for zone_id, r in results.items():
        d = r["delta_baseline_minus_intervention"]
        log.info(
            f"  {zone_id}: baseline max_depth={r['comparison']['baseline']['max_depth_m']:.3f}m -> "
            f"intervention max_depth={r['comparison']['intervention']['max_depth_m']:.3f}m "
            f"(reduction {d['max_depth_m_reduction']:.3f}m); "
            f"roads affected {r['comparison']['baseline']['affected_road_count']} -> "
            f"{r['comparison']['intervention']['affected_road_count']}"
        )


if __name__ == "__main__":
    main()

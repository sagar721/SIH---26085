"""PHASE 3 — A lightweight, interpretable, drainage-aware flood propagation
engine: rainfall -> runoff -> drainage-graph capacity check -> surcharge ->
local surface accumulation -> flood depth, at T+0/30/60/90/120/150/180 min.

This is deliberately NOT a 2D hydrodynamic solver (per the problem
statement's own scoping) — it is a per-node cascade over the directed
drainage graph built by build_drainage_graph.py (Phase 2):

  1. Each graph node's real DEM-derived contributing area (flow_accumulation
     cells from Phase 2) receives rainfall at the current timestep.
  2. That rainfall is converted to runoff using a landcover-based runoff
     coefficient — sampled from the REAL, exactly-decoded ESA WorldCover
     pixel at the node's location (see LANDCOVER_RUNOFF_COEFF for the
     documented, ESTIMATED per-class coefficients; the classification
     itself is real, the coefficient values are literature-typical
     assumptions, not measured).
  3. Inflow is compared against the node's ESTIMATED capacity (Phase 2,
     anchored to MCGM's real published BRIMSTOWAD design intensity).
     Inflow beyond capacity is surcharge; spare capacity (when inflow is
     below capacity) drains any previously pooled backlog.
  4. Surcharge volume pools locally as a "bathtub" depth over a documented
     nominal basin footprint per node (ESTIMATED), persisting and receding
     across timesteps — not a full 2D routing/backflow solve.

Two scenarios are run per zone, never mixed:
  - "observed": the REAL GSMaP rainfall for the pilot zone's acquired
    window (0 mm/hr throughout — a genuine dry period, not a defect;
    produces an all-zero baseline).
  - "design_storm": a SIMULATED scenario hyetograph, peaking at MCGM's own
    REAL/OFFICIAL post-BRIMSTOWAD-1993 design intensity (50 mm/hr) — see
    mcgm_swd_official_statistics.json — distributed over 180 minutes via a
    documented, simple triangular-ish shape. This is a hypothetical design
    storm for demonstrating the engine, explicitly not an IMD/NCMRWF
    nowcast forecast.

Every output feature carries provenance="SIMULATED" (the propagated depth
is a modelled quantity regardless of which rainfall scenario drives it) plus
a "rainfall_scenario" field distinguishing OBSERVED vs SIMULATED-DESIGN-STORM
inputs, so the two are never presented as equally real.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, PILOT_ZONES, get_logger, now_iso, write_json

log = get_logger("flood_propagation_engine")

GRAPH_DIR = DATA_ROOT / "processed" / "drainage" / "graph"
LANDCOVER_DIR = DATA_ROOT / "processed" / "landcover"
RAINFALL_CSV = DATA_ROOT / "processed" / "rainfall" / "hourly" / "mumbai_processed_rainfall.csv"
OUT_DIR = DATA_ROOT / "processed" / "flood_model" / "propagation"

TIMESTEPS_MIN = [0, 30, 60, 90, 120, 150, 180]
TIMESTEP_SECONDS = 30 * 60

# SIMULATED design-storm hyetograph (mm/hr at each timestep), peaking at MCGM's
# REAL post-BRIMSTOWAD-1993 design intensity. A simple documented triangular-ish
# shape (rise to a t=60min peak, decline through t=180min) — not an official
# nowcast; chosen only to exercise the engine end-to-end since the real observed
# window for this pilot is a genuine 0 mm/hr dry period.
DESIGN_STORM_MM_HR = [5.0, 25.0, 50.0, 35.0, 20.0, 10.0, 5.0]
DESIGN_STORM_PEAK_SOURCE = (
    "Peak (50mm/hr) = MCGM's real published post-BRIMSTOWAD-1993 design intensity "
    "(mcgm_swd_official_statistics.json: design_criteria.post_brimstowad_1993). "
    "The rise/decline shape around that peak is an ASSUMED simple hyetograph, not an official forecast."
)

# ESTIMATED baseline drainage efficiency applied to Phase-2's theoretical ESTIMATED
# capacity for the default "current condition" run. Real drains rarely convey their
# full nominal design capacity in practice (siltation, encroachment, deferred
# maintenance) — this is exactly the "heavily strained underground drainage
# networks" condition named in the problem statement itself, not an invented
# pessimism. 0.7 is a documented, round-number ESTIMATED assumption (not a
# measured MCGM figure): at exactly the 50mm/hr design storm, nodes whose
# capacity was calibrated to that same intensity would otherwise almost never
# surcharge (capacity and inflow are both anchored to the same design intensity),
# which would make the engine unable to demonstrate the surcharge/backflow
# behaviour the problem statement asks for. build_whatif_scenarios.py (Phase 4)
# treats restoring this efficiency back toward 1.0 as the "drainage intervention".
BASELINE_DRAINAGE_EFFICIENCY = 0.7

# ESA WorldCover class -> ESTIMATED runoff coefficient (literature-typical values;
# NOT the same as MCGM's own catchment-sizing design coefficient used in Phase 2's
# capacity model — this is a separate, per-pixel modelling assumption).
LANDCOVER_RUNOFF_COEFF = {
    10: 0.15,  # Tree cover
    20: 0.20,  # Shrubland
    30: 0.25,  # Grassland
    40: 0.30,  # Cropland
    50: 0.85,  # Built-up
    60: 0.40,  # Bare / sparse vegetation
    70: 0.10,  # Snow / ice (not expected in Mumbai; included for completeness)
    80: 1.00,  # Permanent water bodies
    90: 0.60,  # Herbaceous wetland
    95: 0.50,  # Mangroves
    100: 0.30,  # Moss / lichen
    0: 0.50,  # Unmapped / no-data fallback
}
DEFAULT_RUNOFF_COEFF = 0.5

# ESTIMATED nominal local pooling footprint per drainage node — see module
# docstring. Matches the ~37m node spacing the Phase-2 zone-native D8 grid produces.
NODE_BASIN_AREA_M2 = 900.0

DEPTH_BINS_CM = [15, 30, 50, 100]
DEPTH_BIN_LABELS = ["0-15cm", "15-30cm", "30-50cm", "50-100cm", ">100cm"]


def depth_category(depth_m: float) -> str:
    depth_cm = depth_m * 100.0
    for bound, label in zip(DEPTH_BINS_CM, DEPTH_BIN_LABELS[:-1]):
        if depth_cm < bound:
            return label
    return DEPTH_BIN_LABELS[-1]


def load_landcover_lookup(zone_id: str):
    """Returns (sample_fn, provenance) where sample_fn(lon, lat) -> ESA WorldCover class code,
    decoded via EXACT reverse palette lookup (not a lossy color-ramp inversion)."""
    from PIL import Image

    png_path = LANDCOVER_DIR / f"{zone_id}_landcover.png"
    bounds_path = LANDCOVER_DIR / f"{zone_id}_landcover_bounds.json"
    with open(bounds_path) as f:
        meta = json.load(f)
    bounds = meta["bounds_wgs84"]

    img = np.asarray(Image.open(png_path).convert("RGBA"))
    h, w = img.shape[:2]

    # ESA WorldCover v200 official palette, exact copy of export_landcover_zones.py's PALETTE.
    palette = {
        10: (0, 100, 0), 20: (255, 187, 34), 30: (255, 255, 76), 40: (240, 150, 255),
        50: (250, 0, 0), 60: (180, 180, 180), 70: (240, 240, 240), 80: (0, 100, 200),
        90: (0, 150, 160), 95: (0, 207, 117), 100: (250, 230, 160), 0: (0, 0, 0),
    }
    rgb_to_class = {v: k for k, v in palette.items()}

    def sample_fn(lon: float, lat: float) -> int:
        col = int((lon - bounds["west"]) / (bounds["east"] - bounds["west"]) * w)
        row = int((bounds["north"] - lat) / (bounds["north"] - bounds["south"]) * h)
        col = min(max(col, 0), w - 1)
        row = min(max(row, 0), h - 1)
        rgb = tuple(int(v) for v in img[row, col, :3])
        return rgb_to_class.get(rgb, 0)

    return sample_fn, "REAL (exact palette decode of ESA WorldCover 10m v200, 2021)"


def load_observed_rainfall_mm_hr(zone_id: str) -> list[float]:
    """Real GSMaP hourly rainfall for this pilot zone, resampled onto the 7
    T+0..T+180 timesteps by nearest-hour lookup (no interpolation invented —
    the acquired window is uniformly 0 mm/hr, i.e. a real dry period)."""
    import csv

    col = f"{zone_id}_mean_mm_hr"
    rows = []
    with open(RAINFALL_CSV) as f:
        for r in csv.DictReader(f):
            rows.append(float(r[col]))
    if not rows:
        return [0.0] * len(TIMESTEPS_MIN)
    # Nearest-hour sample for each 30-min timestep offset from the series start.
    return [rows[min(int(round(t / 60)), len(rows) - 1)] for t in TIMESTEPS_MIN]


def run_flood_simulation(zone_id: str, rainfall_mm_hr: list[float], scenario_label: str,
                          rainfall_provenance: str, capacity_multiplier: float = 1.0) -> dict:
    nodes_path = GRAPH_DIR / f"{zone_id}_drainage_graph_nodes.geojson"
    if not nodes_path.exists():
        return {"zone_id": zone_id, "status": "BLOCKED",
                "reason": f"{nodes_path} missing — run build_drainage_graph.py first"}

    with open(nodes_path) as f:
        nodes_fc = json.load(f)
    with open(GRAPH_DIR / f"{zone_id}_drainage_graph_edges.geojson") as f:
        edges_fc = json.load(f)

    # Per-node contributing area, from the max flow_accumulation_cells among that
    # node's incoming edges (0 for pure headwater nodes with no inflow edge — they
    # still receive direct rainfall on their own single DEM cell's footprint).
    contributing_cells = {n["properties"]["node_id"]: 1 for n in nodes_fc["features"]}
    for e in edges_fc["features"]:
        p = e["properties"]
        contributing_cells[p["to_node"]] = max(
            contributing_cells.get(p["to_node"], 1), p["flow_accumulation_cells"]
        )

    sample_landcover, landcover_provenance = load_landcover_lookup(zone_id)

    DEM_CELL_SIZE_M = 30.0
    frames = []
    pooled_volume_m3 = {n["properties"]["node_id"]: 0.0 for n in nodes_fc["features"]}

    for t_idx, t_min in enumerate(TIMESTEPS_MIN):
        rainfall_m_s = (rainfall_mm_hr[t_idx] / 1000.0) / 3600.0
        node_out_features = []
        max_depth_m = 0.0
        flooded_count = 0
        bin_counts = {label: 0 for label in DEPTH_BIN_LABELS}

        for n in nodes_fc["features"]:
            p = n["properties"]
            node_id = p["node_id"]
            lon, lat = n["geometry"]["coordinates"]

            landcover_class = sample_landcover(lon, lat)
            runoff_coeff = LANDCOVER_RUNOFF_COEFF.get(landcover_class, DEFAULT_RUNOFF_COEFF)

            contributing_area_m2 = contributing_cells[node_id] * (DEM_CELL_SIZE_M ** 2)
            inflow_m3s = contributing_area_m2 * rainfall_m_s * runoff_coeff
            capacity_m3s = p["capacity_m3s"] * capacity_multiplier

            surcharge_m3s = max(0.0, inflow_m3s - capacity_m3s)
            spare_capacity_m3s = max(0.0, capacity_m3s - inflow_m3s)

            net_volume_change_m3 = (surcharge_m3s - spare_capacity_m3s) * TIMESTEP_SECONDS
            pooled_volume_m3[node_id] = max(0.0, pooled_volume_m3[node_id] + net_volume_change_m3)

            depth_m = pooled_volume_m3[node_id] / NODE_BASIN_AREA_M2
            category = depth_category(depth_m)
            bin_counts[category] += 1
            if depth_m > 0.01:
                flooded_count += 1
            max_depth_m = max(max_depth_m, depth_m)

            node_out_features.append({
                "type": "Feature",
                "geometry": n["geometry"],
                "properties": {
                    "node_id": node_id,
                    "t_min": t_min,
                    "depth_m": round(depth_m, 4),
                    "depth_category": category,
                    "landcover_class": landcover_class,
                    "runoff_coeff": runoff_coeff,
                    "runoff_coeff_provenance": "ESTIMATED (literature-typical per-class assumption)",
                    "inflow_m3s": round(inflow_m3s, 5),
                    "capacity_m3s": round(capacity_m3s, 5),
                    "surcharge_m3s": round(surcharge_m3s, 5),
                    "is_sink": p["is_sink"],
                    "role": p["role"],
                    "provenance": "SIMULATED",
                    "rainfall_scenario": scenario_label,
                },
            })

        frame_fc = {"type": "FeatureCollection", "features": node_out_features}
        frame_name = f"{zone_id}_{scenario_label}_t{t_min:03d}.geojson"
        write_json(OUT_DIR / frame_name, frame_fc, log)
        frames.append({
            "t_min": t_min,
            "file": frame_name,
            "rainfall_mm_hr": rainfall_mm_hr[t_idx],
            "max_depth_m": round(max_depth_m, 4),
            "flooded_node_count": flooded_count,
            "depth_bin_counts": bin_counts,
        })

    onset_frame = next((fr for fr in frames if fr["flooded_node_count"] > 0), None)
    summary = {
        "zone_id": zone_id,
        "status": "COMPLETE",
        "scenario": scenario_label,
        "rainfall_provenance": rainfall_provenance,
        "rainfall_mm_hr_by_timestep": dict(zip(TIMESTEPS_MIN, rainfall_mm_hr)),
        "capacity_multiplier": capacity_multiplier,
        "landcover_provenance": landcover_provenance,
        "node_count": len(nodes_fc["features"]),
        "flood_onset_minutes": onset_frame["t_min"] if onset_frame else None,
        "max_depth_m_overall": max(fr["max_depth_m"] for fr in frames),
        "frames": frames,
        "model": "Lightweight drainage-graph surcharge cascade v1 (rainfall -> landcover-weighted runoff -> "
                 "per-node capacity check -> surcharge -> local bathtub pooling with capacity-driven recession). "
                 "NOT a 2D hydrodynamic solver.",
        "generated_at": now_iso(),
    }
    write_json(OUT_DIR / f"{zone_id}_{scenario_label}_summary.json", summary, log)
    return summary


def main():
    results = {}
    for zone_id, bbox in PILOT_ZONES.items():
        observed = load_observed_rainfall_mm_hr(zone_id)
        results[f"{zone_id}_observed"] = run_flood_simulation(
            zone_id, observed, "observed", "OBSERVED (real GSMaP V8 gauge-calibrated rainfall)"
        )
        results[f"{zone_id}_design_storm"] = run_flood_simulation(
            zone_id, DESIGN_STORM_MM_HR, "design_storm",
            f"SIMULATED design-storm scenario. {DESIGN_STORM_PEAK_SOURCE}",
            capacity_multiplier=BASELINE_DRAINAGE_EFFICIENCY,
        )

    log.info("=== Flood propagation summary ===")
    for key, s in results.items():
        if s.get("status") == "COMPLETE":
            log.info(f"  {key}: onset={s['flood_onset_minutes']}min, "
                      f"max_depth={s['max_depth_m_overall']:.3f}m, nodes={s['node_count']}")
        else:
            log.warning(f"  {key}: {s.get('status')} — {s.get('reason')}")


if __name__ == "__main__":
    main()

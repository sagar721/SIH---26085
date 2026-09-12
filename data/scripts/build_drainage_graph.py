"""PHASE 2 — Builds an explicit DIRECTED GRAPH representation of the pilot-
zone drainage network: nodes = manhole/inlet/junction points, edges = pipe/
drain/canal connections, per the problem statement's required structure.

This is NOT the official MCGM underground pipe network (confirmed absent —
see DRAINAGE_INVESTIGATION_REPORT.md). It is built by running the SAME
D8-steepest-descent + flow-accumulation algorithm process_dem.py already
uses city-wide (real, unit-tested — see process_dem.py --selftest) directly
on each zone's own elevation grid (see dem_source.py), instead of reusing
process_dem.py's pre-built city-wide stream export
(data/raw/drainage/mumbai_inferred_surface_flow.geojson). That city-wide
file is thresholded for city-scale extraction (>=50 contributing DEM cells)
and turns out to intersect one pilot zone in only 12 short segments and the
other in zero — real DEM-derived data, just tuned at the wrong scale for a
~5.5km box, and not something we pad out with invented segments. Recomputing
D8 locally, at a threshold appropriate to a single pilot zone, gives full
real coverage in both zones using the identical, already-verified method.

Capacity is never invented from nothing: it is anchored to the one REAL
published design criterion this project has (MCGM's own post-1993
BRIMSTOWAD design standard — see data/processed/drainage/
mcgm_swd_official_statistics.json: "50 mm/hour rainfall intensity, runoff
coefficient 1.0"). The estimate assumes a segment's local drainage was sized
to just barely convey that design storm from its DEM-derived contributing
catchment. Real pipe diameters/invert levels do not exist for this area, so
this is explicitly labelled ESTIMATED, not measured.

Provenance carried on every feature:
  - node/edge geometry & flow direction: INFERRED (D8 on a real/DERIVED DEM)
  - capacity_m3s: ESTIMATED (anchored to a REAL published design standard)
  - elevation_m: DERIVED (see dem_source.py)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, PILOT_ZONES, get_logger, now_iso, write_json
from dem_source import ElevationUnavailable, load_zone_elevation
from process_dem import D8_OFFSETS, d8_flow_direction, fill_depressions, flow_accumulation

log = get_logger("build_drainage_graph")

OUT_DIR = DATA_ROOT / "processed" / "drainage" / "graph"

DEM_CELL_SIZE_M = 30.0  # Copernicus GLO-30 native resolution, per data_manifest.json
DESIGN_INTENSITY_MM_HR = 50.0  # MCGM post-BRIMSTOWAD-1993 design criterion, REAL/OFFICIAL
DESIGN_RUNOFF_COEFF = 1.0      # per the same official document
NODE_COORD_DECIMALS = 7        # ~1cm — safe for exact-match snapping on this DEM-pixel-aligned grid

# Zone-native D8 grid: ~5.5km box / 150 cells =~ 37m/cell, close to the DEM's own
# native ~30m pixel size — dense enough for a credible block-level drainage graph,
# coarse enough to stay "lightweight" (150x150=22,500 cells is trivial for the
# already-unit-tested pure-Python D8 loop from process_dem.py).
GRID_SIZE = 150
ELEVATION_GRID_SIZE = GRID_SIZE
# Contributing-cell threshold for keeping a D8 edge as a graph edge. Tuned for a
# single pilot zone (not process_dem.py's city-wide threshold=50, which is why
# reusing the city-wide export left one zone empty) — keeps confluence points
# and their outflow, drops the majority of side-slope cells that never converge.
STREAM_THRESHOLD_CELLS = 10
# ESTIMATED fallback for the rare node with neither an outgoing nor incoming
# D8 edge at the chosen threshold (should not normally occur, since every node
# is created by at least one edge) — a small nominal single-inlet capacity,
# using the same design-intensity formula at the minimum contributing area
# (one DEM cell = STREAM_THRESHOLD_CELLS contributing cells, matching the
# threshold that made this a graph node in the first place).
ASSUMED_MIN_OUTFALL_CAPACITY_M3S = (
    (STREAM_THRESHOLD_CELLS * DEM_CELL_SIZE_M ** 2) * ((DESIGN_INTENSITY_MM_HR / 1000.0) / 3600.0) * DESIGN_RUNOFF_COEFF
)


def haversine_m(lon1, lat1, lon2, lat2) -> float:
    R = 6371000.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dlambda = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dlambda / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def estimated_capacity_m3s(flow_accumulation_cells: int) -> float:
    """ESTIMATED — see module docstring. Not measured municipal pipe capacity."""
    contributing_area_m2 = flow_accumulation_cells * (DEM_CELL_SIZE_M ** 2)
    design_intensity_m_s = (DESIGN_INTENSITY_MM_HR / 1000.0) / 3600.0
    return contributing_area_m2 * design_intensity_m_s * DESIGN_RUNOFF_COEFF


def node_key(lon: float, lat: float) -> tuple[float, float]:
    return (round(lon, NODE_COORD_DECIMALS), round(lat, NODE_COORD_DECIMALS))


def build_zone_graph(zone_id: str, bbox_wsen: tuple[float, float, float, float]) -> dict:
    west, south, east, north = bbox_wsen

    elev_result = load_zone_elevation(bbox_wsen, ELEVATION_GRID_SIZE, ELEVATION_GRID_SIZE)
    elev_grid = elev_result["elevation_m"]

    log.info(f"[{zone_id}] Running D8 flow direction + accumulation on the zone's own "
             f"{GRID_SIZE}x{GRID_SIZE} elevation grid (same algorithm as process_dem.py)...")
    filled = fill_depressions(elev_grid, nodata=None)
    direction = d8_flow_direction(filled)
    accum = flow_accumulation(direction)

    def cell_lonlat(row: int, col: int) -> tuple[float, float]:
        lon = west + (col / (GRID_SIZE - 1)) * (east - west)
        lat = north - (row / (GRID_SIZE - 1)) * (north - south)
        return lon, lat

    dir_to_offset = {code: (dr, dc) for dr, dc, code in D8_OFFSETS}

    # Merge coincident cell centers into shared nodes (only cells that are an
    # endpoint of a kept edge become nodes — most side-slope cells below
    # threshold never appear).
    node_ids: dict[tuple[float, float], int] = {}
    node_coords: list[tuple[float, float]] = []
    node_rowcol: list[tuple[int, int]] = []

    def get_or_create_node(row: int, col: int) -> int:
        lon, lat = cell_lonlat(row, col)
        k = node_key(lon, lat)
        if k not in node_ids:
            node_ids[k] = len(node_coords)
            node_coords.append((lon, lat))
            node_rowcol.append((row, col))
        return node_ids[k]

    edges = []
    for r in range(GRID_SIZE):
        for c in range(GRID_SIZE):
            if accum[r, c] < STREAM_THRESHOLD_CELLS or direction[r, c] == 0:
                continue
            dr, dc = dir_to_offset[direction[r, c]]
            nr, nc = r + dr, c + dc
            if not (0 <= nr < GRID_SIZE and 0 <= nc < GRID_SIZE):
                continue
            u = get_or_create_node(r, c)
            v = get_or_create_node(nr, nc)
            if u == v:
                continue
            lon1, lat1 = node_coords[u]
            lon2, lat2 = node_coords[v]
            flow_accum = int(accum[r, c])
            length_m = haversine_m(lon1, lat1, lon2, lat2)
            edges.append({
                "from_node": u, "to_node": v,
                "flow_accumulation_cells": flow_accum,
                "length_m": round(float(length_m), 2),
                "capacity_m3s": round(estimated_capacity_m3s(flow_accum), 6),
            })

    log.info(f"[{zone_id}] {len(node_coords)} nodes, {len(edges)} edges "
             f"(threshold >= {STREAM_THRESHOLD_CELLS} contributing cells)")

    if not edges:
        return {"zone_id": zone_id, "status": "NO_DATA",
                "reason": f"No cells reached the {STREAM_THRESHOLD_CELLS}-cell accumulation threshold in this zone"}

    def sample_elevation(row: int, col: int) -> float:
        return float(elev_grid[row, col])

    out_degree = [0] * len(node_coords)
    in_degree = [0] * len(node_coords)
    out_edge_capacities: list[list[float]] = [[] for _ in node_coords]
    in_edge_capacities: list[list[float]] = [[] for _ in node_coords]
    for e in edges:
        out_degree[e["from_node"]] += 1
        in_degree[e["to_node"]] += 1
        out_edge_capacities[e["from_node"]].append(e["capacity_m3s"])
        in_edge_capacities[e["to_node"]].append(e["capacity_m3s"])

    node_features = []
    for i, (lon, lat) in enumerate(node_coords):
        is_sink = out_degree[i] == 0
        is_headwater = in_degree[i] == 0
        # A sink has no D8-computed outgoing edge within this zone grid (it is where
        # the zone's own local drainage graph ends — a real depression/outfall point,
        # not "zero capacity"). Its own throughput capacity is better approximated by
        # what its incoming edge(s) could already convey than by 0, which would make
        # every sink accumulate depth without limit regardless of rainfall.
        if out_edge_capacities[i]:
            node_capacity = min(out_edge_capacities[i])
        elif in_edge_capacities[i]:
            node_capacity = max(in_edge_capacities[i])
        else:
            node_capacity = ASSUMED_MIN_OUTFALL_CAPACITY_M3S
        row, col = node_rowcol[i]
        node_features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "node_id": i,
                "elevation_m": round(sample_elevation(row, col), 2),
                "elevation_provenance": elev_result["provenance"],
                "in_degree": in_degree[i],
                "out_degree": out_degree[i],
                "is_headwater": is_headwater,
                "is_sink": is_sink,
                "role": "sink / potential surcharge & ponding point" if is_sink else (
                    "headwater inlet" if is_headwater else "junction"),
                "capacity_m3s": round(node_capacity, 6),
                "capacity_provenance": "ESTIMATED",
                "capacity_method": (
                    f"contributing_area_m2 x ({DESIGN_INTENSITY_MM_HR}mm/hr, MCGM post-BRIMSTOWAD-1993 design "
                    f"intensity, runoff coeff {DESIGN_RUNOFF_COEFF}) — see mcgm_swd_official_statistics.json. "
                    "Real pipe diameters/invert levels are unavailable for this area."
                ),
            },
        })

    edge_features = []
    for idx, e in enumerate(edges):
        u_lon, u_lat = node_coords[e["from_node"]]
        v_lon, v_lat = node_coords[e["to_node"]]
        edge_features.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[u_lon, u_lat], [v_lon, v_lat]]},
            "properties": {
                "edge_id": idx,
                "from_node": e["from_node"],
                "to_node": e["to_node"],
                "direction_provenance": "INFERRED (D8 steepest-descent on real Copernicus DEM GLO-30)",
                "flow_accumulation_cells": e["flow_accumulation_cells"],
                "flow_accumulation_provenance": "INFERRED",
                "length_m": e["length_m"],
                "capacity_m3s": e["capacity_m3s"],
                "capacity_provenance": "ESTIMATED",
            },
        })

    sink_count = sum(1 for n in node_features if n["properties"]["is_sink"])
    headwater_count = sum(1 for n in node_features if n["properties"]["is_headwater"])

    nodes_fc = {"type": "FeatureCollection", "features": node_features}
    edges_fc = {"type": "FeatureCollection", "features": edge_features}
    write_json(OUT_DIR / f"{zone_id}_drainage_graph_nodes.geojson", nodes_fc, log)
    write_json(OUT_DIR / f"{zone_id}_drainage_graph_edges.geojson", edges_fc, log)

    summary = {
        "zone_id": zone_id,
        "status": "COMPLETE",
        "node_count": len(node_features),
        "edge_count": len(edge_features),
        "sink_node_count": sink_count,
        "headwater_node_count": headwater_count,
        "grid_size": GRID_SIZE,
        "stream_threshold_cells": STREAM_THRESHOLD_CELLS,
        "elevation_source": elev_result["source"],
        "elevation_precision_note": elev_result["precision_note"],
        "capacity_model": (
            f"ESTIMATED: capacity_m3s = contributing_area_m2 x design_intensity_m_s x runoff_coeff, using "
            f"MCGM's real published post-BRIMSTOWAD-1993 design criterion "
            f"({DESIGN_INTENSITY_MM_HR}mm/hr, coeff {DESIGN_RUNOFF_COEFF}) and DEM-derived contributing area "
            f"(flow_accumulation_cells x {DEM_CELL_SIZE_M}m^2 DEM cell). This is NOT measured MCGM pipe capacity."
        ),
        "not_official_drainage_network": True,
        "generated_at": now_iso(),
    }
    write_json(OUT_DIR / f"{zone_id}_drainage_graph_status.json", summary, log)
    return summary


def main():
    results = {}
    for zone_id, bbox in PILOT_ZONES.items():
        try:
            results[zone_id] = build_zone_graph(zone_id, bbox)
        except ElevationUnavailable as e:
            log.error(f"[{zone_id}] BLOCKED (elevation): {e}")
            results[zone_id] = {"zone_id": zone_id, "status": "BLOCKED", "reason": str(e)}

    log.info("=== Drainage graph build summary ===")
    for zone_id, s in results.items():
        if s.get("status") == "COMPLETE":
            log.info(f"  {zone_id}: {s['node_count']} nodes ({s['sink_node_count']} sinks, "
                      f"{s['headwater_node_count']} headwaters), {s['edge_count']} edges")
        else:
            log.warning(f"  {zone_id}: {s.get('status')} — {s.get('reason')}")


if __name__ == "__main__":
    main()

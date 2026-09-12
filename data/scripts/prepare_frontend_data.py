"""Copies the browser-consumable subset of acquired REAL data into
frontend/public/data/, organized by layer. Raw GeoTIFFs and large source
archives stay in data/raw + data/processed for backend/model use; only
GeoJSON/PNG/JSON assets small enough for a client fetch() are copied here.

This script is idempotent and safe to re-run after any re-acquisition.
"""
import json
import shutil
import sys
from pathlib import Path

from shapely.geometry import shape, mapping

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("prepare_frontend_data")

FRONTEND_DATA = DATA_ROOT.parent / "frontend" / "public" / "data"

# Perf investigation finding: entering a pilot zone JSON.parses several MB of
# GeoJSON synchronously on the main thread, a measured contributor to an
# 8-10s near-100%-CPU window on zone entry. Geometry simplification (Douglas-
# Peucker via shapely, preserve_topology=True) cuts vertex count — and so
# both transfer size and parse cost — on the largest, densest layers, at a
# tolerance small enough (~5m) to be visually imperceptible at the zoom
# levels these layers are actually viewed at. Only applied to the SERVED
# copy; data/raw/ stays untouched for provenance/reproducibility.
SIMPLIFY_TOLERANCE_DEG = 0.00005  # ~5.5m at Mumbai's latitude
SIMPLIFY_PATTERNS = {
    "roads_risk.geojson", "buildings.geojson", "water_waterways.geojson",
    "major_roads.geojson", "admin_boundary.geojson",
}


def copy_or_simplify(src: Path, dest: Path):
    if not any(src.name.endswith(p) for p in SIMPLIFY_PATTERNS):
        shutil.copy2(src, dest)
        return src.stat().st_size, dest.stat().st_size

    with open(src, encoding="utf-8") as f:
        fc = json.load(f)
    before_vertices = 0
    after_vertices = 0
    for feat in fc.get("features", []):
        geom = feat.get("geometry")
        if not geom or geom["type"] not in ("LineString", "Polygon", "MultiLineString", "MultiPolygon"):
            continue
        shp = shape(geom)
        before_vertices += _count_coords(geom["coordinates"])
        simplified = shp.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
        if simplified.is_empty or not simplified.is_valid:
            continue  # keep original geometry for this feature rather than risk a broken shape
        feat["geometry"] = mapping(simplified)
        after_vertices += _count_coords(feat["geometry"]["coordinates"])
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False)
    log.info(f"Simplified {src.name}: {before_vertices} -> {after_vertices} vertices "
              f"({100 * (1 - after_vertices / max(before_vertices, 1)):.0f}% reduction)")
    return src.stat().st_size, dest.stat().st_size


def _count_coords(c):
    if not c:
        return 0
    if isinstance(c[0], (int, float)):
        return 1
    return sum(_count_coords(x) for x in c)


COPY_MAP = [
    (DATA_ROOT / "raw" / "roads" / "greater_mumbai_admin_boundary.geojson", "boundary/greater_mumbai_admin_boundary.geojson"),
    (DATA_ROOT / "raw" / "roads" / "greater_mumbai_major_roads.geojson", "roads/greater_mumbai_major_roads.geojson"),
    (DATA_ROOT / "raw" / "buildings" / "kurla_sion_buildings.geojson", "buildings/kurla_sion_buildings.geojson"),
    (DATA_ROOT / "raw" / "buildings" / "hindmata_dadar_buildings.geojson", "buildings/hindmata_dadar_buildings.geojson"),
    (DATA_ROOT / "raw" / "water" / "greater_mumbai_water_waterways.geojson", "water/greater_mumbai_water_waterways.geojson"),
    (DATA_ROOT / "raw" / "infrastructure" / "mcgm_health_facilities.geojson", "infrastructure/mcgm_health_facilities.geojson"),
    (DATA_ROOT / "raw" / "infrastructure" / "mcgm_fire_stations.geojson", "infrastructure/mcgm_fire_stations.geojson"),
    (DATA_ROOT / "raw" / "infrastructure" / "mcgm_police_stations.geojson", "infrastructure/mcgm_police_stations.geojson"),
    (DATA_ROOT / "raw" / "infrastructure" / "mcgm_metro_stations.geojson", "infrastructure/mcgm_metro_stations.geojson"),
    (DATA_ROOT / "raw" / "infrastructure" / "mcgm_suburban_railway_stations.geojson", "infrastructure/mcgm_suburban_railway_stations.geojson"),
    (DATA_ROOT / "raw" / "infrastructure" / "kurla_sion_osm_supplemental.geojson", "infrastructure/kurla_sion_osm_supplemental.geojson"),
    (DATA_ROOT / "raw" / "infrastructure" / "hindmata_dadar_osm_supplemental.geojson", "infrastructure/hindmata_dadar_osm_supplemental.geojson"),
    (DATA_ROOT / "processed" / "landcover" / "kurla_sion_landcover.png", "landcover/kurla_sion_landcover.png"),
    (DATA_ROOT / "processed" / "landcover" / "kurla_sion_landcover_bounds.json", "landcover/kurla_sion_landcover_bounds.json"),
    (DATA_ROOT / "processed" / "landcover" / "hindmata_dadar_landcover.png", "landcover/hindmata_dadar_landcover.png"),
    (DATA_ROOT / "processed" / "landcover" / "hindmata_dadar_landcover_bounds.json", "landcover/hindmata_dadar_landcover_bounds.json"),
    (DATA_ROOT / "processed" / "landcover" / "worldcover_class_report.json", "landcover/worldcover_class_report.json"),
    (DATA_ROOT / "processed" / "drainage" / "drainage_status.json", "drainage/drainage_status.json"),
    (DATA_ROOT / "raw" / "drainage" / "mumbai_inferred_surface_flow.geojson", "drainage/mumbai_inferred_surface_flow.geojson"),
    (DATA_ROOT / "raw" / "drainage" / "greater_mumbai_drainage_points.geojson", "drainage/greater_mumbai_drainage_points.geojson"),
    (DATA_ROOT / "processed" / "drainage" / "mcgm_swd_official_statistics.json", "drainage/mcgm_swd_official_statistics.json"),
    (DATA_ROOT / "processed" / "dem" / "mumbai_elevation.png", "dem/mumbai_elevation.png"),
    (DATA_ROOT / "processed" / "dem" / "mumbai_slope.png", "dem/mumbai_slope.png"),
    (DATA_ROOT / "processed" / "dem" / "mumbai_dem_visual_bounds.json", "dem/mumbai_dem_visual_bounds.json"),
    (DATA_ROOT / "processed" / "flood_model" / "mumbai_flood_susceptibility.png", "flood_model/mumbai_flood_susceptibility.png"),
    (DATA_ROOT / "processed" / "flood_model" / "flood_susceptibility_metadata.json", "flood_model/flood_susceptibility_metadata.json"),
    (DATA_ROOT / "processed" / "flood_model" / "kurla_sion_roads_risk.geojson", "flood_model/kurla_sion_roads_risk.geojson"),
    (DATA_ROOT / "processed" / "flood_model" / "hindmata_dadar_roads_risk.geojson", "flood_model/hindmata_dadar_roads_risk.geojson"),
    (DATA_ROOT / "processed" / "flood_model" / "kurla_sion_infrastructure_risk.geojson", "flood_model/kurla_sion_infrastructure_risk.geojson"),
    (DATA_ROOT / "processed" / "flood_model" / "hindmata_dadar_infrastructure_risk.geojson", "flood_model/hindmata_dadar_infrastructure_risk.geojson"),
    (DATA_ROOT / "processed" / "dem" / "mumbai_elevation_query_grid.geojson", "dem/mumbai_elevation_query_grid.geojson"),
    (DATA_ROOT / "processed" / "dem" / "mumbai_slope_query_grid.geojson", "dem/mumbai_slope_query_grid.geojson"),
    (DATA_ROOT / "processed" / "flood_model" / "mumbai_susceptibility_query_grid.geojson", "flood_model/mumbai_susceptibility_query_grid.geojson"),
    (DATA_ROOT / "processed" / "flood_model" / "sensitivity_analysis.json", "flood_model/sensitivity_analysis.json"),
    (DATA_ROOT / "raw" / "validation" / "_IFI_ACQUISITION_STATUS.json", "validation/ifi_status.json"),
    (DATA_ROOT / "raw" / "validation" / "_SENTINEL1_STATUS.json", "validation/sentinel1_status.json"),
    (DATA_ROOT / "raw" / "validation" / "mumbai_ifi_events.json", "validation/mumbai_ifi_events.json"),
    (DATA_ROOT / "processed" / "validation" / "kurla_sion_sentinel1_validation_status.json", "validation/kurla_sion_sentinel1_scenes.json"),
    (DATA_ROOT / "processed" / "validation" / "sentinel1_water_detection_validation.json", "validation/sentinel1_water_detection_validation.json"),
    (DATA_ROOT / "raw" / "dem" / "_ACQUISITION_STATUS.json", "dem/dem_status.json"),
    (DATA_ROOT / "data_manifest.json", "data_manifest.json"),

    # --- Phase 2 (build_drainage_graph.py): INFERRED/ESTIMATED per-zone directed drainage graph ---
    (DATA_ROOT / "processed" / "drainage" / "graph" / "kurla_sion_drainage_graph_nodes.geojson", "drainage/graph/kurla_sion_drainage_graph_nodes.geojson"),
    (DATA_ROOT / "processed" / "drainage" / "graph" / "kurla_sion_drainage_graph_edges.geojson", "drainage/graph/kurla_sion_drainage_graph_edges.geojson"),
    (DATA_ROOT / "processed" / "drainage" / "graph" / "kurla_sion_drainage_graph_status.json", "drainage/graph/kurla_sion_drainage_graph_status.json"),
    (DATA_ROOT / "processed" / "drainage" / "graph" / "hindmata_dadar_drainage_graph_nodes.geojson", "drainage/graph/hindmata_dadar_drainage_graph_nodes.geojson"),
    (DATA_ROOT / "processed" / "drainage" / "graph" / "hindmata_dadar_drainage_graph_edges.geojson", "drainage/graph/hindmata_dadar_drainage_graph_edges.geojson"),
    (DATA_ROOT / "processed" / "drainage" / "graph" / "hindmata_dadar_drainage_graph_status.json", "drainage/graph/hindmata_dadar_drainage_graph_status.json"),
]

# --- Phase 3 (flood_propagation_engine.py): SIMULATED T+0..180 flood frames ---
# "observed" (REAL rainfall, all-zero) + "design_storm" (SIMULATED) were
# synced starting Phase 5. Phase 7 adds "whatif_baseline"/"whatif_intervention"
# (Phase 4 output) now that the What-If panel is being wired into the frontend.
FLOOD_FRAME_TIMESTEPS = [0, 30, 60, 90, 120, 150, 180]
FLOOD_FRAME_SCENARIOS = ["observed", "design_storm", "whatif_baseline", "whatif_intervention"]
for _zone in ("kurla_sion", "hindmata_dadar"):
    for _scenario in FLOOD_FRAME_SCENARIOS:
        COPY_MAP.append((
            DATA_ROOT / "processed" / "flood_model" / "propagation" / f"{_zone}_{_scenario}_summary.json",
            f"flood_model/propagation/{_zone}_{_scenario}_summary.json",
        ))
        for _t in FLOOD_FRAME_TIMESTEPS:
            _name = f"{_zone}_{_scenario}_t{_t:03d}.geojson"
            COPY_MAP.append((
                DATA_ROOT / "processed" / "flood_model" / "propagation" / _name,
                f"flood_model/propagation/{_name}",
            ))

# --- Phase 4 (build_whatif_scenarios.py): SIMULATED baseline vs. drainage-
# intervention comparison — hypothetical, never a planned/funded MCGM project.
for _zone in ("kurla_sion", "hindmata_dadar"):
    COPY_MAP.append((
        DATA_ROOT / "processed" / "flood_model" / "whatif" / f"{_zone}_whatif_comparison.json",
        f"flood_model/whatif/{_zone}_whatif_comparison.json",
    ))


# --- Phase 1 (export_terrain_rgb.py): terrain-RGB XYZ tile pyramid, per zone ---
# A directory tree rather than a flat file, so it's synced separately from COPY_MAP.
TERRAIN_RGB_SRC = DATA_ROOT / "processed" / "dem" / "terrain_rgb"
TERRAIN_RGB_DEST_REL = "dem/terrain_rgb"


def sync_terrain_rgb_tiles() -> int:
    if not TERRAIN_RGB_SRC.exists():
        return 0
    dest_root = FRONTEND_DATA / TERRAIN_RGB_DEST_REL
    dest_root.mkdir(parents=True, exist_ok=True)
    count = 0
    for src_file in TERRAIN_RGB_SRC.rglob("*"):
        if src_file.is_dir():
            continue
        rel = src_file.relative_to(TERRAIN_RGB_SRC)
        dest_file = dest_root / rel
        dest_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src_file, dest_file)
        count += 1
    log.info(f"Synced {count} terrain-RGB tile/manifest files -> {dest_root}")
    return count


def main():
    copied = []
    missing = []
    total_before = total_after = 0
    sync_terrain_rgb_tiles()
    for src, rel_dest in COPY_MAP:
        dest = FRONTEND_DATA / rel_dest
        if not src.exists():
            missing.append(str(src))
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        before, after = copy_or_simplify(src, dest)
        total_before += before
        total_after += after
        copied.append(rel_dest)
        log.info(f"Copied {src.name} -> {dest}")

    if missing:
        log.warning(f"Missing (not copied, likely blocked/pending): {missing}")

    write_json(FRONTEND_DATA / "_frontend_data_manifest.json", {
        "copied_at": now_iso(),
        "files": copied,
        "missing_sources": missing,
        "total_bytes_before_simplification": total_before,
        "total_bytes_after_simplification": total_after,
    }, log)
    log.info(f"Done. {len(copied)} files copied, {len(missing)} sources missing. "
              f"Total size: {total_before/1024:.0f}KB -> {total_after/1024:.0f}KB")


if __name__ == "__main__":
    main()

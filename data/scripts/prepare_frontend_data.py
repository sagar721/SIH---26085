"""Copies the browser-consumable subset of acquired REAL data into
frontend/public/data/, organized by layer. Raw GeoTIFFs and large source
archives stay in data/raw + data/processed for backend/model use; only
GeoJSON/PNG/JSON assets small enough for a client fetch() are copied here.

This script is idempotent and safe to re-run after any re-acquisition.
"""
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("prepare_frontend_data")

FRONTEND_DATA = DATA_ROOT.parent / "frontend" / "public" / "data"

COPY_MAP = [
    (DATA_ROOT / "raw" / "roads" / "greater_mumbai_admin_boundary.geojson", "boundary/greater_mumbai_admin_boundary.geojson"),
    (DATA_ROOT / "raw" / "roads" / "greater_mumbai_major_roads.geojson", "roads/greater_mumbai_major_roads.geojson"),
    (DATA_ROOT / "raw" / "roads" / "kurla_sion_roads.geojson", "roads/kurla_sion_roads.geojson"),
    (DATA_ROOT / "raw" / "roads" / "hindmata_dadar_roads.geojson", "roads/hindmata_dadar_roads.geojson"),
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
    (DATA_ROOT / "raw" / "validation" / "_IFI_ACQUISITION_STATUS.json", "validation/ifi_status.json"),
    (DATA_ROOT / "raw" / "validation" / "_SENTINEL1_STATUS.json", "validation/sentinel1_status.json"),
    (DATA_ROOT / "raw" / "validation" / "mumbai_ifi_events.json", "validation/mumbai_ifi_events.json"),
    (DATA_ROOT / "processed" / "validation" / "kurla_sion_sentinel1_validation_status.json", "validation/kurla_sion_sentinel1_scenes.json"),
    (DATA_ROOT / "raw" / "dem" / "_ACQUISITION_STATUS.json", "dem/dem_status.json"),
    (DATA_ROOT / "data_manifest.json", "data_manifest.json"),
]


def main():
    copied = []
    missing = []
    for src, rel_dest in COPY_MAP:
        dest = FRONTEND_DATA / rel_dest
        if not src.exists():
            missing.append(str(src))
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied.append(rel_dest)
        log.info(f"Copied {src.name} -> {dest}")

    if missing:
        log.warning(f"Missing (not copied, likely blocked/pending): {missing}")

    write_json(FRONTEND_DATA / "_frontend_data_manifest.json", {
        "copied_at": now_iso(),
        "files": copied,
        "missing_sources": missing,
    }, log)
    log.info(f"Done. {len(copied)} files copied, {len(missing)} sources missing.")


if __name__ == "__main__":
    main()

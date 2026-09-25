"""Downloads REAL critical-infrastructure data for FLOODCAST.

Primary source (per Excel category I, RECOMMENDATION=PRIMARY): official MCGM
ArcGIS FeatureServer layers, confirmed publicly queryable at
services8.arcgis.com/r6MmJtuWAzMawmJ8. These are genuine municipal records
(e.g. hospital OPD hours, fire-station construction year) — not OSM.

Supplemental (OSM, per Excel PRIMARY for schools/bridges/junctions since MCGM
has no confirmed public layer for these): schools, bridges/underpasses,
electrical substations, for the two pilot zones only (city-wide would be
enormous and isn't needed at this stage).
"""
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, USER_AGENT, get_logger, osm_to_geojson, overpass_query, validate_geojson, write_json

log = get_logger("download_infrastructure")

MCGM_BASE = "https://services8.arcgis.com/r6MmJtuWAzMawmJ8/ArcGIS/rest/services"

MCGM_LAYERS = {
    "health_facilities": "Health_Facilities",
    "fire_stations": "Fire_Station",
    "police_stations": "Police_Stations",
    "metro_stations": "Metro_Stations",
    "suburban_railway_stations": "Existing_Suburban_Stations",
}

PILOT_ZONES = {
    "kurla_sion": {"south": 19.0510, "west": 72.8527, "north": 19.1010, "east": 72.9027},
    "hindmata_dadar": {"south": 18.9963, "west": 72.8226, "north": 19.0363, "east": 72.8626},
}


def fetch_mcgm_layer(key, service_name):
    log.info(f"Fetching MCGM official layer: {service_name}...")
    url = f"{MCGM_BASE}/{service_name}/FeatureServer/0/query"
    params = {"where": "1=1", "outFields": "*", "outSR": "4326", "f": "geojson"}
    resp = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=60)
    resp.raise_for_status()
    fc = resp.json()
    if fc.get("type") != "FeatureCollection":
        raise ValueError(f"Unexpected response from {service_name}: {fc}")
    for feat in fc["features"]:
        feat["properties"]["_source"] = "MCGM ArcGIS FeatureServer (official)"
    report = validate_geojson(fc, log, key)
    out = DATA_ROOT / "raw" / "infrastructure" / f"mcgm_{key}.geojson"
    write_json(out, fc, log)
    return out, report


def fetch_osm_supplemental(zone_id, bbox):
    log.info(f"Fetching OSM supplemental infrastructure for {zone_id} (schools, bridges, substations, junctions)...")
    bbox_str = f"{bbox['south']},{bbox['west']},{bbox['north']},{bbox['east']}"
    query = f"""
[out:json][timeout:90];
(
  node["amenity"="school"]({bbox_str});
  way["amenity"="school"]({bbox_str});
  way["bridge"="yes"]({bbox_str});
  way["tunnel"="yes"]({bbox_str});
  node["power"="substation"]({bbox_str});
  way["power"="substation"]({bbox_str});
  node["highway"="traffic_signals"]({bbox_str});
);
out body;
>;
out skel qt;
"""
    osm = overpass_query(query, log)
    fc = osm_to_geojson(osm, want_ways=True)
    for feat in fc["features"]:
        p = feat["properties"]
        category = (
            "school" if p.get("amenity") == "school" else
            "bridge" if p.get("bridge") == "yes" else
            "underpass" if p.get("tunnel") == "yes" else
            "substation" if p.get("power") == "substation" else
            "traffic_signal" if p.get("highway") == "traffic_signals" else
            "other"
        )
        feat["properties"] = {
            "osm_id": p.get("osm_id"),
            "category": category,
            "name": p.get("name"),
            "_source": "OpenStreetMap",
        }
    report = validate_geojson(fc, log, f"{zone_id}_osm_infrastructure")
    out = DATA_ROOT / "raw" / "infrastructure" / f"{zone_id}_osm_supplemental.geojson"
    write_json(out, fc, log)
    return out, report


if __name__ == "__main__":
    results = {}
    for key, service_name in MCGM_LAYERS.items():
        try:
            path, report = fetch_mcgm_layer(key, service_name)
            results[path.name] = report
        except Exception as e:
            log.error(f"FAILED: MCGM layer {service_name}: {e}")

    for zone_id, bbox in PILOT_ZONES.items():
        try:
            path, report = fetch_osm_supplemental(zone_id, bbox)
            results[path.name] = report
        except Exception as e:
            log.error(f"FAILED: OSM supplemental {zone_id}: {e}")

    log.info("=== Infrastructure acquisition summary ===")
    for name, report in results.items():
        log.info(f"  {name}: {report['feature_count']} features")

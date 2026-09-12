"""Fetches REAL OSM drainage POINT infrastructure (manholes, storm drains)
for Greater Mumbai — found during the Priority 5 drainage investigation
(23 features exist; not previously fetched, since download_osm.py's water
query only covered waterway LINES/polygons, not point-tagged drainage
infrastructure). This is Tier 1 (REAL, OpenStreetMap) — never confused with
the (still unavailable) official MCGM underground pipe network.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, osm_to_geojson, overpass_query, validate_geojson, write_json

log = get_logger("download_drainage_points")

GREATER_MUMBAI_BBOX = "18.85,72.75,19.30,73.05"


def main():
    query = f"""
[out:json][timeout:60];
(
  node["man_made"="manhole"]({GREATER_MUMBAI_BBOX});
  node["manhole"]({GREATER_MUMBAI_BBOX});
  node["man_made"="storm_drain"]({GREATER_MUMBAI_BBOX});
  node["amenity"="drain"]({GREATER_MUMBAI_BBOX});
);
out body;
"""
    osm = overpass_query(query, log)
    fc = osm_to_geojson(osm, want_ways=False)
    for feat in fc["features"]:
        p = feat["properties"]
        feat["properties"] = {
            "osm_id": p.get("osm_id"),
            "man_made": p.get("man_made"),
            "manhole": p.get("manhole"),
            "amenity": p.get("amenity"),
            "operator": p.get("operator"),
            "provenance": "REAL",
            "source": "OpenStreetMap",
        }
    report = validate_geojson(fc, log, "greater_mumbai_drainage_points")
    out = DATA_ROOT / "raw" / "drainage" / "greater_mumbai_drainage_points.geojson"
    write_json(out, fc, log)
    log.info(f"Wrote {report['feature_count']} real drainage point features (manholes/storm drains).")


if __name__ == "__main__":
    main()

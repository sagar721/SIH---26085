"""Downloads REAL OpenStreetMap data for FLOODCAST via the public Overpass API.

Fetches, per the Excel source-of-truth (category D/C/J, RECOMMENDATION=PRIMARY):
  - Greater Mumbai administrative boundary (Mumbai City + Mumbai Suburban districts,
    which together constitute the MCGM jurisdiction)
  - City-context road network (major classes only, for the Mumbai overview map)
  - Full-attribute pilot-zone road network (for routing / flood-impact overlays)
  - Pilot-zone building footprints
  - Greater-Mumbai water bodies and waterways (rivers/streams/drains/canals — the
    real, open-data "nallas" layer; NOT a substitute for MCGM's unpublished
    underground stormwater network)

No data is fabricated. If Overpass is unreachable, the script fails loudly
rather than writing an empty/placeholder file.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, osm_to_geojson, overpass_query, relation_to_polygons, validate_geojson, write_json

log = get_logger("download_osm")

GREATER_MUMBAI_BBOX = {"south": 18.85, "west": 72.75, "north": 19.30, "east": 73.05}

PILOT_ZONES = {
    "kurla_sion": {"south": 19.0510, "west": 72.8527, "north": 19.1010, "east": 72.9027},
    "hindmata_dadar": {"south": 18.9963, "west": 72.8226, "north": 19.0363, "east": 72.8626},
}

CITY_HIGHWAY_TYPES = "motorway|trunk|primary|secondary|motorway_link|trunk_link|primary_link"
PILOT_HIGHWAY_TYPES = (
    "motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|"
    "motorway_link|trunk_link|primary_link|secondary_link|tertiary_link"
)


def bbox_str(b):
    return f"{b['south']},{b['west']},{b['north']},{b['east']}"


def fetch_admin_boundary():
    log.info("Fetching Greater Mumbai (MCGM) administrative boundary...")
    query = """
[out:json][timeout:90];
(
  relation(7964375);
  relation(7964376);
);
out geom;
"""
    osm = overpass_query(query, log)
    fc = relation_to_polygons(osm)
    for feat in fc["features"]:
        feat["properties"]["source_note"] = "Mumbai City District + Mumbai Suburban District == Greater Mumbai / MCGM jurisdiction"
    report = validate_geojson(fc, log, "greater_mumbai_boundary")
    out = DATA_ROOT / "raw" / "roads" / "greater_mumbai_admin_boundary.geojson"
    write_json(out, fc, log)
    return out, report


def fetch_city_roads():
    log.info("Fetching Greater Mumbai city-context road network (major classes)...")
    query = f"""
[out:json][timeout:120];
way["highway"~"^({CITY_HIGHWAY_TYPES})$"]({bbox_str(GREATER_MUMBAI_BBOX)});
out body;
>;
out skel qt;
"""
    osm = overpass_query(query, log)
    fc = osm_to_geojson(osm, want_ways=True)
    fc["features"] = [f for f in fc["features"] if f["geometry"]["type"] == "LineString"]
    report = validate_geojson(fc, log, "greater_mumbai_city_roads")
    out = DATA_ROOT / "raw" / "roads" / "greater_mumbai_major_roads.geojson"
    write_json(out, fc, log)
    return out, report


def fetch_pilot_roads(zone_id, bbox):
    log.info(f"Fetching full-attribute road network for pilot zone: {zone_id}...")
    query = f"""
[out:json][timeout:120];
way["highway"~"^({PILOT_HIGHWAY_TYPES})$"]({bbox_str(bbox)});
out body;
>;
out skel qt;
"""
    osm = overpass_query(query, log)
    fc = osm_to_geojson(osm, want_ways=True)
    fc["features"] = [f for f in fc["features"] if f["geometry"]["type"] == "LineString"]
    # Keep only the attributes the task asked for, explicitly, rather than every raw OSM tag.
    for feat in fc["features"]:
        p = feat["properties"]
        feat["properties"] = {
            "osm_id": p.get("osm_id"),
            "highway": p.get("highway"),
            "name": p.get("name"),
            "oneway": p.get("oneway"),
            "bridge": p.get("bridge"),
            "tunnel": p.get("tunnel"),
            "surface": p.get("surface"),
            "maxspeed": p.get("maxspeed"),
            "lanes": p.get("lanes"),
        }
    report = validate_geojson(fc, log, f"{zone_id}_roads")
    out = DATA_ROOT / "raw" / "roads" / f"{zone_id}_roads.geojson"
    write_json(out, fc, log)
    return out, report


def fetch_pilot_buildings(zone_id, bbox):
    log.info(f"Fetching building footprints for pilot zone: {zone_id}...")
    query = f"""
[out:json][timeout:120];
way["building"]({bbox_str(bbox)});
out body;
>;
out skel qt;
"""
    osm = overpass_query(query, log)
    fc = osm_to_geojson(osm, want_ways=True)
    fc["features"] = [f for f in fc["features"] if f["geometry"]["type"] == "Polygon"]
    for feat in fc["features"]:
        p = feat["properties"]
        levels = p.get("building:levels")
        height = p.get("height")
        estimated = False
        if not height and levels:
            try:
                height = str(round(float(levels) * 3.0, 1))  # 3m/floor rule of thumb
                estimated = True
            except ValueError:
                height = None
        feat["properties"] = {
            "osm_id": p.get("osm_id"),
            "building": p.get("building"),
            "name": p.get("name"),
            "levels": levels,
            "height_m": height,
            "height_estimated": estimated,  # True => derived from levels*3m, NOT measured
        }
    report = validate_geojson(fc, log, f"{zone_id}_buildings")
    out = DATA_ROOT / "raw" / "buildings" / f"{zone_id}_buildings.geojson"
    write_json(out, fc, log)
    return out, report


def fetch_water():
    log.info("Fetching Greater Mumbai water bodies and waterways (OSM)...")
    query = f"""
[out:json][timeout:120];
(
  way["natural"="water"]({bbox_str(GREATER_MUMBAI_BBOX)});
  way["waterway"~"^(river|stream|drain|ditch|canal)$"]({bbox_str(GREATER_MUMBAI_BBOX)});
  relation["natural"="water"]({bbox_str(GREATER_MUMBAI_BBOX)});
);
out body;
>;
out skel qt;
"""
    osm = overpass_query(query, log)
    fc = osm_to_geojson(osm, want_ways=True)
    fc["features"] = [f for f in fc["features"] if f["geometry"]["type"] in ("LineString", "Polygon")]
    for feat in fc["features"]:
        p = feat["properties"]
        feat["properties"] = {
            "osm_id": p.get("osm_id"),
            "name": p.get("name"),
            "natural": p.get("natural"),
            "waterway": p.get("waterway"),
        }
    report = validate_geojson(fc, log, "greater_mumbai_water")
    out = DATA_ROOT / "raw" / "water" / "greater_mumbai_water_waterways.geojson"
    write_json(out, fc, log)
    return out, report


if __name__ == "__main__":
    results = {}
    for fn, args in [
        (fetch_admin_boundary, ()),
        (fetch_city_roads, ()),
        (fetch_water, ()),
    ]:
        try:
            path, report = fn(*args)
            results[path.name] = report
        except Exception as e:
            log.error(f"FAILED: {fn.__name__}: {e}")

    for zone_id, bbox in PILOT_ZONES.items():
        for fn in (fetch_pilot_roads, fetch_pilot_buildings):
            try:
                path, report = fn(zone_id, bbox)
                results[path.name] = report
            except Exception as e:
                log.error(f"FAILED: {fn.__name__}({zone_id}): {e}")

    log.info("=== OSM acquisition summary ===")
    for name, report in results.items():
        log.info(f"  {name}: {report['feature_count']} features")

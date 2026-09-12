"""Shared helpers for FLOODWATCH data-acquisition scripts.

Every download script in this directory uses these helpers so that
logging, validation, and metadata generation are consistent across
datasets. No script should silently swallow a failure.
"""
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    stream=sys.stdout,
)

# Project-relative, not a hardcoded machine path: data/scripts/common.py -> data/ is one level up.
DATA_ROOT = Path(__file__).resolve().parent.parent
PROJECT_ROOT = DATA_ROOT.parent

# Every script that imports common.py gets credentials from .env automatically.
# Never log, print, or otherwise surface the loaded values.
load_dotenv(PROJECT_ROOT / ".env")
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "SIH26085-FloodWatch/1.0 (research prototype; contact: SIH team)"

# The two pilot zones this project simulates in detail (Kurla-Sion-Chunabhatti,
# Hindmata-Dadar-Parel), as (west, south, east, north) WGS84 bboxes. Matches the
# bboxes already used by download_osm.py / export_landcover_zones.py — kept
# here too so newer scripts (drainage graph, flood engine, terrain export)
# share one source of truth instead of re-copying the numbers a third time.
PILOT_ZONES = {
    "kurla_sion": (72.8527, 19.0510, 72.9027, 19.1010),
    "hindmata_dadar": (72.8226, 18.9963, 72.8626, 19.0363),
}


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, data, log: logging.Logger):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    size = path.stat().st_size
    log.info(f"Wrote {path} ({size:,} bytes)")


def overpass_query(query: str, log: logging.Logger, timeout: int = 120) -> dict:
    """POSTs an Overpass QL query, trying mirrors in order. Raises on total failure."""
    last_err = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            log.info(f"Querying Overpass ({endpoint})...")
            resp = requests.post(
                endpoint,
                data={"data": query},
                headers={"User-Agent": USER_AGENT},
                timeout=timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                if "elements" not in data:
                    raise ValueError(f"Unexpected Overpass response shape: {list(data.keys())}")
                log.info(f"  -> {len(data['elements'])} elements")
                return data
            else:
                log.warning(f"  -> HTTP {resp.status_code}: {resp.text[:300]}")
                last_err = RuntimeError(f"HTTP {resp.status_code} from {endpoint}")
        except Exception as e:
            log.warning(f"  -> failed: {e}")
            last_err = e
    raise RuntimeError(f"All Overpass endpoints failed: {last_err}")


def osm_to_geojson(osm: dict, want_ways: bool = True, want_relations: bool = False) -> dict:
    """Minimal OSM-JSON -> GeoJSON converter (nodes, ways, and simple multipolygon relations)."""
    nodes = {}
    for el in osm["elements"]:
        if el["type"] == "node":
            nodes[el["id"]] = (el["lon"], el["lat"])

    features = []
    for el in osm["elements"]:
        tags = el.get("tags", {})
        if el["type"] == "node" and tags:
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]},
                "properties": {"osm_type": "node", "osm_id": el["id"], **tags},
            })
        elif el["type"] == "way" and want_ways:
            coords = [nodes[n] for n in el.get("nodes", []) if n in nodes]
            if len(coords) < 2:
                continue
            is_closed = coords[0] == coords[-1] and len(coords) >= 4
            geom = (
                {"type": "Polygon", "coordinates": [coords]}
                if is_closed and ("building" in tags or "natural" in tags and tags.get("natural") == "water")
                else {"type": "LineString", "coordinates": coords}
            )
            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {"osm_type": "way", "osm_id": el["id"], **tags},
            })
        elif el["type"] == "relation" and want_relations and "geometry" not in el:
            # Handled separately via `out geom` relation members where needed.
            continue

    return {"type": "FeatureCollection", "features": features}


def relation_to_polygons(osm: dict) -> dict:
    """Converts an Overpass `out geom` relation (with way members carrying inline geometry)
    into a GeoJSON MultiLineString of its outer/inner ways — used for admin boundaries where
    we want the boundary rings, not a guaranteed-valid polygon assembly."""
    features = []
    for el in osm["elements"]:
        if el["type"] != "relation":
            continue
        tags = el.get("tags", {})
        rings = []
        for member in el.get("members", []):
            if member.get("type") == "way" and "geometry" in member:
                coords = [(pt["lon"], pt["lat"]) for pt in member["geometry"]]
                if len(coords) >= 2:
                    rings.append(coords)
        if rings:
            features.append({
                "type": "Feature",
                "geometry": {"type": "MultiLineString", "coordinates": rings},
                "properties": {"osm_type": "relation", "osm_id": el["id"], **tags},
            })
    return {"type": "FeatureCollection", "features": features}


def validate_geojson(fc: dict, log: logging.Logger, name: str) -> dict:
    """Basic vector validation: structure, feature count, bbox, empty-geometry check.
    Returns a small report dict (also usable inside dataset metadata)."""
    from shapely.geometry import shape
    from shapely.validation import explain_validity

    assert fc.get("type") == "FeatureCollection", f"{name}: not a FeatureCollection"
    n = len(fc["features"])
    empty = 0
    invalid = 0
    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    for feat in fc["features"]:
        geom = feat.get("geometry")
        if not geom:
            empty += 1
            continue
        try:
            g = shape(geom)
            if g.is_empty:
                empty += 1
                continue
            if not g.is_valid:
                invalid += 1
            b = g.bounds
            minx, miny = min(minx, b[0]), min(miny, b[1])
            maxx, maxy = max(maxx, b[2]), max(maxy, b[3])
        except Exception:
            invalid += 1

    report = {
        "feature_count": n,
        "empty_geometries": empty,
        "invalid_geometries": invalid,
        "bbox": [minx, miny, maxx, maxy] if n > empty else None,
        "crs": "EPSG:4326",
    }
    log.info(f"Validation [{name}]: {report}")
    if n == 0:
        log.warning(f"Validation [{name}]: ZERO features — do not mark this dataset READY")
    return report

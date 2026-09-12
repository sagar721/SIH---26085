"""PHASE 1 — Exports Mapbox-encoded terrain-RGB XYZ tiles for the two pilot
zones, for MapLibre GL JS native 3D terrain (`map.setTerrain()` with a
`raster-dem` source) — no CesiumJS, no new rendering engine.

Elevation comes from dem_source.load_zone_elevation(), which prefers the
full-precision Copernicus-DEM-derived raster and transparently falls back to
re-decoding the tracked elevation PNG when that raster is absent (see
dem_source.py's docstring). Every output tile's provenance is carried in the
per-zone manifest JSON — never silently upgraded to "REAL".

Deliberately zone-scoped, not city-wide: only the tile range covering each
pilot zone (+1 tile buffer) is generated, at a small, fixed zoom band, per
the project's existing "detailed simulation only in the pilot zone" rule.

Encoding: standard Mapbox Terrain-RGB —
    height_m = -10000 + (R * 256 * 256 + G * 256 + B) * 0.1
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, PILOT_ZONES, get_logger, now_iso, write_json
from dem_source import ElevationUnavailable, load_zone_elevation

log = get_logger("export_terrain_rgb")

OUT_DIR = DATA_ROOT / "processed" / "dem" / "terrain_rgb"
ZOOM_LEVELS = [12, 13, 14]
TILE_SIZE = 256
# Elevation grid computed once per zone, then sampled per output tile.
# Fine enough relative to the ~30m decoded-fallback precision that we are
# not inventing detail the source doesn't have; resampling to more tiles
# below this does not add real information.
MASTER_GRID = 512


def deg2num(lat_deg: float, lon_deg: float, zoom: int) -> tuple[int, int]:
    lat_rad = math.radians(lat_deg)
    n = 2.0 ** zoom
    xtile = int((lon_deg + 180.0) / 360.0 * n)
    ytile = int((1.0 - math.asinh(math.tan(lat_rad)) / math.pi) / 2.0 * n)
    return xtile, ytile


def num2deg(xtile: int, ytile: int, zoom: int) -> tuple[float, float]:
    """Returns (lat, lon) of the tile's NW corner."""
    n = 2.0 ** zoom
    lon_deg = xtile / n * 360.0 - 180.0
    lat_rad = math.atan(math.sinh(math.pi * (1 - 2 * ytile / n)))
    return math.degrees(lat_rad), lon_deg


def mapbox_encode(elevation_m: np.ndarray) -> np.ndarray:
    value = np.round((elevation_m + 10000.0) / 0.1).astype("int64")
    value = np.clip(value, 0, 256 ** 3 - 1)
    r = (value // (256 * 256)) % 256
    g = (value // 256) % 256
    b = value % 256
    rgba = np.zeros((*elevation_m.shape, 4), dtype="uint8")
    rgba[..., 0] = r
    rgba[..., 1] = g
    rgba[..., 2] = b
    rgba[..., 3] = 255
    return rgba


def bilinear_sample(master: np.ndarray, master_bbox_wsen, lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
    """Samples the equirectangular `master` grid (rows: north->south, cols: west->east)
    at arbitrary lat/lon points via bilinear interpolation, clamping out-of-range points
    to the nearest edge (only matters for the small buffer margin of edge tiles)."""
    west, south, east, north = master_bbox_wsen
    rows, cols = master.shape
    col_f = (lons - west) / (east - west) * (cols - 1)
    row_f = (north - lats) / (north - south) * (rows - 1)
    col_f = np.clip(col_f, 0, cols - 1)
    row_f = np.clip(row_f, 0, rows - 1)

    c0 = np.floor(col_f).astype(int)
    r0 = np.floor(row_f).astype(int)
    c1 = np.clip(c0 + 1, 0, cols - 1)
    r1 = np.clip(r0 + 1, 0, rows - 1)
    fc = col_f - c0
    fr = row_f - r0

    top = master[r0, c0] * (1 - fc) + master[r0, c1] * fc
    bot = master[r1, c0] * (1 - fc) + master[r1, c1] * fc
    return top * (1 - fr) + bot * fr


def tiles_for_bbox(bbox_wsen, zoom: int, buffer_tiles: int = 1):
    west, south, east, north = bbox_wsen
    x0, y0 = deg2num(north, west, zoom)
    x1, y1 = deg2num(south, east, zoom)
    x_lo, x_hi = min(x0, x1) - buffer_tiles, max(x0, x1) + buffer_tiles
    y_lo, y_hi = min(y0, y1) - buffer_tiles, max(y0, y1) + buffer_tiles
    return [(x, y) for x in range(x_lo, x_hi + 1) for y in range(y_lo, y_hi + 1)]


def process_zone(zone_id: str, bbox_wsen: tuple[float, float, float, float]) -> dict:
    log.info(f"[{zone_id}] Loading elevation grid ({MASTER_GRID}x{MASTER_GRID})...")
    elev_result = load_zone_elevation(bbox_wsen, MASTER_GRID, MASTER_GRID)
    master = elev_result["elevation_m"]

    zone_dir = OUT_DIR / zone_id
    tile_count = 0
    zoom_manifest = {}
    for zoom in ZOOM_LEVELS:
        tiles = tiles_for_bbox(bbox_wsen, zoom)
        written = []
        for x, y in tiles:
            nw_lat, nw_lon = num2deg(x, y, zoom)
            se_lat, se_lon = num2deg(x + 1, y + 1, zoom)
            # Per-pixel lat/lon within this tile, standard Web Mercator inverse.
            n = 2.0 ** zoom
            px = (x + (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE)
            py = (y + (np.arange(TILE_SIZE) + 0.5) / TILE_SIZE)
            lon = px / n * 360.0 - 180.0
            lat_rad = np.arctan(np.sinh(np.pi * (1 - 2 * py / n)))
            lat = np.degrees(lat_rad)
            lon_grid, lat_grid = np.meshgrid(lon, lat)

            sampled = bilinear_sample(master, bbox_wsen, lat_grid, lon_grid)
            rgba = mapbox_encode(sampled)

            tile_path = zone_dir / str(zoom) / str(x) / f"{y}.png"
            tile_path.parent.mkdir(parents=True, exist_ok=True)
            Image.fromarray(rgba, "RGBA").save(tile_path)
            written.append({"x": x, "y": y})
            tile_count += 1
        zoom_manifest[str(zoom)] = {"tile_count": len(written), "tiles": written}
        log.info(f"[{zone_id}] z{zoom}: {len(written)} tiles written")

    manifest = {
        "zone_id": zone_id,
        "bounds_wgs84": {"west": bbox_wsen[0], "south": bbox_wsen[1], "east": bbox_wsen[2], "north": bbox_wsen[3]},
        "tile_url_template": f"data/dem/terrain_rgb/{zone_id}/{{z}}/{{x}}/{{y}}.png",
        "encoding": "mapbox",
        "tile_size": TILE_SIZE,
        "zoom_levels": ZOOM_LEVELS,
        "total_tiles": tile_count,
        "zooms": zoom_manifest,
        "provenance": elev_result["provenance"],
        "source": elev_result["source"],
        "precision_note": elev_result["precision_note"],
        "fallback_used": elev_result["fallback_used"],
        "generated_at": now_iso(),
    }
    write_json(zone_dir / "_terrain_rgb_manifest.json", manifest, log)
    return manifest


def main():
    results = {}
    for zone_id, bbox in PILOT_ZONES.items():
        try:
            results[zone_id] = process_zone(zone_id, bbox)
        except ElevationUnavailable as e:
            log.error(f"[{zone_id}] BLOCKED: {e}")
            write_json(OUT_DIR / zone_id / "_terrain_rgb_manifest.json", {
                "zone_id": zone_id, "status": "BLOCKED", "reason": str(e), "checked_at": now_iso(),
            }, log)

    log.info("=== Terrain-RGB export summary ===")
    for zone_id, m in results.items():
        log.info(f"  {zone_id}: {m['total_tiles']} tiles, provenance={m['provenance']}, "
                  f"fallback_used={m['fallback_used']}")
    if not results:
        sys.exit(2)


if __name__ == "__main__":
    main()

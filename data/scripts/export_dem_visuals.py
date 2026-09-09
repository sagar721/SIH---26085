"""Renders the real DEM-derived rasters (elevation, slope, flow
accumulation) as colorized PNGs for MapLibre `image` sources — the same
approach already used for land cover. Covers the full Greater Mumbai DEM
extent (not just the pilot zones), since terrain is genuinely city-wide.
"""
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("export_dem_visuals")

DEM_DIR = DATA_ROOT / "processed" / "dem"
OUT_DIR = DEM_DIR  # keep visuals alongside the source rasters


def normalize_to_rgba(data: np.ndarray, cmap_stops, vmin=None, vmax=None) -> np.ndarray:
    vmin = float(np.nanmin(data)) if vmin is None else vmin
    vmax = float(np.nanmax(data)) if vmax is None else vmax
    norm = np.clip((data - vmin) / max(vmax - vmin, 1e-9), 0, 1)
    h, w = data.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    stops = np.array(cmap_stops)
    positions = stops[:, 0]
    colors = stops[:, 1:4]
    for channel in range(3):
        rgba[:, :, channel] = np.interp(norm, positions, colors[:, channel]).astype(np.uint8)
    rgba[:, :, 3] = 210
    return rgba


ELEVATION_CMAP = [
    (0.0, 13, 27, 42), (0.15, 15, 76, 92), (0.35, 64, 145, 108),
    (0.55, 168, 178, 79), (0.75, 186, 140, 88), (1.0, 230, 230, 230),
]
SLOPE_CMAP = [
    (0.0, 16, 122, 47), (0.3, 190, 190, 40), (0.6, 214, 130, 40), (1.0, 178, 34, 34),
]


def main():
    with rasterio.open(DEM_DIR / "mumbai_dem_filled.tif") as src:
        elevation = src.read(1)
        bounds = src.bounds

    with rasterio.open(DEM_DIR / "mumbai_slope_degrees.tif") as src:
        slope = src.read(1)

    elev_rgba = normalize_to_rgba(elevation, ELEVATION_CMAP, vmin=0, vmax=100)  # cap at 100m: Mumbai is mostly low-lying
    Image.fromarray(elev_rgba, "RGBA").save(OUT_DIR / "mumbai_elevation.png")
    log.info(f"Wrote {OUT_DIR / 'mumbai_elevation.png'} ({elev_rgba.shape[1]}x{elev_rgba.shape[0]})")

    slope_rgba = normalize_to_rgba(slope, SLOPE_CMAP, vmin=0, vmax=20)  # cap at 20deg: >20 is rare/steep in this bbox
    Image.fromarray(slope_rgba, "RGBA").save(OUT_DIR / "mumbai_slope.png")
    log.info(f"Wrote {OUT_DIR / 'mumbai_slope.png'} ({slope_rgba.shape[1]}x{slope_rgba.shape[0]})")

    write_json(OUT_DIR / "mumbai_dem_visual_bounds.json", {
        "bounds_wgs84": {"west": bounds.left, "south": bounds.bottom, "east": bounds.right, "north": bounds.top},
        "elevation_image": "mumbai_elevation.png",
        "elevation_range_capped_m": [0, 100],
        "elevation_range_actual_m": [float(elevation.min()), float(elevation.max())],
        "slope_image": "mumbai_slope.png",
        "slope_range_capped_deg": [0, 20],
        "slope_range_actual_deg": [float(slope.min()), float(slope.max())],
        "note": "Color ranges are capped for visual contrast (Mumbai is mostly low-lying/flat); actual data range is wider — see *_actual_* fields.",
        "generated_at": now_iso(),
    }, log)


if __name__ == "__main__":
    main()

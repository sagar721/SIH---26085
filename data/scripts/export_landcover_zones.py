"""Clips the processed Mumbai WorldCover raster to each pilot zone and
renders a small colorized PNG + bounds, suitable for a MapLibre GL `image`
source. This is the frontend-consumable form of REAL ESA WorldCover data;
the full-resolution GeoTIFF stays in data/processed/landcover for any
future backend modelling use.
"""
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import from_bounds
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("export_landcover_zones")

PILOT_ZONES = {
    "kurla_sion": (72.8527, 19.0510, 72.9027, 19.1010),  # west, south, east, north
    "hindmata_dadar": (72.8226, 18.9963, 72.8626, 19.0363),
}

# ESA WorldCover v200 official palette (class value -> RGB)
PALETTE = {
    10: (0, 100, 0), 20: (255, 187, 34), 30: (255, 255, 76), 40: (240, 150, 255),
    50: (250, 0, 0), 60: (180, 180, 180), 70: (240, 240, 240), 80: (0, 100, 200),
    90: (0, 150, 160), 95: (0, 207, 117), 100: (250, 230, 160), 0: (0, 0, 0),
}


def to_rgba(class_array: np.ndarray) -> np.ndarray:
    h, w = class_array.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for cls, color in PALETTE.items():
        mask = class_array == cls
        rgba[mask, 0], rgba[mask, 1], rgba[mask, 2] = color
        rgba[mask, 3] = 200
    return rgba


def main():
    src_path = DATA_ROOT / "processed" / "landcover" / "mumbai_worldcover_2021.tif"
    out_dir = DATA_ROOT / "processed" / "landcover"

    with rasterio.open(src_path) as src:
        for zone_id, bbox in PILOT_ZONES.items():
            window = from_bounds(*bbox, transform=src.transform)
            data = src.read(1, window=window)
            if data.size == 0:
                log.error(f"{zone_id}: empty window, skipping")
                continue
            rgba = to_rgba(data)
            img = Image.fromarray(rgba, mode="RGBA")
            png_path = out_dir / f"{zone_id}_landcover.png"
            img.save(png_path)
            log.info(f"Wrote {png_path} ({img.width}x{img.height})")

            unique, counts = np.unique(data, return_counts=True)
            write_json(out_dir / f"{zone_id}_landcover_bounds.json", {
                "zone_id": zone_id,
                "bounds_wgs84": {"west": bbox[0], "south": bbox[1], "east": bbox[2], "north": bbox[3]},
                "image": f"{zone_id}_landcover.png",
                "source": "ESA WorldCover 10m v200 (2021)",
                "class_pixel_counts": {int(u): int(c) for u, c in zip(unique, counts)},
                "generated_at": now_iso(),
            }, log)


if __name__ == "__main__":
    main()

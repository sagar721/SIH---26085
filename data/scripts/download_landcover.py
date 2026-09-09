"""Downloads REAL ESA WorldCover 10m v200 (2021) land-cover data for Mumbai.

Source: Excel category E, RECOMMENDATION=PRIMARY. Open AWS S3 bucket, no
credentials required. Mumbai (~19.0N, 72.85E) falls inside the 3x3-degree
tile named by its south-west corner: N18E072 (covers 18-21N, 72-75E).

After download, clips to the Greater Mumbai bounding box and derives a
"built-up" binary mask from WorldCover class 50. This is explicitly NOT an
impervious-surface percentage — WorldCover's built-up class is a single
coarse land-cover category, not a calibrated imperviousness product. That
caveat is written into the output metadata, not just this docstring.
"""
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, USER_AGENT, get_logger, now_iso, write_json

log = get_logger("download_landcover")

TILE_NAME = "ESA_WorldCover_10m_2021_v200_N18E072_Map.tif"
TILE_URL = f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/{TILE_NAME}"

GREATER_MUMBAI_BBOX = (72.75, 18.85, 73.05, 19.30)  # (west, south, east, north)

WORLDCOVER_CLASSES = {
    10: "Tree cover", 20: "Shrubland", 30: "Grassland", 40: "Cropland",
    50: "Built-up", 60: "Bare / sparse vegetation", 70: "Snow and ice",
    80: "Permanent water bodies", 90: "Herbaceous wetland", 95: "Mangroves",
    100: "Moss and lichen",
}


def download_tile():
    raw_dir = DATA_ROOT / "raw" / "landcover"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_path = raw_dir / TILE_NAME

    if out_path.exists() and out_path.stat().st_size > 50_000_000:
        log.info(f"Tile already present ({out_path.stat().st_size:,} bytes), skipping download.")
        return out_path

    log.info(f"Downloading {TILE_URL} ...")
    with requests.get(TILE_URL, headers={"User-Agent": USER_AGENT}, stream=True, timeout=600) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        written = 0
        with open(out_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                written += len(chunk)
        log.info(f"Downloaded {written:,} bytes (expected {total:,})")
        if total and written != total:
            raise IOError(f"Incomplete download: got {written} of {total} bytes")
    return out_path


def clip_and_derive(tile_path: Path):
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds

    processed_dir = DATA_ROOT / "processed" / "landcover"
    processed_dir.mkdir(parents=True, exist_ok=True)

    with rasterio.open(tile_path) as src:
        log.info(f"Source raster: {src.width}x{src.height}, CRS={src.crs}, bounds={src.bounds}")
        window = from_bounds(*GREATER_MUMBAI_BBOX, transform=src.transform)
        data = src.read(1, window=window)
        transform = src.window_transform(window)

        if data.size == 0:
            raise ValueError("Clipped window is empty — bbox does not intersect this tile")

        clipped_meta = src.meta.copy()
        clipped_meta.update({
            "height": data.shape[0], "width": data.shape[1], "transform": transform,
        })
        clipped_path = processed_dir / "mumbai_worldcover_2021.tif"
        with rasterio.open(clipped_path, "w", **clipped_meta) as dst:
            dst.write(data, 1)
        log.info(f"Wrote clipped raster: {clipped_path} ({data.shape[1]}x{data.shape[0]})")

        built_up_mask = (data == 50).astype("uint8")
        mask_meta = clipped_meta.copy()
        mask_meta.update({"dtype": "uint8", "nodata": 255})
        mask_path = processed_dir / "mumbai_built_up_mask.tif"
        with rasterio.open(mask_path, "w", **mask_meta) as dst:
            dst.write(built_up_mask, 1)
        log.info(f"Wrote built-up mask: {mask_path}")

        unique, counts = np.unique(data, return_counts=True)
        class_pixels = {WORLDCOVER_CLASSES.get(int(u), f"class_{u}"): int(c) for u, c in zip(unique, counts)}
        total_px = int(data.size)

    report = {
        "source_tile": TILE_NAME,
        "clipped_bbox_wgs84": list(GREATER_MUMBAI_BBOX),
        "resolution_m": 10,
        "total_pixels": total_px,
        "class_pixel_counts": class_pixels,
        "built_up_pixel_fraction": class_pixels.get("Built-up", 0) / total_px if total_px else None,
        "caveat": (
            "The 'Built-up' WorldCover class is a single coarse land-cover category "
            "(10m resolution, 2021 snapshot). It is NOT a calibrated impervious-surface "
            "percentage and must not be reported or labelled as one."
        ),
        "generated_at": now_iso(),
    }
    write_json(processed_dir / "worldcover_class_report.json", report, log)
    return clipped_path, mask_path, report


if __name__ == "__main__":
    try:
        tile_path = download_tile()
        clip_and_derive(tile_path)
        log.info("Land cover acquisition + processing complete.")
    except Exception as e:
        log.error(f"FAILED: {e}")
        raise

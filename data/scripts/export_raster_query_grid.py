"""Exports a coarse, clickable sample-point grid for each city-wide raster
(DEM elevation, slope, flood susceptibility) so the frontend can offer
click-to-inspect on layers that are otherwise flat PNG image overlays
(MapLibre `image` sources carry no per-pixel queryable data).

Each raster is sampled on a fixed-size grid (default 80x80 cells across the
raster's bounds) using the real GeoTIFF pixel values — never interpolated
or invented. Output is a small GeoJSON Point FeatureCollection; the frontend
does a nearest-point lookup at click time within a tolerance derived from
the grid spacing.
"""
import sys
from pathlib import Path

import numpy as np
import rasterio

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("export_raster_query_grid")

GRID_SIZE = 50  # cells per axis -> up to 2,500 points per raster (small GeoJSON)


def sample_grid(tif_path: Path, value_name: str, provenance: str, round_digits: int = 2):
    with rasterio.open(tif_path) as src:
        band = src.read(1, masked=True)
        west, south, east, north = src.bounds
        rows, cols = band.shape
        row_idx = np.linspace(0, rows - 1, GRID_SIZE).astype(int)
        col_idx = np.linspace(0, cols - 1, GRID_SIZE).astype(int)

        features = []
        for r in row_idx:
            for c in col_idx:
                val = band[r, c]
                if np.ma.is_masked(val):
                    continue
                lng, lat = src.xy(r, c)
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
                    "properties": {value_name: round(float(val), round_digits), "provenance": provenance},
                })

        spacing_deg = max((east - west) / GRID_SIZE, (north - south) / GRID_SIZE)
        return {"type": "FeatureCollection", "features": features}, spacing_deg


def main():
    dem_dir = DATA_ROOT / "processed" / "dem"
    flood_dir = DATA_ROOT / "processed" / "flood_model"

    targets = [
        (dem_dir / "mumbai_dem_filled.tif", dem_dir / "mumbai_elevation_query_grid.geojson", "elevation_m", "OBSERVED", 1),
        (dem_dir / "mumbai_slope_degrees.tif", dem_dir / "mumbai_slope_query_grid.geojson", "slope_degrees", "INFERRED", 2),
        (flood_dir / "mumbai_flood_susceptibility.tif", flood_dir / "mumbai_susceptibility_query_grid.geojson", "susceptibility_score", "MODELLED", 4),
    ]

    max_spacing_deg = 0.0
    for src_tif, out_path, value_name, provenance, digits in targets:
        if not src_tif.exists():
            log.warning(f"Missing source raster, skipping: {src_tif}")
            continue
        fc, spacing_deg = sample_grid(src_tif, value_name, provenance, digits)
        max_spacing_deg = max(max_spacing_deg, spacing_deg)
        write_json(out_path, fc, log)
        log.info(f"{out_path.name}: {len(fc['features'])} grid points sampled from {src_tif.name}")

    write_json(dem_dir / "_raster_query_grid_status.json", {
        "status": "COMPLETE",
        "grid_size": GRID_SIZE,
        "approx_point_spacing_deg": round(max_spacing_deg, 5),
        "method": "Fixed-size grid sample of real GeoTIFF pixel values (nearest-neighbor lookup at click time)",
        "generated_at": now_iso(),
    }, log)


if __name__ == "__main__":
    main()

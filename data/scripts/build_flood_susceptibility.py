"""Builds a DEM-aware flood SUSCEPTIBILITY index for Greater Mumbai.

Explicitly MODELLED — not OBSERVED, not VALIDATED. It is a transparent,
documented combination of real terrain/landcover factors that predisposes a
location to flooding; it is NOT a hydraulic simulation and has not been
compared against any observed flood extent (see ValidationModal for why).

Inputs (all real, all already acquired):
  - DEM elevation (data/processed/dem/mumbai_dem_filled.tif)
  - DEM slope (data/processed/dem/mumbai_slope_degrees.tif)
  - DEM flow accumulation (data/processed/dem/mumbai_flow_accumulation.tif)
  - ESA WorldCover built-up mask (data/processed/landcover/mumbai_built_up_mask.tif)
  - OSM waterways (data/raw/water/greater_mumbai_water_waterways.geojson) — distance transform

Method (documented, reproducible, equal-weighted 0-1 composite — NOT a
calibrated hydrological model):
  susceptibility = mean(
      normalize(1 - elevation),          # lower ground -> higher susceptibility
      normalize(1 - slope),              # flatter ground -> poor natural drainage
      normalize(log1p(flow_accum)),      # natural convergence zones
      built_up_mask,                     # impervious surface -> higher runoff
      normalize(1 - distance_to_water),  # proximity to a real waterway
  )

Rainfall is deliberately NOT baked into this static layer — it is combined
with real-time GSMaP intensity at render time in the frontend (susceptibility
x current rainfall factor), so the same terrain layer stays valid across the
whole timeline instead of being recomputed per hour.
"""
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from rasterio.features import rasterize
from scipy.ndimage import distance_transform_edt
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("build_flood_susceptibility")

DEM_DIR = DATA_ROOT / "processed" / "dem"
OUT_DIR = DATA_ROOT / "processed" / "flood_model"


def normalize(arr: np.ndarray) -> np.ndarray:
    lo, hi = np.nanmin(arr), np.nanmax(arr)
    if hi - lo < 1e-9:
        return np.zeros_like(arr)
    return (arr - lo) / (hi - lo)


def load_factor_scores():
    """Loads and computes the 5 real per-pixel factor score arrays (each
    already normalized 0-1) that the susceptibility composite is built from,
    plus the reference grid's transform/CRS/bounds. Factored out of main()
    so data/scripts/sensitivity_analysis.py can recombine the same real
    factors under different weights without recomputing them from scratch."""
    with rasterio.open(DEM_DIR / "mumbai_dem_filled.tif") as src:
        elevation = src.read(1)
        ref_transform, ref_crs, ref_shape = src.transform, src.crs, (src.height, src.width)
        ref_bounds = src.bounds

    with rasterio.open(DEM_DIR / "mumbai_slope_degrees.tif") as src:
        slope = src.read(1)

    with rasterio.open(DEM_DIR / "mumbai_flow_accumulation.tif") as src:
        flow_accum = src.read(1).astype("float64")

    built_up_path = DATA_ROOT / "processed" / "landcover" / "mumbai_built_up_mask.tif"
    built_up = np.zeros(ref_shape, dtype="float32")
    with rasterio.open(built_up_path) as src:
        reproject(
            source=rasterio.band(src, 1), destination=built_up,
            src_transform=src.transform, src_crs=src.crs,
            dst_transform=ref_transform, dst_crs=ref_crs,
            resampling=Resampling.average,
        )

    import json
    with open(DATA_ROOT / "raw" / "water" / "greater_mumbai_water_waterways.geojson", encoding="utf-8") as f:
        water_geo = json.load(f)
    shapes = [(f["geometry"], 1) for f in water_geo["features"] if f["geometry"]]
    water_mask = rasterize(shapes, out_shape=ref_shape, transform=ref_transform, fill=0, dtype="uint8")
    px_size_m = abs(ref_transform.a) * 111_320
    dist_to_water_m = distance_transform_edt(1 - water_mask) * px_size_m

    factors = {
        "elevation": normalize(-elevation),
        "slope": normalize(-slope),
        "flow_accumulation": normalize(np.log1p(flow_accum)),
        "built_up": np.clip(built_up, 0, 1),
        "water_proximity": normalize(-np.clip(dist_to_water_m, 0, 1000)),
    }
    validate_factors(factors, ref_shape)
    return factors, ref_transform, ref_crs, ref_bounds


def validate_factors(factors: dict, expected_shape: tuple):
    """Disaster-readiness audit item 1.3 (DEM/raster errors): a corrupt or
    truncated input raster must fail loudly here, never propagate silently
    into a susceptibility map that looks plausible but is wrong. Raises
    AssertionError with a specific reason on any violation — this is meant
    to crash the pipeline run, not to be caught and worked around."""
    for name, arr in factors.items():
        assert arr.shape == expected_shape, f"Factor '{name}' shape {arr.shape} != expected {expected_shape}"
        assert np.isfinite(arr).all(), f"Factor '{name}' contains NaN/Inf values ({(~np.isfinite(arr)).sum()} cells)"
        lo, hi = float(arr.min()), float(arr.max())
        assert -1e-6 <= lo and hi <= 1 + 1e-6, f"Factor '{name}' out of expected [0,1] range: [{lo}, {hi}]"
        assert hi - lo > 1e-6, f"Factor '{name}' is constant (min==max=={lo}) — likely a data/reprojection failure"


def main():
    factors, ref_transform, ref_crs, ref_bounds = load_factor_scores()
    log.info(f"Fraction built-up = {float(np.nanmean(factors['built_up'])):.3f}")

    susceptibility = sum(factors.values()) / len(factors)
    susceptibility = susceptibility.astype("float32")
    ref_shape = susceptibility.shape

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meta = {"driver": "GTiff", "dtype": "float32", "count": 1, "height": ref_shape[0], "width": ref_shape[1],
            "crs": ref_crs, "transform": ref_transform}
    with rasterio.open(OUT_DIR / "mumbai_flood_susceptibility.tif", "w", **meta) as dst:
        dst.write(susceptibility, 1)
    log.info(f"Wrote {OUT_DIR / 'mumbai_flood_susceptibility.tif'} "
             f"(range {float(susceptibility.min()):.3f}-{float(susceptibility.max()):.3f})")

    # Colorized PNG for the frontend (same image-source pattern as elevation/slope/landcover)
    cmap = [(0.0, 16, 88, 40), (0.4, 138, 154, 30), (0.7, 214, 130, 40), (1.0, 178, 24, 24)]
    stops = np.array(cmap)
    rgba = np.zeros((*susceptibility.shape, 4), dtype=np.uint8)
    for ch in range(3):
        rgba[:, :, ch] = np.interp(susceptibility, stops[:, 0], stops[:, ch + 1]).astype(np.uint8)
    rgba[:, :, 3] = (susceptibility * 180 + 40).astype(np.uint8)  # more susceptible = more opaque
    Image.fromarray(rgba, "RGBA").save(OUT_DIR / "mumbai_flood_susceptibility.png")
    log.info(f"Wrote {OUT_DIR / 'mumbai_flood_susceptibility.png'}")

    write_json(OUT_DIR / "flood_susceptibility_metadata.json", {
        "label": "Flood Susceptibility Index",
        "status": "MODELLED",
        "not": ["OBSERVED", "VALIDATED"],
        "method": "Equal-weighted 0-1 composite of 5 real terrain/landcover factors "
                  "(inverted elevation, inverted slope, log flow-accumulation, built-up fraction, "
                  "inverted distance-to-waterway). See build_flood_susceptibility.py docstring for exact formula.",
        "inputs": [
            "Copernicus DEM GLO-30 (elevation, slope, flow accumulation) — REAL",
            "ESA WorldCover 10m built-up mask — REAL",
            "OSM waterways — REAL",
        ],
        "explicitly_not_included": "Rainfall is NOT baked into this static layer — combine with the current "
                                    "GSMaP/scenario rainfall intensity at render time. Not a calibrated hydraulic model.",
        "bounds_wgs84": {"west": ref_bounds.left, "south": ref_bounds.bottom, "east": ref_bounds.right, "north": ref_bounds.top},
        "image": "mumbai_flood_susceptibility.png",
        "value_range": [float(susceptibility.min()), float(susceptibility.max())],
        "generated_at": now_iso(),
    }, log)


if __name__ == "__main__":
    main()

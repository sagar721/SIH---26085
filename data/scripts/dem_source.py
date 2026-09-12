"""Shared elevation-grid access for the terrain/drainage/flood scripts.

Prefers the full-precision Copernicus-DEM-derived raster
(data/processed/dem/mumbai_dem_filled.tif), which is REAL Copernicus DEM
GLO-30 hydrologically conditioned by process_dem.py's priority-flood fill.
That raster is intentionally gitignored (regenerable via download_dem.py +
process_dem.py, which require OPENTOPOGRAPHY_API_KEY) and is commonly ABSENT
on a machine that only has this repo's tracked outputs checked out.

When it is absent, this module falls back to re-decoding the tracked
elevation visualization (data/processed/dem/mumbai_elevation.png). That PNG
encodes the SAME real DEM through a documented, invertible color ramp (see
export_dem_visuals.py: ELEVATION_CMAP, vmin=0, vmax=100). The R channel of
that ramp is strictly monotonic increasing across all 6 stops, so it can be
inverted exactly via piecewise-linear interpolation. This is real-data
re-derivation, not fabrication — but it is 8-bit-quantized and range-capped
at 100m, so every caller MUST propagate the returned provenance/precision
label rather than re-labelling the result as the full-precision source.

Both pilot zones are low-lying coastal Mumbai terrain, almost certainly well
under the 100m cap, so the fallback is expected to be valid there; this
module still checks and warns if any decoded value approaches the cap.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso

log = get_logger("dem_source")

DEM_DIR = DATA_ROOT / "processed" / "dem"
FULL_PRECISION_TIF = DEM_DIR / "mumbai_dem_filled.tif"
FALLBACK_PNG = DEM_DIR / "mumbai_elevation.png"
FALLBACK_BOUNDS_JSON = DEM_DIR / "mumbai_dem_visual_bounds.json"

# Must match export_dem_visuals.py exactly — this IS the inverse of that ramp.
ELEVATION_CMAP_R_STOPS = [13, 15, 64, 168, 186, 230]
ELEVATION_CMAP_POSITIONS = [0.0, 0.15, 0.35, 0.55, 0.75, 1.0]
FALLBACK_VMIN_M, FALLBACK_VMAX_M = 0.0, 100.0


class ElevationUnavailable(RuntimeError):
    pass


def _load_full_precision(bbox_wsen, out_rows: int, out_cols: int):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    west, south, east, north = bbox_wsen
    with rasterio.open(FULL_PRECISION_TIF) as src:
        window = from_bounds(west, south, east, north, transform=src.transform)
        arr = src.read(
            1, window=window, out_shape=(out_rows, out_cols), resampling=Resampling.bilinear
        ).astype("float64")
    return arr


def _load_png_fallback(bbox_wsen, out_rows: int, out_cols: int):
    import json

    from PIL import Image

    if not (FALLBACK_PNG.exists() and FALLBACK_BOUNDS_JSON.exists()):
        raise ElevationUnavailable(
            f"Neither {FULL_PRECISION_TIF.name} nor the fallback {FALLBACK_PNG.name} exist. "
            "Run download_dem.py (needs OPENTOPOGRAPHY_API_KEY) + process_dem.py + export_dem_visuals.py."
        )

    with open(FALLBACK_BOUNDS_JSON) as f:
        meta = json.load(f)
    full_bounds = meta["bounds_wgs84"]

    img = Image.open(FALLBACK_PNG).convert("RGBA")
    full_w, full_h = img.size
    r_channel = np.asarray(img)[:, :, 0].astype("float64")

    # Pixel window for the requested bbox within the full-extent PNG (north-up raster).
    px_w = (full_bounds["east"] - full_bounds["west"]) / full_w
    px_h = (full_bounds["north"] - full_bounds["south"]) / full_h
    west, south, east, north = bbox_wsen
    col0 = int((west - full_bounds["west"]) / px_w)
    col1 = int(np.ceil((east - full_bounds["west"]) / px_w))
    row0 = int((full_bounds["north"] - north) / px_h)
    row1 = int(np.ceil((full_bounds["north"] - south) / px_h))
    col0, col1 = max(0, col0), min(full_w, col1)
    row0, row1 = max(0, row0), min(full_h, row1)
    if col1 <= col0 or row1 <= row0:
        raise ElevationUnavailable(f"Requested bbox {bbox_wsen} does not overlap the elevation PNG extent.")

    crop = r_channel[row0:row1, col0:col1]

    # Invert the strictly-monotonic R-channel ramp back to normalized elevation, then to meters.
    norm = np.interp(crop, ELEVATION_CMAP_R_STOPS, ELEVATION_CMAP_POSITIONS)
    elevation_m = FALLBACK_VMIN_M + norm * (FALLBACK_VMAX_M - FALLBACK_VMIN_M)

    if elevation_m.max() > 0.92 * FALLBACK_VMAX_M:
        log.warning(
            f"Decoded elevation reaches {elevation_m.max():.1f}m, close to the PNG's {FALLBACK_VMAX_M:.0f}m cap — "
            "true elevation may be higher than this fallback can represent in part of this bbox."
        )

    # Resize (bilinear) from the cropped native-resolution grid to the caller's requested grid.
    crop_img = Image.fromarray(elevation_m.astype("float32"), mode="F")
    resized = crop_img.resize((out_cols, out_rows), resample=Image.BILINEAR)
    return np.asarray(resized, dtype="float64")


def load_zone_elevation(bbox_wsen, out_rows: int, out_cols: int) -> dict:
    """Returns {"elevation_m": ndarray[out_rows, out_cols], "provenance": str,
    "source": str, "precision_note": str} for the given (west, south, east, north)
    WGS84 bbox. Raises ElevationUnavailable if no real elevation source exists at all.
    """
    if FULL_PRECISION_TIF.exists():
        arr = _load_full_precision(bbox_wsen, out_rows, out_cols)
        return {
            "elevation_m": arr,
            "provenance": "DERIVED",
            "source": "Copernicus DEM GLO-30 (REAL), hydrologically conditioned (priority-flood fill)",
            "precision_note": "Full precision, ~30m native GLO-30 resolution, bilinear-resampled to output grid.",
            "fallback_used": False,
        }

    log.warning(
        f"{FULL_PRECISION_TIF} not present in this environment (gitignored; needs OPENTOPOGRAPHY_API_KEY to "
        f"regenerate — see MANUAL_ACTIONS_REQUIRED.md item 1). Falling back to re-decoding {FALLBACK_PNG.name}."
    )
    arr = _load_png_fallback(bbox_wsen, out_rows, out_cols)
    return {
        "elevation_m": arr,
        "provenance": "DERIVED",
        "source": "Re-decoded from mumbai_elevation.png (same real Copernicus DEM GLO-30, via its documented "
                   "invertible color ramp) because the full-precision raster is absent in this environment",
        "precision_note": "REDUCED PRECISION: 8-bit-quantized, range-capped at 100m, ~30m/px source resampled. "
                           "Regenerate at full precision by supplying OPENTOPOGRAPHY_API_KEY and re-running "
                           "download_dem.py + process_dem.py + export_dem_visuals.py.",
        "fallback_used": True,
    }

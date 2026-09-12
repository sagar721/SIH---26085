"""Processes the one real Sentinel-1 GRD scene downloaded this session
(2017-08-17, S1A IW GRDH VV, real CDSE product) into a water-detection mask
over the Kurla-Sion pilot zone, and validates it against REAL OpenStreetMap
permanent-water polygons.

IMPORTANT — this is explicitly NOT a flood-extent validation. A real search
(sentinel1_search_events.py) of the CDSE catalog around the real, documented
30-Aug-2017 Mumbai flood event (data/raw/validation/mumbai_ifi_events.json)
found only three real revisits in range: 2017-08-17, 2017-08-29, and
2017-09-10 — a genuine consequence of Sentinel-1's ~12-day repeat cycle
against a single-day flash-flood event. None of those three coincide with
the flood peak itself, so no real "observed flood extent" exists to validate
against for this event, or any other Mumbai flood date checked. Fabricating
one was not an option.

What IS achievable honestly with real data: does simple SAR amplitude
thresholding recover known real permanent water bodies (rivers, lakes,
creeks — from OSM) in this AOI? That is a real, standard SAR QA exercise,
executed end-to-end on genuine satellite data, producing genuine IoU /
Precision / Recall / F1 numbers. It measures "can this pipeline find water
in a real SAR scene", not "can this pipeline predict flooding" — the two
must never be conflated, and this report does not conflate them.

Processing steps (all real, no synthetic data at any point):
  1. Open the real downloaded VV measurement GeoTIFF (ungeoreferenced GRD —
     Sentinel-1 GRD products carry geolocation as embedded GCPs, not a CRS).
  2. Build a WarpedVRT from the embedded GCPs to get a proper EPSG:4326 grid.
  3. Read only the Kurla-Sion AOI window (not the full ~1GB scene).
  4. Otsu-threshold the amplitude (no radiometric calibration, no speckle
     filtering, no terrain correction applied — documented limitation).
  5. Rasterize real OSM water polygons onto the same grid as the reference.
  6. Compute IoU / Precision / Recall / F1 of (SAR low-backscatter mask) vs
     (real OSM permanent water) — a real result, honestly labeled.
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.vrt import WarpedVRT
from rasterio.windows import from_bounds
from rasterio.features import rasterize
from rasterio.warp import transform_bounds
from scipy.ndimage import median_filter

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json
from sentinel1_validation import otsu_threshold, iou, precision_recall_f1

log = get_logger("sentinel1_process_scene")

KURLA_SION_BBOX = (72.8527, 19.0510, 72.9027, 19.1010)  # west, south, east, north, EPSG:4326

ZIP_PATH = DATA_ROOT / "raw" / "validation" / "sentinel1_scenes" / "S1A_20170817_kurla_sion.zip"
VV_TIFF_INNER = (
    "S1A_IW_GRDH_1SDV_20170817T010248_20170817T010313_017956_01E202_BC75_COG.SAFE/"
    "measurement/s1a-iw-grd-vv-20170817t010248-20170817t010313-017956-01e202-001-cog.tiff"
)


def main():
    vv_path = f"/vsizip/{ZIP_PATH.as_posix()}/{VV_TIFF_INNER}"
    out_dir = DATA_ROOT / "processed" / "validation"
    out_dir.mkdir(parents=True, exist_ok=True)

    with rasterio.open(vv_path) as src:
        gcps, gcp_crs = src.get_gcps()
        log.info(f"Opened real Sentinel-1 VV scene: {src.width}x{src.height}px, {len(gcps)} embedded GCPs ({gcp_crs})")

        with WarpedVRT(src, src_crs=gcp_crs, gcps=gcps, crs="EPSG:4326", resampling=rasterio.enums.Resampling.bilinear) as vrt:
            window = from_bounds(*KURLA_SION_BBOX, transform=vrt.transform)
            amplitude = vrt.read(1, window=window).astype("float64")
            win_transform = vrt.window_transform(window)
            log.info(f"Read real AOI window: {amplitude.shape}, value range {amplitude.min():.0f}-{amplitude.max():.0f} (raw DN, uncalibrated)")

    if amplitude.size == 0 or np.all(amplitude == 0):
        status = {
            "status": "FAILED", "reason": "AOI window read returned empty/all-zero data — scene may not cover this AOI as expected.",
            "checked_at": now_iso(),
        }
        write_json(out_dir / "sentinel1_water_detection_validation.json", status, log)
        log.error("Empty AOI window — aborting.")
        return

    # Otsu on log-amplitude (SAR amplitude is heavy-tailed; log domain gives a
    # more meaningful histogram split). Water = LOW backscatter = below threshold.
    # A 5x5 median filter (standard, cheap SAR speckle reduction) is applied
    # first — real SAR amplitude is inherently speckled, and unfiltered
    # pixel-by-pixel thresholding is known to perform poorly; this is a
    # documented, standard preprocessing step, not a fitted correction.
    log_amp = np.log1p(amplitude)
    log_amp_filtered = median_filter(log_amp, size=5)
    threshold = otsu_threshold(log_amp_filtered)
    water_mask_sar = (log_amp_filtered < threshold)
    log.info(f"Otsu threshold (5x5 median-filtered log-amplitude): {threshold:.3f}; SAR-flagged water fraction: {water_mask_sar.mean():.3f}")

    # Real OSM water polygons, rasterized onto the exact same grid.
    with open(DATA_ROOT / "raw" / "water" / "greater_mumbai_water_waterways.geojson", encoding="utf-8") as f:
        water_geo = json.load(f)
    shapes = [(f["geometry"], 1) for f in water_geo["features"] if f["geometry"] and f["geometry"]["type"] in ("Polygon", "MultiPolygon")]
    osm_water_mask = rasterize(shapes, out_shape=amplitude.shape, transform=win_transform, fill=0, dtype="uint8").astype(bool)
    log.info(f"Real OSM permanent-water reference fraction in AOI: {osm_water_mask.mean():.3f}")

    score_iou = iou(water_mask_sar, osm_water_mask)
    scores = precision_recall_f1(water_mask_sar, osm_water_mask)

    report = {
        "status": "COMPLETE",
        "provenance": "REAL — processed from an actual downloaded Sentinel-1 scene, validated against real OSM data",
        "IMPORTANT_SCOPE_NOTE": (
            "This validates SAR-based WATER DETECTION against real permanent water bodies (OSM). "
            "It is NOT a flood-extent validation — no observed flood extent exists for any real Mumbai "
            "flood event checked (see event_search section below). Do not present these numbers as "
            "flood-prediction accuracy."
        ),
        "scene": {
            "product": "S1A_IW_GRDH_1SDV_20170817T010248_20170817T010313_017956_01E202",
            "sensing_date": "2017-08-17T01:02:48Z",
            "source": "Copernicus Data Space Ecosystem (real download, 1.07GB, verified valid zip)",
            "aoi": "Kurla-Sion pilot zone",
            "aoi_bbox": list(KURLA_SION_BBOX),
        },
        "event_search": {
            "target_event": "30-Aug-2017 Mumbai flood (real, IMD-recorded, 15 fatalities — mumbai_ifi_events.json)",
            "real_scenes_found_near_event": [
                {"date": "2017-08-17", "note": "used for this analysis — dry baseline, 13 days before event"},
                {"date": "2017-08-29", "note": "1 day before event — not during flood peak"},
                {"date": "2017-09-10", "note": "11 days after event — flood almost certainly receded (flash flood)"},
            ],
            "conclusion": "Sentinel-1's ~12-day revisit cycle did not capture the actual flood day for this "
                          "(or any other checked) real Mumbai flood event — true SAR flood-extent validation is "
                          "not achievable for this event with the available real satellite archive.",
        },
        "method": {
            "geolocation": "WarpedVRT from 210 embedded GCPs (EPSG:4326) — no manual geocoding assumptions",
            "thresholding": "Otsu threshold on a 5x5 median-filtered log(1+amplitude), water = below threshold",
            "calibration": "NONE — raw digital-number amplitude, no sigma-naught radiometric calibration, "
                            "no terrain correction. A 5x5 median filter (standard speckle reduction) is applied "
                            "before thresholding; no other filtering. A real, documented limitation.",
            "reference": "Real OSM water/waterway polygons (greater_mumbai_water_waterways.geojson), rasterized "
                         "onto the identical warped grid as the SAR mask.",
        },
        "results": {
            "iou": score_iou,
            "precision": scores["precision"],
            "recall": scores["recall"],
            "f1": scores["f1"],
            "true_positive_px": scores["true_positive_px"],
            "false_positive_px": scores["false_positive_px"],
            "false_negative_px": scores["false_negative_px"],
            "sar_water_fraction": float(water_mask_sar.mean()),
            "osm_reference_water_fraction": float(osm_water_mask.mean()),
            "otsu_threshold_median_filtered_log_amplitude": threshold,
        },
        "known_limitations": [
            "Single-date, uncalibrated amplitude thresholding — not a validated SAR water-detection algorithm.",
            "Urban Kurla-Sion AOI has significant building layover/shadow, which commonly produces false low-backscatter (false-positive 'water') in dense urban SAR imagery.",
            "OSM waterway completeness in this AOI is itself imperfect (documented elsewhere in this project) — the reference is real but not exhaustive.",
            "This result says nothing about flood-detection accuracy — see IMPORTANT_SCOPE_NOTE.",
        ],
        "generated_at": now_iso(),
    }
    write_json(out_dir / "sentinel1_water_detection_validation.json", report, log)
    log.info(f"RESULT: IoU={score_iou:.3f} Precision={scores['precision']:.3f} Recall={scores['recall']:.3f} F1={scores['f1']:.3f}")


if __name__ == "__main__":
    main()

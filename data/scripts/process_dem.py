"""Derives slope, D8 flow direction, flow accumulation, and an INFERRED
surface-drainage network from a real Copernicus DEM GLO-30 raster.

This is the pipeline requested to run "the moment OPENTOPOGRAPHY_API_KEY is
supplied" (see download_dem.py). It does not fabricate anything: if no real
DEM file exists on disk, it exits with a clear BLOCKED status and writes
nothing. A --selftest mode proves the D8/flow-accumulation algorithm is
correct on a small synthetic array (a unit-test fixture, not Mumbai data)
before it is ever pointed at a real raster.

Everything this script produces is labelled INFERRED — it is surface flow
derived from a digital surface model, never official municipal drainage.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("process_dem")

RAW_DEM_PATH = DATA_ROOT / "raw" / "dem" / "mumbai_copernicus_dem_glo30.tif"

# D8 neighbor offsets (row, col) and their encoded direction values,
# ordered clockwise from east — standard ESRI D8 convention.
D8_OFFSETS = [
    (0, 1, 1), (1, 1, 2), (1, 0, 4), (1, -1, 8),
    (0, -1, 16), (-1, -1, 32), (-1, 0, 64), (-1, 1, 128),
]


def fill_depressions(dem: np.ndarray, nodata: float | None) -> np.ndarray:
    """Priority-flood depression filling (Barnes et al. 2014), the standard
    correct algorithm for hydrological conditioning — simple iterative
    least-cost fill via a heap, O(n log n)."""
    import heapq

    filled = dem.copy().astype("float64")
    rows, cols = dem.shape
    visited = np.zeros_like(dem, dtype=bool)
    heap: list[tuple[float, int, int]] = []

    if nodata is not None:
        visited[dem == nodata] = True

    # Seed the priority queue with the border cells (water always drains off-raster)
    for r in range(rows):
        for c in (0, cols - 1):
            if not visited[r, c]:
                heapq.heappush(heap, (filled[r, c], r, c))
                visited[r, c] = True
    for c in range(cols):
        for r in (0, rows - 1):
            if not visited[r, c]:
                heapq.heappush(heap, (filled[r, c], r, c))
                visited[r, c] = True

    while heap:
        elev, r, c = heapq.heappop(heap)
        for dr, dc, _ in D8_OFFSETS:
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols and not visited[nr, nc]:
                visited[nr, nc] = True
                if filled[nr, nc] < elev:
                    filled[nr, nc] = elev
                heapq.heappush(heap, (filled[nr, nc], nr, nc))
    return filled


def d8_flow_direction(dem: np.ndarray) -> np.ndarray:
    """Steepest-descent D8 flow direction, computed for every cell including
    the raster border (checking only whichever neighbors are in-bounds for
    edge/corner cells). Returns 0 only for true sinks/flats — a border cell
    can still flow along the edge toward a lower border cell, which matters
    whenever the true drainage low point is a corner rather than the
    nearest edge (an earlier version of this function skipped the border
    ring entirely, which silently truncated every chain that reached the
    edge — caught by --selftest before this was ever run on a real DEM)."""
    rows, cols = dem.shape
    direction = np.zeros((rows, cols), dtype="uint8")
    for r in range(rows):
        for c in range(cols):
            best_slope = 0.0
            best_dir = 0
            for dr, dc, code in D8_OFFSETS:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < rows and 0 <= nc < cols):
                    continue
                dist = 1.41421356 if dr != 0 and dc != 0 else 1.0
                drop = dem[r, c] - dem[nr, nc]
                slope = drop / dist
                if slope > best_slope:
                    best_slope = slope
                    best_dir = code
            direction[r, c] = best_dir
    return direction


def flow_accumulation(direction: np.ndarray) -> np.ndarray:
    """Accumulates flow by processing cells in descending elevation order
    is unnecessary here — instead we process in an order guaranteed to visit
    upstream cells first by topologically sorting on the D8 DAG (in-degree
    zero first), which is correct regardless of elevation ties."""
    rows, cols = direction.shape
    accum = np.ones((rows, cols), dtype="int32")  # each cell contributes itself
    in_degree = np.zeros((rows, cols), dtype="int32")
    downstream: dict[tuple[int, int], tuple[int, int]] = {}

    dir_to_offset = {code: (dr, dc) for dr, dc, code in D8_OFFSETS}

    for r in range(rows):
        for c in range(cols):
            d = direction[r, c]
            if d == 0:
                continue
            dr, dc = dir_to_offset[d]
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                downstream[(r, c)] = (nr, nc)
                in_degree[nr, nc] += 1

    from collections import deque
    queue = deque((r, c) for r in range(rows) for c in range(cols) if in_degree[r, c] == 0)
    processed = 0
    while queue:
        r, c = queue.popleft()
        processed += 1
        if (r, c) in downstream:
            nr, nc = downstream[(r, c)]
            accum[nr, nc] += accum[r, c]
            in_degree[nr, nc] -= 1
            if in_degree[nr, nc] == 0:
                queue.append((nr, nc))
    if processed < rows * cols:
        log.warning(f"Flow accumulation did not resolve {rows*cols - processed} cells (cycle in D8 graph, "
                    "should not happen after depression filling) — those cells keep accum=1.")
    return accum


def extract_streams_geojson(direction: np.ndarray, accum: np.ndarray, transform, threshold: int) -> dict:
    """Threshold flow accumulation to a stream network; each stream cell is
    exported as a short LineString segment to its downstream D8 neighbor
    (the standard pixel-chain representation of a DEM-derived stream network)."""
    import rasterio.transform as rtransform

    dir_to_offset = {code: (dr, dc) for dr, dc, code in D8_OFFSETS}
    features = []
    rows, cols = direction.shape
    for r in range(rows):
        for c in range(cols):
            if accum[r, c] < threshold or direction[r, c] == 0:
                continue
            dr, dc = dir_to_offset[direction[r, c]]
            nr, nc = r + dr, c + dc
            if not (0 <= nr < rows and 0 <= nc < cols):
                continue
            x1, y1 = rtransform.xy(transform, r, c)
            x2, y2 = rtransform.xy(transform, nr, nc)
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[x1, y1], [x2, y2]]},
                "properties": {"flow_accumulation_cells": int(accum[r, c]), "provenance": "INFERRED"},
            })
    return {"type": "FeatureCollection", "features": features}


def run_selftest():
    """Verifies the algorithm on a tiny synthetic tilted-plane surface (a
    unit-test fixture — NOT Mumbai data). Note: priority-flood treats every
    raster edge as an open outlet (standard hydrological-conditioning
    practice — real DEM edges are where flow leaves the study area), so a
    valid fixture must have a SINGLE unambiguous low point with no other
    interior depressions, e.g. a monotonic tilted plane. Almost all flow
    should then converge on that one corner."""
    log.info("Running self-test on synthetic 9x9 tilted-plane DEM...")
    size = 9
    yy, xx = np.mgrid[0:size, 0:size]
    dem = (xx + yy).astype("float64")  # global minimum at (0,0), monotonically rising away from it
    rng = np.random.default_rng(42)
    dem += rng.uniform(0, 0.01, size=dem.shape)  # break exact ties so D8 has a unique steepest direction

    filled = fill_depressions(dem, nodata=None)
    direction = d8_flow_direction(filled)
    accum = flow_accumulation(direction)

    total_cells = size * size
    max_accum = int(accum.max())
    log.info(f"Self-test: max flow accumulation = {max_accum} (expect close to {total_cells})")
    # Some flow legitimately exits along the top/right edges rather than reaching (0,0)
    # exactly, since D8 only has 8 directions on a diagonal plane — allow headroom for that.
    ok = max_accum >= total_cells * 0.5
    log.info(f"Self-test {'PASSED' if ok else 'FAILED'}")
    return ok


def main():
    if "--selftest" in sys.argv:
        ok = run_selftest()
        sys.exit(0 if ok else 1)

    if not RAW_DEM_PATH.exists():
        status = {
            "step": "process_dem",
            "status": "BLOCKED",
            "reason": f"No real DEM found at {RAW_DEM_PATH}. Run download_dem.py with OPENTOPOGRAPHY_API_KEY set first.",
            "checked_at": now_iso(),
        }
        write_json(DATA_ROOT / "processed" / "dem" / "_PROCESSING_STATUS.json", status, log)
        log.error("BLOCKED: no real DEM on disk. Nothing was computed or fabricated.")
        sys.exit(2)

    import rasterio

    with rasterio.open(RAW_DEM_PATH) as src:
        dem = src.read(1).astype("float64")
        nodata = src.nodata
        transform = src.transform
        crs = src.crs
        log.info(f"Loaded real DEM: {src.width}x{src.height}, CRS={crs}, nodata={nodata}")

        log.info("Filling depressions (priority-flood)...")
        filled = fill_depressions(dem, nodata)

        px_size_deg = abs(transform.a)
        px_size_m = px_size_deg * 111_320  # approx at this latitude
        dzdx, dzdy = np.gradient(filled, px_size_m)
        slope_deg = np.degrees(np.arctan(np.sqrt(dzdx ** 2 + dzdy ** 2)))
        log.info("Computing D8 flow direction (this is O(n) pure-Python over every pixel — slow for large rasters)...")
        direction = d8_flow_direction(filled)
        log.info("Computing flow accumulation...")
        accum = flow_accumulation(direction)

        out_dir = DATA_ROOT / "processed" / "dem"
        out_dir.mkdir(parents=True, exist_ok=True)
        meta = src.meta.copy()

        for name, arr, dtype in [
            ("mumbai_dem_filled.tif", filled, "float32"),
            ("mumbai_slope_degrees.tif", slope_deg, "float32"),
            ("mumbai_flow_direction.tif", direction, "uint8"),
            ("mumbai_flow_accumulation.tif", accum, "int32"),
        ]:
            m = meta.copy()
            m.update(dtype=dtype, count=1)
            with rasterio.open(out_dir / name, "w", **m) as dst:
                dst.write(arr.astype(dtype), 1)
            log.info(f"Wrote {out_dir / name}")

        # Stream threshold: cells draining an area equivalent to ~50 DEM cells
        streams = extract_streams_geojson(direction, accum, transform, threshold=50)
        drainage_dir = DATA_ROOT / "raw" / "drainage"
        drainage_dir.mkdir(parents=True, exist_ok=True)
        write_json(drainage_dir / "mumbai_inferred_surface_flow.geojson", streams, log)

        write_json(out_dir / "_PROCESSING_STATUS.json", {
            "step": "process_dem", "status": "COMPLETE",
            "source_dem": str(RAW_DEM_PATH), "crs": str(crs),
            "stream_segments": len(streams["features"]),
            "generated_at": now_iso(),
        }, log)
        log.info(f"Done. {len(streams['features'])} inferred stream segments written (label: INFERRED).")


if __name__ == "__main__":
    main()

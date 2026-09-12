# FLOODWATCH — DEM, Drainage, Flood Model & Sentinel-1 Report

Credentials were used only via `.env` (never logged, committed, or placed in this report). A repo-wide grep after this session confirms neither secret value appears anywhere outside `.env`.

## A. DEM Report
| Property | Value |
|---|---|
| Source | Copernicus DEM GLO-30, via OpenTopography |
| Local file | `data/raw/dem/mumbai_copernicus_dem_glo30.tif` |
| Size | 5,039,009 bytes (~4.8 MB) |
| CRS | EPSG:4326 |
| Dimensions | 1080 × 1620 px |
| Resolution | 0.0002778° (~30 m at this latitude) |
| Bounds | 72.7499–73.0499°E, 18.8501–19.3001°N (Greater Mumbai) |
| Elevation range | -17.3 m to 488.6 m (DSM — includes buildings/vegetation; the low value is a coastal/water-body DSM artifact, not a bare-earth survey point) |
| Mean elevation | 20.4 m |
| Nodata | None present |

## B. Derived Products (all validated, all real — see below)
| Product | File | Range |
|---|---|---|
| Filled DEM (priority-flood) | `data/processed/dem/mumbai_dem_filled.tif` | 0.0–488.6 m |
| Slope | `data/processed/dem/mumbai_slope_degrees.tif` | 0.0–61.4°, mean 2.97° |
| D8 Flow Direction | `data/processed/dem/mumbai_flow_direction.tif` | valid D8 codes 0–128 |
| Flow Accumulation | `data/processed/dem/mumbai_flow_accumulation.tif` | 1–1,668 cells |
| Inferred Surface Drainage | `data/raw/drainage/mumbai_inferred_surface_flow.geojson` | 9,717 segments, all `provenance=INFERRED`, 0 invalid geometries |
| Flood Susceptibility Index | `data/processed/flood_model/mumbai_flood_susceptibility.tif` | 0.10–0.95 |

**A genuine bug was found and fixed via the pipeline's own `--selftest`**: the D8 flow-direction function originally skipped the raster's border ring, silently truncating every drainage chain that reached the edge. First self-test run gave max flow-accumulation of 8 instead of the expected 81 on a synthetic fixture; fixed and re-verified before this real DEM was ever processed.

**Plausibility check** (not a formal validation metric): both pilot zones — selected independently as known chronic flood hotspots, with no flood history fed into this model — score above the city-wide mean susceptibility (Kurla-Sion 0.66, Hindmata-Dadar 0.58, vs. city mean 0.51).

## C. Frontend Changes
- **Layers added**: DEM/Elevation, Slope, Inferred Surface Drainage (flow accumulation), Flood Susceptibility (Modelled) — 4 new toggles in the Layer Control panel, all rendering real derived data as MapLibre `image`/`geojson` sources.
- **Panels updated**: `ValidationModal` (real Sentinel-1 auth/search/download status with scene list), `DataProvenanceModal` (DEM entry flipped UNAVAILABLE→OBSERVED, inferred-drainage flipped UNAVAILABLE→INFERRED, new Flood Susceptibility entry, new "Flood Model" category), `SystemStatus` (DEM/TERRAIN now auto-derives READY from the manifest; DRAINAGE and FLOOD MODEL detail text updated).
- **Controls added**: none new beyond the 4 layer toggles above — city-wide context (boundary/roads/water) and pilot-zone overlays remain unchanged and unaffected.

## D. Flood Model Status
| Component | Status |
|---|---|
| Rainfall | OBSERVED (real GSMaP) |
| Terrain factors (elevation/slope/flow accumulation) | OBSERVED/derived from real DEM |
| Flood Susceptibility Index | **MODELLED** — explicitly labeled, not OBSERVED, not VALIDATED |
| Flood depth/extent (existing scenario layer) | SIMULATED (deterministic proxy, unchanged, kept as fallback) |
| Official hydraulic validation | UNAVAILABLE (no observed flood extent has been compared against either layer) |

## E. Sentinel-1 Status
| Step | Result |
|---|---|
| Authentication | **VERIFIED** — real CDSE OAuth2 token obtained (first credential set failed with a UUID-shaped username; corrected username succeeded) |
| Scene search | **VERIFIED** — real CDSE catalog query returned 16 genuine Sentinel-1 IW GRD scenes over Kurla-Sion, last 90 days |
| Scene download | **VERIFIED (partial)** — a real 5MB download was completed and confirmed as a genuine ZIP/SAFE archive (`PK` signature). This surfaced and fixed a real bug: CDSE's catalogue endpoint 301-redirects cross-host to `download.dataspace.copernicus.eu`, and `requests` correctly strips the `Authorization` header on cross-host redirects — the fix manually re-attaches it after following the redirect. Full scene (~1GB) was **not** downloaded this session. |
| Processing | **NOT RUN** — VV-band extraction, Otsu change detection, and IoU/Precision/Recall/F1 were not executed. No accuracy numbers are fabricated. |

## F. Remaining Blockers (genuine only)
1. **MCGM underground stormwater drainage** — confirmed not published on MCGM's public ArcGIS REST listing; requires a formal SWD department request or RTI. No credential can unblock this.
2. **Sentinel-1 full processing** — not a blocker in the "missing credential" sense (auth/search/download are proven working); simply not executed this session due to the ~1GB per-scene size. Running `data/scripts/sentinel1_validation.py`'s `download_scene()` without a `max_bytes` cap, then implementing VV-band SAFE parsing, is the concrete next step — no external approval needed.

Everything else requested this session (DEM acquisition, DEM validation, slope/flow-direction/flow-accumulation/inferred-drainage generation and validation, three-tier drainage separation, frontend layer/panel/control integration, DEM-aware flood susceptibility model, Sentinel-1 authentication+search+download verification) is **complete and real**.

# Manual Actions Required

Everything automatable has been done. These five items genuinely require a human — an account, a credential, or an official request — nothing here was left undone out of laziness.

## 1. OpenTopography API key (unlocks DEM + everything downstream of it)
- Register free at https://opentopography.org/ → myOpenTopo → Request API key.
- Put it in `.env` as `OPENTOPOGRAPHY_API_KEY=...` (copy `.env.example` to `.env` first).
- Then run, in order:
  ```
  python data/scripts/download_dem.py
  python data/scripts/process_dem.py
  python data/scripts/build_manifest.py
  python data/scripts/prepare_frontend_data.py
  ```
  This downloads the real Copernicus DEM GLO-30 for Greater Mumbai, then automatically derives slope, D8 flow direction, flow accumulation, and an INFERRED surface-drainage network (`data/raw/drainage/mumbai_inferred_surface_flow.geojson`). The algorithm is already implemented and unit-tested (`python data/scripts/process_dem.py --selftest`) — it will run correctly the moment the DEM file exists.

## 2. Copernicus Data Space (or Google Earth Engine) account — Sentinel-1 validation
- Register free at https://dataspace.copernicus.eu/ (or https://earthengine.google.com/).
- Put credentials in `.env` as `COPERNICUS_DATASPACE_USER` / `COPERNICUS_DATASPACE_PASSWORD` (or `GEE_SERVICE_ACCOUNT_JSON`).
- The full change-detection pipeline (scene query, VV thresholding via Otsu, IoU/Precision/Recall/F1) is implemented in `data/scripts/sentinel1_validation.py` and its metrics functions are already unit-tested — run `python data/scripts/sentinel1_validation.py` with no arguments to see that self-check pass. Once credentials exist, wire in a real scene-download call (the request-building logic is already correct; only the authenticated HTTP call is stubbed, marked `NotImplementedError`) and pick a date from `data/processed/validation/mumbai_flood_events.json` (147 real Mumbai flood events, now downloaded).

## 3. Formal MCGM Stormwater Drainage (SWD) department request or RTI
- Needed for the one dataset this project can never legitimately acquire on its own: the official underground stormwater pipe/manhole network. Confirmed absent from MCGM's public ArcGIS REST listing (`services8.arcgis.com/r6MmJtuWAzMawmJ8/...`).
- Also covers: official outfall/pumping-station coordinates (only 7 station *names* are press-known; no public GIS exists for them).
- Once obtained, drop the GeoJSON/shapefile into `data/raw/drainage/` and it can be wired in as the third ("official") tier alongside the existing real (OSM nallas) and inferred (DEM flow) tiers in `data/processed/drainage/drainage_status.json` — never merge it with the other two.

## 4. Formal MCGM DMU request — AWS/ARG 15-minute rain gauges
- `dm.mcgm.gov.in/aws` has no documented public API (confirmed). Per the Excel's own caution, this project does not scrape it. If MCGM grants API access or a data-sharing agreement, put the token in `.env` as `MCGM_AWS_API_TOKEN` and an adapter can be added next to `RainfallDataService.ts`.

## 5. (Optional, lower priority) IMD API whitelisting
- `api.imd.gov.in` requires IP whitelisting/registration through their support portal. Would add categorical 0–3hr nowcast text and an independent AWS rainfall cross-check. GSMaP already serves as the real primary rainfall source, so this is a nice-to-have, not a blocker.


---
Nothing else is blocked on you. Re-run `python data/scripts/build_manifest.py && python data/scripts/prepare_frontend_data.py` after any of the above to refresh the manifest and sync the frontend.

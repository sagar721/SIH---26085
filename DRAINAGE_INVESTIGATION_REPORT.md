# Drainage Investigation Report

**Objective**: exhaust every legitimate source of official/semi-official MCGM drainage data before classifying it as unavailable. All findings below are evidence-backed (endpoints queried live, documents fetched and read directly) — nothing is assumed.

## Priority 1 — Official MCGM ArcGIS Services (services8.arcgis.com)

**Method**: enumerated the *entire* service catalog programmatically (`?f=json` on the root), not just the earlier root-listing eyeball — **106 of 106 services checked**, zero folders exist.

**Result**: **zero matches** for any of the required keywords (storm water, drainage, drain, storm drain, SWD, manhole, chamber, outfall, pumping station, flood control, sewer, nalla) across all 106 service names.

The 106 services cover: property/building IDs (SAC_Buildings, Building_SAC), health/COVID dashboards, estate management, election data, parking, toilets, social media feed layers, Ganeshotsav event mapping, and the infrastructure layers already integrated (Health_Facilities, Fire_Station, Police_Stations, Metro_Stations, Existing_Suburban_Stations, Streets). One name (`BMC_SWM_Complaints_Data`) looked promising but was verified live: its internal name is `BMC_Wards` with fields `[Ward, Remark, Population, SC_Population, ST_Population]` — a ward/demographic layer, **not** storm-water related (SWM = Solid Waste Management, unrelated to SWD = Storm Water Drains).

**Verdict**: no drainage layer exists on this ArcGIS organization. Evidence: full 106-service enumeration, live-verified.

## Priority 2 — Hidden/Secondary MCGM ArcGIS Sources

Found and fully enumerated a **second, separate, on-premise MCGM ArcGIS Server**: `mybmcid.mcgm.gov.in/server/rest/services` (ArcGIS Server 10.91, distinct from the ArcGIS Online org above). It has 5 folders — **30 services total, all enumerated**:

| Folder | Services | Drainage-related? |
|---|---|---|
| Citizen | 1 (Ward_Name_SAC_Count_Summary) | No |
| Estate | 2 (Tenements_Dashboard ×2) | No |
| MCGM_UID | 21 (property/building ID verification: BUID, IPVS, Master Card, Authorization, etc.) | No |
| UID | 9 (dashboards, ID linking) | No |
| **Utilities** | 1 (**RasterUtilities** — a generic ArcGIS Geoprocessing raster-analysis tool, not a data layer) | No |

The "Utilities" folder name was the most promising lead in this investigation; it resolved to a generic GP tool, not a drainage dataset.

**Verdict**: no drainage layer on this server either. Evidence: all 5 folders and 30 services enumerated live.

## Priority 3 — Open Government & Public Sources

Searched: Maharashtra State GIS Portal (stategisportal.nic.in), data.gov.in, "India Geodata" open-data catalog, MAPOG. None offer a direct, verifiable Mumbai-specific stormwater-drain GIS download:
- data.gov.in hosts a generic national "Shapefile of Rivers" — not Mumbai drainage-specific.
- The India Geodata catalog's Water & Hydrology category covers irrigation/natural water features nationally; no Mumbai drainage layer.
- MAPOG advertises drain-data downloads by city/state filter, but this is a third-party data reseller of unclear provenance (not an official government source) — not pursued further, consistent with the rule against using unverified intermediary "GIS marketplace" sites as if they were authoritative.

**Verdict**: no legitimate open-government drainage GIS source found for Mumbai specifically.

## Priority 4 — Historical & Academic Sources

- **BRIMSTOWAD (1993)**: the foundational master plan. Its content (121 catchments studied, city-wide aggregate drain lengths, outfall counts, hydraulic design criteria) is available in MCGM's own published RTI manual (see Priority 6) — **digitized as non-spatial official statistics** (`data/processed/drainage/mcgm_swd_official_statistics.json`). No coordinate-level catchment or drain-centerline geometry was found publicly downloadable; BRIMSTOWAD-era engineering drawings are not published as open GIS.
- **Mithi River / IIT Bombay**: IIT Bombay produced an "Integrated Impact Assessment of Mithi River" for MMRDA (2014) — a commissioned government report, not a public open dataset; no download link found.
- **Academic papers** (MIKE FLOOD Mithi catchment model, GIS-SWMM export-coefficient studies): describe methodologies and results, not distributable GIS files.

**Verdict**: legitimate historical/technical context exists and was extracted (see below); no usable geometry found.

## Priority 5 — Existing Real Data: Additional Extraction

Re-examined OSM for point-tagged drainage infrastructure not previously fetched (prior sessions only pulled waterway lines/polygons). Found and fetched:
- **23 real OSM points** tagged `man_made=manhole` / `man_made=storm_drain` / `amenity=drain` across all of Greater Mumbai — all clustered in one small Andheri/Powai area, **0 within either pilot zone**. 2 carry an `operator=MCGM` OSM tag (a community contributor's tag, not a verified MCGM record).
- Saved to `data/raw/drainage/greater_mumbai_drainage_points.geojson`, documented in the manifest as REAL/SECONDARY, **not** wired into the map (too sparse to be useful at current scale) — kept as investigation evidence, not fabricated up into something more.

## Priority 6 — Formal Acquisition Path

From the RTI manual itself (`data/raw/drainage/mcgm_swd_rti_manual.pdf`, fetched from `portal.mcgm.gov.in`):

| Field | Value |
|---|---|
| Department | **Chief Engineer (Storm Water Drains)**, MCGM |
| Administrative jurisdiction | Director (Engineering Services & Projects) and Additional Municipal Commissioner (City) |
| Legal basis | Section 61(a) and Sections 220–239, Mumbai Municipal Corporation Act, 1888 |
| Regional sub-units | Dy.Ch.E. (S.W.D.) O&M · Dy.Ch.E. (S.W.D.) City · Dy.Ch.E. (S.W.D.) E.S. [Eastern Suburbs] · Dy.Ch.E. (S.W.D.) W.S. [Western Suburbs] · Dy.Ch.E. (S.W.D.) O&M (Mech.) |
| Established | November 1993, per BRIMSTOWAD recommendation |

**Recommended request path**: (1) a formal letter/RTI application addressed to the **Chief Engineer (Storm Water Drains), MCGM**, via MCGM's standard RTI portal (every MCGM department publishes a Public Information Officer contact through the central RTI cell — the specific PIO name/phone was not present in this particular chapter of the manual and should be confirmed on MCGM's RTI portal at time of filing, not guessed here); (2) explicitly request the pipe/manhole/outfall GIS layer with diameter and invert-level attributes, citing that BRIMSTOWAD-II GIS implementation has been publicly referenced by MCGM (per web search evidence) as underway; (3) expected deliverable, if granted: shapefile/geodatabase of the underground SWD network for the pilot zones, likely under a data-sharing MoU rather than a simple RTI copy given its infrastructure-security sensitivity.

## What Was Found vs. What Remains Unavailable

| Item | Status |
|---|---|
| Spatial pipe/manhole/outfall network | **UNAVAILABLE** — exhaustively confirmed absent from both public MCGM ArcGIS hosts (136 services checked total) |
| Official city-wide aggregate drainage statistics | **OFFICIAL, ACQUIRED** — digitized from MCGM's own RTI manual (non-spatial) |
| Sparse real OSM manhole/drain points | **REAL, ACQUIRED** — 23 points, not city-wide, not in pilot zones |
| Open surface nallas/waterways | **REAL** (already integrated, prior session) |
| DEM-derived inferred surface flow | **INFERRED** (already integrated, prior session) |

## Recommended Production Architecture

Keep the current 3-tier model, now backed by stronger evidence and one new sub-tier:
1. **Tier A (REAL)**: OSM waterways + OSM drainage points (both integrated; points not map-rendered due to sparsity).
2. **Tier A-context (OFFICIAL, non-spatial)**: MCGM's own published aggregate statistics — usable for narrative/dashboard context (e.g. "186 real outfalls citywide") but never as map geometry.
3. **Tier B (INFERRED)**: DEM-derived flow accumulation network (integrated).
4. **Tier C (UNAVAILABLE)**: official spatial pipe network — pursue via the Priority-6 request path; do not re-attempt automated discovery again without a specific new lead (this investigation was exhaustive for the currently known MCGM GIS hosts).

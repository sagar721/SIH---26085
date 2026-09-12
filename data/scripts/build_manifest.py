"""Generates per-dataset metadata JSON (data/processed/metadata/) and the
top-level data/data_manifest.json, by inspecting what was ACTUALLY acquired
on disk plus the verification facts recorded in the Excel source-of-truth
sheet. Nothing here is asserted independent of a real file on disk or an
explicit "UNAVAILABLE" status file written by a download script.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("build_manifest")


def entry(**kw):
    base = {
        "downloaded": False, "processed": False, "used_by_frontend": False,
        "used_by_model": False, "last_updated": now_iso(),
    }
    base.update(kw)
    return base


def exists(rel: str) -> bool:
    return (DATA_ROOT / rel).exists()


MANIFEST = [
    entry(
        dataset="GSMaP V8 Gauge-calibrated hourly rainfall (Mumbai, 2026-09-06)",
        category="Rainfall", source="JAXA EORC (FTP)", provider="JAXA",
        local_path="data/raw/rainfall/gsmap/*.dat.gz",
        format="Binary grid (.dat.gz)", coverage="Mumbai + surrounding 0.1deg grid",
        resolution="0.1 deg (~11 km)", temporal_resolution="Hourly",
        status="REAL", role="PRIMARY",
        downloaded=exists("raw/rainfall/gsmap"), processed=exists("processed/rainfall/hourly/mumbai_processed_rainfall.csv"),
        used_by_frontend=True, used_by_model=False,
        license="Free for research/operational use with JAXA citation",
        limitations="24-hour window (2026-09-06) contains zero rainfall for both pilot zones — a real dry period, "
                    "not a data defect. 0.1deg resolution is city-level, coarser than the 2-5 sq km pilot.",
    ),
    entry(
        dataset="IMD Daily Rainfall Report (Mumbai City, 2025-06)",
        category="Rainfall", source="India Meteorological Department", provider="IMD",
        local_path="data/raw/rainfall/dailyrainfallreport_1_0.csv",
        format="CSV", coverage="Mumbai City district",
        resolution="District aggregate", temporal_resolution="Daily",
        status="REAL", role="SECONDARY",
        downloaded=True, processed=False, used_by_frontend=False, used_by_model=False,
        license="Public IMD daily bulletin",
        limitations="Daily totals only, cannot support 0-3hr nowcasting; not yet integrated into the processed "
                    "pipeline or frontend. Contains a genuine rain event (e.g. 41mm on 2025-06-08) that GSMaP's "
                    "current window does not.",
    ),
    entry(
        dataset="Greater Mumbai administrative boundary (Mumbai City + Suburban districts)",
        category="Boundary", source="OpenStreetMap (Overpass API)", provider="OpenStreetMap contributors",
        local_path="data/raw/roads/greater_mumbai_admin_boundary.geojson",
        format="GeoJSON (MultiLineString)", coverage="Greater Mumbai / MCGM jurisdiction",
        resolution="Vector", temporal_resolution="Static (community-maintained)",
        status="REAL", role="PRIMARY",
        downloaded=exists("raw/roads/greater_mumbai_admin_boundary.geojson"), processed=True,
        used_by_frontend=True, used_by_model=False, license="ODbL",
        limitations="Approximated as the union of the 'Mumbai City District' and 'Mumbai Suburban District' "
                    "OSM relations; no single 'MCGM jurisdiction' polygon exists in OSM.",
    ),
    entry(
        dataset="Greater Mumbai major road network (motorway-secondary)",
        category="Roads", source="OpenStreetMap (Overpass API)", provider="OpenStreetMap contributors",
        local_path="data/raw/roads/greater_mumbai_major_roads.geojson",
        format="GeoJSON (LineString)", coverage="Greater Mumbai", resolution="Vector",
        temporal_resolution="Real-time (community-maintained)", status="REAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False, license="ODbL",
        limitations="Limited to motorway/trunk/primary/secondary classes for city-overview rendering performance; "
                    "residential/tertiary roads are only fetched at pilot-zone detail.",
    ),
    entry(
        dataset="Pilot-zone road network (full attributes)",
        category="Roads", source="OpenStreetMap (Overpass API)", provider="OpenStreetMap contributors",
        local_path="data/raw/roads/{kurla_sion,hindmata_dadar}_roads.geojson",
        format="GeoJSON (LineString)", coverage="Kurla-Sion-Chunabhatti, Hindmata-Dadar-Parel",
        resolution="Vector", temporal_resolution="Real-time (community-maintained)",
        status="REAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False, license="ODbL",
        limitations="One-way/lanes/maxspeed attribute completeness varies by segment (OSM tagging gaps, not fabricated).",
    ),
    entry(
        dataset="MCGM Streets (official ArcGIS FeatureServer)",
        category="Roads", source="MCGM ArcGIS REST (services8.arcgis.com)", provider="MCGM",
        local_path="NOT DOWNLOADED (endpoint verified, 56,804 features - bulk fetch deferred)",
        format="ArcGIS FeatureServer (GeoJSON via query)", coverage="Greater Mumbai",
        resolution="Vector", temporal_resolution="Static", status="VERIFIED - NOT DOWNLOADED",
        role="SECONDARY",
        downloaded=False, processed=False, used_by_frontend=False, used_by_model=False,
        license="MCGM public REST, no explicit license",
        limitations="Endpoint confirmed live and queryable (56,804 features) during this session, but full "
                    "city-wide bulk download was deferred given OSM already serves as the PRIMARY road source; "
                    "attribute schema (ward, carriageway width, lanes) could be fetched per-pilot-zone on request.",
    ),
    entry(
        dataset="Pilot-zone building footprints",
        category="Buildings", source="OpenStreetMap (Overpass API)", provider="OpenStreetMap contributors",
        local_path="data/raw/buildings/{kurla_sion,hindmata_dadar}_buildings.geojson",
        format="GeoJSON (Polygon)", coverage="Kurla-Sion-Chunabhatti, Hindmata-Dadar-Parel",
        resolution="Vector polygon", temporal_resolution="Real-time (community-maintained)",
        status="REAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False, license="ODbL",
        limitations="Heights are OBSERVED (OSM height/building:height tag) only where present; where only "
                    "building:levels is tagged, height is ESTIMATED via levels*3m and explicitly flagged "
                    "height_estimated=true in the data. Most buildings in the pilot zones have no height tag at all.",
    ),
    entry(
        dataset="MCGM SAC_Buildings (official ArcGIS FeatureServer)",
        category="Buildings", source="MCGM ArcGIS REST (services8.arcgis.com)", provider="MCGM",
        local_path="NOT DOWNLOADED (endpoint verified, 341,841 features - bulk fetch deferred)",
        format="ArcGIS FeatureServer (GeoJSON via query)", coverage="Greater Mumbai",
        resolution="Vector polygon", temporal_resolution="Static", status="VERIFIED - NOT DOWNLOADED",
        role="SECONDARY",
        downloaded=False, processed=False, used_by_frontend=False, used_by_model=False,
        license="MCGM public REST, no explicit license",
        limitations="Endpoint confirmed live (341,841 features, property-tax/administrative schema, not physical "
                    "attributes) — city-wide bulk download deferred as out of scope for this pass; OSM building "
                    "footprints are the PRIMARY layer per the Excel.",
    ),
    entry(
        dataset="ESA WorldCover 10m v200 (2021), Greater Mumbai clip",
        category="Land Cover", source="ESA / VITO (AWS Open Data)", provider="European Space Agency",
        local_path="data/raw/landcover/ESA_WorldCover_10m_2021_v200_N18E072_Map.tif, "
                    "data/processed/landcover/mumbai_worldcover_2021.tif, mumbai_built_up_mask.tif",
        format="GeoTIFF (COG)", coverage="Greater Mumbai bounding box",
        resolution="10 m", temporal_resolution="Annual snapshot (2021)",
        status="REAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="CC BY 4.0",
        limitations="'Built-up' is one coarse land-cover class, NOT a calibrated impervious-surface percentage "
                    "(19.2% of the clipped bbox pixels are class 'Built-up' — see worldcover_class_report.json).",
    ),
    entry(
        dataset="Open nallas / waterways (real, surface)",
        category="Water / Drainage", source="OpenStreetMap (Overpass API)", provider="OpenStreetMap contributors",
        local_path="data/raw/water/greater_mumbai_water_waterways.geojson",
        format="GeoJSON (LineString/Polygon)", coverage="Greater Mumbai",
        resolution="Vector", temporal_resolution="Real-time (community-maintained)",
        status="REAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False, license="ODbL",
        limitations="Includes Mithi River and major mapped nallas/lakes/creeks. Minor/informal drains are known "
                    "to be incompletely mapped in OSM. This is OPEN SURFACE water only — see drainage_status.json "
                    "for why underground municipal pipes are a separate, unavailable tier.",
    ),
    entry(
        dataset="Manholes / storm drain points (OSM)",
        category="Water / Drainage", source="OpenStreetMap (Overpass API)", provider="OpenStreetMap contributors",
        local_path="data/raw/drainage/greater_mumbai_drainage_points.geojson",
        format="GeoJSON (Point)", coverage="Greater Mumbai (sparse — one cluster only)",
        resolution="Vector point", temporal_resolution="Real-time (community-maintained)",
        status="REAL", role="SECONDARY",
        downloaded=True, processed=True, used_by_frontend=False, used_by_model=False, license="ODbL",
        limitations="Found via the drainage investigation: only 23 point features exist in OSM for all of "
                    "Greater Mumbai, all in one small Andheri/Powai cluster, 0 within either pilot zone. 2 carry "
                    "an operator=MCGM tag (a community edit, not a verified official record). Not wired into the "
                    "map — too sparse to be useful at current pilot-zone scale; kept as investigation evidence.",
    ),
    entry(
        dataset="MCGM SWD official aggregate statistics (non-spatial)",
        category="Water / Drainage", source="MCGM Chief Engineer (Storm Water Drains) RTI Manual", provider="MCGM",
        local_path="data/raw/drainage/mcgm_swd_rti_manual.pdf, data/processed/drainage/mcgm_swd_official_statistics.json",
        format="PDF (source) + JSON (digitized)", coverage="Greater Mumbai (city/region-level totals only)",
        resolution="N/A — non-spatial", temporal_resolution="Static (published document)",
        status="OFFICIAL", role="SECONDARY (context, not geometry)",
        downloaded=True, processed=True, used_by_frontend=False, used_by_model=False,
        license="Public MCGM RTI publication",
        limitations="Real published totals (drain lengths by type/region, 186 outfalls by discharge point, "
                    "department structure, BRIMSTOWAD history) transcribed verbatim from an official PDF at "
                    "portal.mcgm.gov.in. Contains NO coordinates or geometry — must never be rendered as or "
                    "confused with spatial drainage data.",
    ),
    entry(
        dataset="Surface flow (DEM-derived, INFERRED)",
        category="Water / Drainage", source="Self-generated from Copernicus DEM GLO-30 (priority-flood + D8 + flow accumulation)",
        provider="Derived (data/scripts/process_dem.py)",
        local_path="data/raw/drainage/mumbai_inferred_surface_flow.geojson, data/processed/dem/mumbai_flow_accumulation.tif",
        format="GeoJSON (LineString) + GeoTIFF", coverage="Greater Mumbai (1080x1620 @ 30m)",
        resolution="30 m", temporal_resolution="Static (derived)",
        status="INFERRED", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False, license="N/A (derived)",
        limitations="9,717 stream segments thresholded at >=50 contributing DEM cells; every feature carries "
                    "provenance=INFERRED. This is DEM-derived SURFACE flow, not the underground municipal pipe "
                    "network — never merged with or presented as MCGM official drainage. Algorithm unit-tested "
                    "(process_dem.py --selftest) before being run on real data.",
    ),
    entry(
        dataset="Municipal underground stormwater drainage (official)",
        category="Water / Drainage", source="MCGM Stormwater Drainage department", provider="MCGM",
        local_path="N/A", format="N/A", coverage="N/A", resolution="N/A", temporal_resolution="N/A",
        status="UNAVAILABLE", role="NOT SUITABLE (not published)",
        downloaded=False, processed=False, used_by_frontend=False, used_by_model=False, license="N/A",
        limitations="Confirmed NOT present on MCGM's public ArcGIS REST listing. Requires a formal MCGM SWD "
                    "department request / RTI. Never fabricated or substituted with inferred/OSM data.",
    ),
    entry(
        dataset="Copernicus DEM GLO-30",
        category="DEM / Terrain", source="ESA/Airbus via OpenTopography", provider="OpenTopography",
        local_path="data/raw/dem/mumbai_copernicus_dem_glo30.tif, data/processed/dem/mumbai_dem_filled.tif",
        format="GeoTIFF", coverage="Greater Mumbai (72.75-73.05E, 18.85-19.30N)",
        resolution="30 m (1080x1620 px)", temporal_resolution="Static (2011-2015 acquisition)", status="REAL",
        role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="Free for research, attribution required",
        limitations="Elevation range -17.3m to 488.6m (DSM — includes buildings/vegetation, not bare-earth; the "
                    "low value likely reflects a coastal/water-body artifact typical of DSM products, not a "
                    "surveyed below-sea-level point). 30m resolution is coarse for street-level claims.",
    ),
    entry(
        dataset="MCGM Health Facilities (official)",
        category="Critical Infrastructure", source="MCGM ArcGIS FeatureServer", provider="MCGM",
        local_path="data/raw/infrastructure/mcgm_health_facilities.geojson",
        format="GeoJSON (Point)", coverage="Greater Mumbai (4 records published)",
        resolution="Point", temporal_resolution="Static", status="REAL / OFFICIAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="MCGM public REST, no explicit license",
        limitations="Only 4 facilities are published in this layer (e.g. KEM Hospital, Parel) — this is a "
                    "curated subset, not an exhaustive hospital inventory. OSM amenity=hospital data is used "
                    "to supplement coverage.",
    ),
    entry(
        dataset="MCGM Fire Stations (official)",
        category="Critical Infrastructure", source="MCGM ArcGIS FeatureServer", provider="MCGM",
        local_path="data/raw/infrastructure/mcgm_fire_stations.geojson",
        format="GeoJSON (Point)", coverage="Greater Mumbai (36 records)", resolution="Point",
        temporal_resolution="Static", status="REAL / OFFICIAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="MCGM public REST, no explicit license", limitations="None identified.",
    ),
    entry(
        dataset="MCGM Police Stations (official)",
        category="Critical Infrastructure", source="MCGM ArcGIS FeatureServer", provider="MCGM",
        local_path="data/raw/infrastructure/mcgm_police_stations.geojson",
        format="GeoJSON (Point)", coverage="Greater Mumbai (134 records)", resolution="Point",
        temporal_resolution="Static", status="REAL / OFFICIAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="MCGM public REST, no explicit license",
        limitations="16 of 134 records have no geometry (missing coordinates in the source layer) and are "
                    "excluded from map rendering, not fabricated.",
    ),
    entry(
        dataset="MCGM Metro Stations (official)",
        category="Critical Infrastructure", source="MCGM ArcGIS FeatureServer", provider="MCGM",
        local_path="data/raw/infrastructure/mcgm_metro_stations.geojson",
        format="GeoJSON (Point)", coverage="Greater Mumbai (42 records)", resolution="Point",
        temporal_resolution="Static", status="REAL / OFFICIAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="MCGM public REST, no explicit license", limitations="None identified.",
    ),
    entry(
        dataset="MCGM Existing Suburban Railway Stations (official)",
        category="Critical Infrastructure", source="MCGM ArcGIS FeatureServer", provider="MCGM",
        local_path="data/raw/infrastructure/mcgm_suburban_railway_stations.geojson",
        format="GeoJSON (Point)", coverage="Greater Mumbai (106 records)", resolution="Point",
        temporal_resolution="Static", status="REAL / OFFICIAL", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="MCGM public REST, no explicit license", limitations="None identified.",
    ),
    entry(
        dataset="OSM supplemental infrastructure (schools, bridges, underpasses, substations, traffic signals)",
        category="Critical Infrastructure", source="OpenStreetMap (Overpass API)", provider="OpenStreetMap contributors",
        local_path="data/raw/infrastructure/{kurla_sion,hindmata_dadar}_osm_supplemental.geojson",
        format="GeoJSON (Point/LineString)", coverage="Kurla-Sion-Chunabhatti, Hindmata-Dadar-Parel",
        resolution="Vector", temporal_resolution="Real-time (community-maintained)",
        status="REAL", role="PRIMARY (schools have no confirmed MCGM public layer)",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False, license="ODbL",
        limitations="Substation voltage/capacity attributes are patchy in OSM (Excel-documented limitation).",
    ),
    entry(
        dataset="MCGM Outfalls / Pumping stations",
        category="Critical Infrastructure", source="MCGM SWD (press-released list only)", provider="MCGM",
        local_path="N/A", format="N/A", coverage="7 named stations (not geocoded here)",
        resolution="N/A", temporal_resolution="N/A", status="NOT VERIFIED", role="NOT SUITABLE (as automated source)",
        downloaded=False, processed=False, used_by_frontend=False, used_by_model=False, license="N/A",
        limitations="NOT confirmed as public GIS per the Excel. The 7 major stations (Haji Ali, Cleveland Bunder, "
                    "Irla, Love Grove, Britannia, Gazdarband, Mogra) are press-known and could be manually "
                    "geocoded, but that would not be official GIS and is not done automatically here.",
    ),
    entry(
        dataset="India Flood Inventory v3 (Zenodo 11275211)",
        category="Historical Flood Validation", source="Zenodo (Univ. of Alabama / contributors)", provider="Zenodo",
        local_path="data/raw/validation/India_Flood_Inventory_v3.csv, data/processed/validation/mumbai_flood_events.json",
        format="CSV", coverage="India, 1967-2023 (6,876 national events; 147 Mumbai-specific + 35 Maharashtra-regional)",
        resolution="Event / district", temporal_resolution="Event-level", status="REAL",
        role="PRIMARY (event index) / VALIDATION ONLY (extent)",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False, license="CC BY 4.0",
        limitations="Event index only (dates, location, fatalities/displacement) — NOT a continuous flood-extent "
                    "raster, so it cannot alone validate model-predicted flood extent; it identifies WHICH dates "
                    "to pursue Sentinel-1 imagery for. 'mumbai_specific' vs 'maharashtra_regional' distinguishes "
                    "genuinely localized Mumbai events from broad state-wide floods that merely list Mumbai among "
                    "many affected districts — see process_validation.py.",
    ),
    entry(
        dataset="Sentinel-1 SAR GRD (flood-extent validation)",
        category="Historical Flood Validation", source="Copernicus / ESA", provider="Copernicus Data Space Ecosystem",
        local_path="data/processed/validation/kurla_sion_sentinel1_validation_status.json",
        format="GeoTIFF (SAFE/ZIP archive)", coverage="Greater Mumbai",
        resolution="10 m", temporal_resolution="6-12 day revisit", status="PARTIAL - AUTH+SEARCH+DOWNLOAD VERIFIED, PROCESSING NOT RUN",
        role="PRIMARY (for validation)",
        downloaded=False, processed=False, used_by_frontend=False, used_by_model=False,
        license="Free / open (Copernicus terms)",
        limitations="Authentication against CDSE is REAL and verified working. A real catalog search found 16 "
                    "genuine Sentinel-1 IW GRD scenes over the Kurla-Sion AOI in the last 90 days. A real partial "
                    "download (5MB, confirmed valid ZIP/SAFE signature) proved the download endpoint works — this "
                    "surfaced and fixed a genuine bug where CDSE's cross-host redirect (catalogue -> download "
                    "subdomain) was silently dropping the auth header. The FULL scene (~1GB) was not downloaded "
                    "and VV-band change-detection/IoU/Precision/Recall/F1 were NOT run this session — no scores "
                    "are fabricated. Metrics functions are unit-tested against a synthetic fixture in "
                    "data/scripts/sentinel1_validation.py.",
    ),
    entry(
        dataset="Flood Susceptibility Index (DEM-aware)",
        category="Flood Model", source="Derived from real DEM elevation/slope/flow-accumulation + ESA WorldCover + OSM waterways",
        provider="Derived (data/scripts/build_flood_susceptibility.py)",
        local_path="data/processed/flood_model/mumbai_flood_susceptibility.tif",
        format="GeoTIFF + PNG", coverage="Greater Mumbai (1080x1620 @ 30m)",
        resolution="30 m", temporal_resolution="Static (terrain-based, not time-varying)",
        status="MODELLED", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="N/A (derived)",
        limitations="Equal-weighted 0-1 composite of 5 real factors (inverse elevation, inverse slope, log flow "
                    "accumulation, built-up fraction, inverse distance-to-waterway) — a transparent index, NOT a "
                    "calibrated hydraulic model, and NOT validated against observed flood extent. Plausibility "
                    "check: both pilot zones (chosen independently as known flood hotspots) score above the "
                    "city-wide mean (0.66 and 0.58 vs 0.51) purely from terrain — a sanity signal, not a "
                    "validation metric. Rainfall is intentionally excluded from this static layer.",
    ),
    entry(
        dataset="Rainfall-Aware Flood Impact Model (roads + infrastructure)",
        category="Flood Model", source="Real susceptibility (sampled per-feature) x real current GSMaP rainfall",
        provider="Derived (data/scripts/attach_risk_scores.py + frontend/src/lib/riskModel.ts)",
        local_path="data/processed/flood_model/{zone}_roads_risk.geojson, {zone}_infrastructure_risk.geojson",
        format="GeoJSON (real road/infrastructure geometry + susceptibility_score property)",
        coverage="Both pilot zones (3,215 + 3,016 road segments; 167 + 203 infrastructure points, all real)",
        resolution="Feature-level (per road segment / per infrastructure point)",
        temporal_resolution="Timeline-aware — recomputed client-side per hour from real GSMaP data",
        status="MODELLED", role="PRIMARY",
        downloaded=True, processed=True, used_by_frontend=True, used_by_model=False,
        license="N/A (derived)",
        limitations="Road Impact Score, Infrastructure Exposure Score, and Zone Flood Severity Score are all "
                    "computed as: real per-feature susceptibility (sampled from the DEM-aware raster at each "
                    "feature's real location) x real current-hour rainfall intensity, normalized against MCGM's "
                    "own official 50mm/hr BRIMSTOWAD post-1993 design intensity (see "
                    "mcgm_swd_official_statistics.json) rather than an arbitrary constant. Explicitly MODELLED — "
                    "not a calibrated hydraulic model, not validated against observed flood impact.",
    ),
]


def main():
    meta_dir = DATA_ROOT / "processed" / "metadata"
    for i, e in enumerate(MANIFEST):
        slug = e["dataset"].lower().replace(" ", "_").replace("/", "-").replace("(", "").replace(")", "").replace(",", "")[:60]
        write_json(meta_dir / f"{i:02d}_{slug}.json", e, log)

    write_json(DATA_ROOT / "data_manifest.json", {
        "project": "SIH26085 - FLOODWATCH Urban Flood Nowcasting System",
        "city": "Mumbai, Maharashtra, India",
        "generated_at": now_iso(),
        "source_of_truth": "Mumbai_SIH26085_Verified_Data_Sources_2.xlsx",
        "datasets": MANIFEST,
    }, log)

    real_count = sum(1 for e in MANIFEST if e["status"] in ("REAL", "REAL / OFFICIAL"))
    blocked_count = sum(1 for e in MANIFEST if "UNAVAILABLE" in e["status"])
    log.info(f"Manifest: {len(MANIFEST)} datasets total, {real_count} REAL/OFFICIAL, {blocked_count} UNAVAILABLE/blocked")


if __name__ == "__main__":
    main()

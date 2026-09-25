"""Assembles the DRAINAGE NETWORK documentation layer for FLOODCAST.

Per the Excel (category F) and the project's data-honesty rule, "drainage"
is NOT one dataset — it is three explicitly separated tiers that must never
be visually or semantically merged:

  A. REAL — open nallas / waterways + drainage points (OSM)
     -> data/raw/water/greater_mumbai_water_waterways.geojson
     -> data/raw/drainage/greater_mumbai_drainage_points.geojson (23 manholes/
        storm drains found during the Priority-5 investigation; sparse,
        single-cluster, NOT city-wide coverage — 2 carry an operator=MCGM
        OSM tag, which is a community edit, not a verified MCGM record)

  B. INFERRED — DEM-derived surface flow, flow accumulation, streamlines
     -> data/raw/drainage/mumbai_inferred_surface_flow.geojson (real DEM,
        9,717 segments, unit-tested pipeline)

  C. OFFICIAL — MCGM underground stormwater pipe / manhole network
     -> UNAVAILABLE as a spatial dataset. A full drainage investigation
        (see DRAINAGE_INVESTIGATION_REPORT.md) enumerated all 106 services
        on services8.arcgis.com/r6MmJtuWAzMawmJ8 and all 30 services across
        5 folders on the separate mybmcid.mcgm.gov.in ArcGIS Server — zero
        drainage-keyword matches on either host. However, REAL, OFFICIAL,
        NON-SPATIAL aggregate statistics (drain lengths, outfall counts,
        department structure) were found in MCGM's own published RTI
        manual and are available at:
        data/processed/drainage/mcgm_swd_official_statistics.json
        This is OFFICIAL city-wide context, not geometry — never converted
        into or presented as spatial features.

This script writes a single status/manifest document that the frontend's
Data Provenance UI reads directly, so the tiers are never conflated.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("build_drainage_layer")


def count_features(path: Path) -> int | None:
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return len(json.load(f)["features"])


def main():
    water_path = DATA_ROOT / "raw" / "water" / "greater_mumbai_water_waterways.geojson"
    points_path = DATA_ROOT / "raw" / "drainage" / "greater_mumbai_drainage_points.geojson"
    inferred_path = DATA_ROOT / "raw" / "drainage" / "mumbai_inferred_surface_flow.geojson"
    official_stats_path = DATA_ROOT / "processed" / "drainage" / "mcgm_swd_official_statistics.json"

    inferred_count = count_features(inferred_path)
    points_count = count_features(points_path)

    drainage_status = {
        "layer": "Drainage Network",
        "tiers": {
            "open_nallas_real": {
                "label": "Open Nallas / Waterways",
                "status": "REAL",
                "source": "OpenStreetMap (waterway=river/stream/drain/ditch/canal, natural=water)",
                "path": str(water_path) if water_path.exists() else None,
                "available": water_path.exists(),
                "note": "Includes Mithi River and major mapped nallas/creeks/lakes within OSM coverage. "
                        "Minor/informal drains are known to be incompletely mapped (Excel data-quality note).",
            },
            "drainage_points_real": {
                "label": "Manholes / Storm Drain Points (OSM)",
                "status": "REAL" if points_path.exists() else "UNAVAILABLE",
                "source": "OpenStreetMap (man_made=manhole, man_made=storm_drain, amenity=drain)",
                "path": str(points_path) if points_path.exists() else None,
                "available": points_path.exists(),
                "feature_count": points_count,
                "note": (f"Found during the Priority-5 drainage investigation: {points_count} real point "
                         "features, all clustered in one small area (Andheri/Powai), 0 within either pilot "
                         "zone. 2 carry an operator=MCGM OSM tag — a community contributor's tag, not a "
                         "verified official MCGM record. Too sparse for city-wide use; kept for completeness."
                         if points_path.exists() else "Not fetched."),
            },
            "surface_flow_inferred": {
                "label": "Surface Flow (DEM-derived)",
                "status": "INFERRED" if inferred_path.exists() else "BLOCKED - REQUIRES DEM",
                "source": "Derived from real Copernicus DEM GLO-30 via priority-flood + D8 flow direction + "
                          "flow accumulation (data/scripts/process_dem.py), per Excel category F 'Drainage - INFERRED'",
                "path": str(inferred_path) if inferred_path.exists() else None,
                "available": inferred_path.exists(),
                "feature_count": inferred_count,
                "note": (f"{inferred_count} stream segments derived from a real DEM, each carrying its flow-"
                         "accumulation cell count and provenance=INFERRED. This is surface flow from a digital "
                         "surface model, NOT the underground municipal pipe network."
                         if inferred_path.exists() else
                         "DEM acquisition is blocked on OPENTOPOGRAPHY_API_KEY. No flow lines are fabricated in its absence."),
            },
            "municipal_pipe_network_official": {
                "label": "Municipal Underground Stormwater Drainage (spatial)",
                "status": "UNAVAILABLE",
                "source": "MCGM Stormwater Drainage department",
                "path": None,
                "available": False,
                "note": "A full investigation enumerated ALL 106 services on services8.arcgis.com/r6MmJtuWAzMawmJ8 "
                        "and all 30 services across 5 folders on mybmcid.mcgm.gov.in — zero drainage-keyword "
                        "matches on either host (see DRAINAGE_INVESTIGATION_REPORT.md for full evidence). "
                        "Requires a formal MCGM SWD department request or RTI for pipe/manhole/outfall GIS with "
                        "diameter and invert-level attributes. Never fabricated or substituted with OSM/DEM data.",
            },
            "official_aggregate_statistics_nonspatial": {
                "label": "Official SWD Aggregate Statistics (non-spatial context)",
                "status": "OFFICIAL" if official_stats_path.exists() else "UNAVAILABLE",
                "source": "MCGM Chief Engineer (Storm Water Drains) RTI Manual",
                "path": str(official_stats_path) if official_stats_path.exists() else None,
                "available": official_stats_path.exists(),
                "note": "Real published city/region-level totals (drain lengths by type, 186 outfalls by "
                        "discharge point, department structure, BRIMSTOWAD history) transcribed verbatim from "
                        "an official MCGM PDF. NOT geometry — never rendered as map features.",
            },
        },
        "rule": "These tiers must always be displayed and labelled separately in the UI. "
                "Never present tier B, C, or the official statistics as tier A (or vice versa), "
                "and never present B as officially verified.",
        "generated_at": now_iso(),
    }

    out = DATA_ROOT / "processed" / "drainage" / "drainage_status.json"
    write_json(out, drainage_status, log)
    log.info("Drainage tier documentation written. Tiers available: "
              f"{[k for k, v in drainage_status['tiers'].items() if v['available']]}")


if __name__ == "__main__":
    main()

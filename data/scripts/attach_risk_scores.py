"""Attaches REAL, sampled flood-susceptibility values to REAL road and
infrastructure geometries, per pilot zone — the spatial half of the
rainfall-aware impact model. The temporal half (current rainfall intensity,
from real GSMaP data) is applied in the frontend at render time, since it
must respond instantly to the timeline slider.

For each feature, `susceptibility_score` (0-1) is sampled directly from the
real flood-susceptibility GeoTIFF (data/processed/flood_model/
mumbai_flood_susceptibility.tif) at its midpoint/location — never invented.

Output is explicitly labeled MODELLED: it is a transparent combination of
real DEM/landcover/waterway-derived susceptibility with real feature
geometry, not an observed or validated flood impact.
"""
import json
import sys
from pathlib import Path

import rasterio

sys.path.insert(0, str(Path(__file__).parent))
from common import DATA_ROOT, get_logger, now_iso, write_json

log = get_logger("attach_risk_scores")

PILOT_ZONES = {
    "kurla_sion": (72.8527, 19.0510, 72.9027, 19.1010),
    "hindmata_dadar": (72.8226, 18.9963, 72.8626, 19.0363),
}

# Filename -> normalized amenity tag, used to assign a defensible criticality
# weight in the frontend (see frontend/src/lib/riskModel.ts CRITICALITY_WEIGHTS).
# Assigned by source file rather than guessing from inconsistent MCGM
# attribute fields (TYPE/Hospital_Type vary by layer).
MCGM_INFRA_FILES = [
    ("mcgm_health_facilities.geojson", "hospital"),
    ("mcgm_fire_stations.geojson", "fire_station"),
    ("mcgm_police_stations.geojson", "police"),
    ("mcgm_metro_stations.geojson", "metro"),
    ("mcgm_suburban_railway_stations.geojson", "railway"),
]


def in_bbox(coord, bbox):
    x, y = coord
    w, s, e, n = bbox
    return w <= x <= e and s <= y <= n


def midpoint(coords):
    xs = [c[0] for c in coords]
    ys = [c[1] for c in coords]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def main():
    susc_path = DATA_ROOT / "processed" / "flood_model" / "mumbai_flood_susceptibility.tif"
    out_dir = DATA_ROOT / "processed" / "flood_model"
    out_dir.mkdir(parents=True, exist_ok=True)

    with rasterio.open(susc_path) as src:
        def sample_at(lng, lat):
            try:
                val = next(src.sample([(lng, lat)]))[0]
                return round(float(val), 4)
            except Exception:
                return None

        for zone_id, bbox in PILOT_ZONES.items():
            # Roads
            roads_path = DATA_ROOT / "raw" / "roads" / f"{zone_id}_roads.geojson"
            with open(roads_path, encoding="utf-8") as f:
                roads = json.load(f)
            for feat in roads["features"]:
                if feat["geometry"]["type"] == "LineString":
                    mid = midpoint(feat["geometry"]["coordinates"])
                    feat["properties"]["susceptibility_score"] = sample_at(*mid)
                    feat["properties"]["susceptibility_provenance"] = "MODELLED"
            write_json(out_dir / f"{zone_id}_roads_risk.geojson", roads, log)

            # Infrastructure: MCGM (bbox-filtered) + OSM supplemental, combined + scored
            infra_features = []
            for fname, amenity in MCGM_INFRA_FILES:
                path = DATA_ROOT / "raw" / "infrastructure" / fname
                with open(path, encoding="utf-8") as f:
                    fc = json.load(f)
                for feat in fc["features"]:
                    geom = feat.get("geometry")
                    if geom and geom["type"] == "Point" and in_bbox(geom["coordinates"], bbox):
                        feat["properties"]["amenity"] = amenity
                        feat["properties"]["name"] = (
                            feat["properties"].get("Hospital_Name")
                            or feat["properties"].get("NAME")
                            or feat["properties"].get("Name")
                            or f"Unnamed {amenity.replace('_', ' ')}"
                        )
                        infra_features.append(feat)

            osm_path = DATA_ROOT / "raw" / "infrastructure" / f"{zone_id}_osm_supplemental.geojson"
            with open(osm_path, encoding="utf-8") as f:
                osm_fc = json.load(f)
            for feat in osm_fc["features"]:
                if feat["geometry"]["type"] != "Point":
                    continue
                feat["properties"]["amenity"] = feat["properties"].get("category", "infrastructure")
                feat["properties"]["name"] = feat["properties"].get("name") or feat["properties"].get("category", "Unnamed asset")
                infra_features.append(feat)

            for feat in infra_features:
                lng, lat = feat["geometry"]["coordinates"]
                feat["properties"]["susceptibility_score"] = sample_at(lng, lat)
                feat["properties"]["susceptibility_provenance"] = "MODELLED"

            write_json(out_dir / f"{zone_id}_infrastructure_risk.geojson",
                       {"type": "FeatureCollection", "features": infra_features}, log)

            road_scores = [f["properties"]["susceptibility_score"] for f in roads["features"]
                           if f["properties"].get("susceptibility_score") is not None]
            infra_scores = [f["properties"]["susceptibility_score"] for f in infra_features
                             if f["properties"].get("susceptibility_score") is not None]
            log.info(f"{zone_id}: {len(road_scores)} road segments scored (mean={sum(road_scores)/len(road_scores):.3f}), "
                     f"{len(infra_scores)} infra points scored (mean={sum(infra_scores)/len(infra_scores):.3f})")

    write_json(out_dir / "_risk_attachment_status.json", {
        "status": "COMPLETE", "method": "rasterio point-sample of mumbai_flood_susceptibility.tif at real feature locations",
        "provenance": "MODELLED", "generated_at": now_iso(),
    }, log)


if __name__ == "__main__":
    main()

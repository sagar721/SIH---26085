import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import httpx

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from app.core.config import settings

PROCESSED_DIR = BASE_DIR / "data" / "processed"


def ingest_layer(client, layer_id: int, name: str, out_filename: str, bbox: dict):
    url = f"{settings.BMC_GIS_URL}/{layer_id}/query"
    geom_str = f"{bbox['min_lon']},{bbox['min_lat']},{bbox['max_lon']},{bbox['max_lat']}"
    params = {
        "where": "1=1",
        "geometry": geom_str,
        "geometryType": "esriGeometryEnvelope",
        "spatialRel": "esriSpatialRelIntersects",
        "inSR": "4326",
        "outSR": "4326",
        "outFields": "*",
        "f": "geojson",
        "returnGeometry": "true"
    }

    print(f"Querying BMC Layer [{layer_id}] {name} for study area...")
    try:
        res = client.get(url, params=params, timeout=30.0)
        if res.status_code == 200:
            data = res.json()
            features = data.get("features", [])
            print(f"  -> Ingested {len(features)} features for {name}")

            output_geojson = {
                "type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                "metadata": {
                    "source": "BMC_GIS",
                    "layer_id": layer_id,
                    "layer_name": name,
                    "retrieved_at": datetime.now(timezone.utc).isoformat(),
                    "attribution": "Brihanmumbai Municipal Corporation (BMC/MCGM) GIS Portal",
                    "feature_count": len(features)
                },
                "features": features
            }

            out_path = PROCESSED_DIR / out_filename
            out_path.parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(output_geojson, f)
            return len(features)
        else:
            print(f"  -> HTTP Error {res.status_code} querying {name}")
    except Exception as e:
        print(f"  -> Exception querying {name}: {e}")
    return 0


def run_bmc_ingestion():
    study_area = settings.load_study_area()
    bbox = study_area["bbox"]
    print(f"Ingesting BMC GIS for BBOX: {bbox}")

    headers = {"User-Agent": "M-FLOOD-Nowcaster/0.1"}
    raise RuntimeError(
        "Layer IDs must be selected from scripts/discover_bmc_layers.py metadata and explicitly configured; "
        "hardcoded IDs are prohibited."
    )


if __name__ == "__main__":
    run_bmc_ingestion()

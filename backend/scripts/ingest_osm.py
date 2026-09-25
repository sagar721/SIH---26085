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


def run_osm_ingestion():
    study_area = settings.load_study_area()
    bbox = study_area["bbox"]
    print(f"Ingesting OSM Data for BBOX: {bbox}")

    # Overpass bbox: min_lat, min_lon, max_lat, max_lon
    overpass_url = "https://overpass-api.de/api/interpreter"
    headers = {"User-Agent": "M-FLOOD-Nowcaster/0.1"}

    # Query roads
    road_query = f"""
    [out:json][timeout:25];
    (
      way["highway"~"primary|secondary|tertiary|trunk|motorway"]({bbox['min_lat']},{bbox['min_lon']},{bbox['max_lat']},{bbox['max_lon']});
    );
    out body geom;
    """

    print("Querying OSM primary/secondary/tertiary roads...")
    try:
        with httpx.Client(timeout=35.0, headers=headers) as client:
            res = client.post(overpass_url, data={"data": road_query})
            if res.status_code == 200:
                data = res.json()
                elements = data.get("elements", [])
                print(f"  -> Ingested {len(elements)} road segments from OSM")

                features = []
                for el in elements:
                    geometry = el.get("geometry", [])
                    if len(geometry) >= 2:
                        coords = [[pt["lon"], pt["lat"]] for pt in geometry]
                        tags = el.get("tags", {})
                        features.append({
                            "type": "Feature",
                            "id": str(el["id"]),
                            "properties": {
                                "id": str(el["id"]),
                                "name": tags.get("name", "Unnamed Road"),
                                "highway": tags.get("highway"),
                                "lanes": tags.get("lanes"),
                                "source": "OSM"
                            },
                            "geometry": {
                                "type": "LineString",
                                "coordinates": coords
                            }
                        })

                road_geojson = {
                    "type": "FeatureCollection",
                    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                    "metadata": {
                        "source": "OpenStreetMap",
                        "retrieved_at": datetime.now(timezone.utc).isoformat(),
                        "attribution": "OpenStreetMap contributors (ODbL)",
                        "feature_count": len(features)
                    },
                    "features": features
                }

                out_path = PROCESSED_DIR / "osm_roads.geojson"
                out_path.parent.mkdir(parents=True, exist_ok=True)
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(road_geojson, f)
                print(f"Saved {len(features)} road features to {out_path}")
    except Exception as e:
        print(f"Error querying OSM roads: {e}")

    # Query waterways (e.g. Mithi River)
    waterway_query = f"""
    [out:json][timeout:25];
    (
      way["waterway"]({bbox['min_lat']},{bbox['min_lon']},{bbox['max_lat']},{bbox['max_lon']});
    );
    out body geom;
    """
    print("Querying OSM waterways (Mithi River channels)...")
    try:
        with httpx.Client(timeout=35.0, headers=headers) as client:
            res = client.post(overpass_url, data={"data": waterway_query})
            if res.status_code == 200:
                data = res.json()
                elements = data.get("elements", [])
                print(f"  -> Ingested {len(elements)} waterway segments from OSM")

                features = []
                for el in elements:
                    geometry = el.get("geometry", [])
                    if len(geometry) >= 2:
                        coords = [[pt["lon"], pt["lat"]] for pt in geometry]
                        tags = el.get("tags", {})
                        features.append({
                            "type": "Feature",
                            "id": str(el["id"]),
                            "properties": {
                                "id": str(el["id"]),
                                "name": tags.get("name", "Waterway"),
                                "waterway": tags.get("waterway"),
                                "source": "OSM"
                            },
                            "geometry": {
                                "type": "LineString",
                                "coordinates": coords
                            }
                        })

                waterway_geojson = {
                    "type": "FeatureCollection",
                    "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
                    "metadata": {
                        "source": "OpenStreetMap",
                        "retrieved_at": datetime.now(timezone.utc).isoformat(),
                        "attribution": "OpenStreetMap contributors (ODbL)",
                        "feature_count": len(features)
                    },
                    "features": features
                }

                out_path = PROCESSED_DIR / "osm_waterways.geojson"
                with open(out_path, "w", encoding="utf-8") as f:
                    json.dump(waterway_geojson, f)
                print(f"Saved {len(features)} waterway features to {out_path}")
    except Exception as e:
        print(f"Error querying OSM waterways: {e}")


if __name__ == "__main__":
    run_osm_ingestion()

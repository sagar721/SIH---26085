import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("gis_service")

BASE_DIR = Path(__file__).resolve().parent.parent.parent
PROCESSED_DIR = BASE_DIR / "data" / "processed"


class GisService:
    def __init__(self):
        self.study_area = settings.load_study_area()
        self._layer_cache: Dict[str, Dict[str, Any]] = {}
        self._cache_mtime: Dict[str, float] = {}

    def _load_layer_geojson(self, filename: str) -> Dict[str, Any]:
        path = PROCESSED_DIR / filename
        if not path.exists():
            return {
                "status": "UNAVAILABLE",
                "error": f"Dataset not ingested: {filename}",
                "features": [],
                "source_type": "STATIC_GIS",
            }

        try:
            current_mtime = os.path.getmtime(path)
            # Use cached feature collection if file is unchanged
            if filename in self._layer_cache and self._cache_mtime.get(filename) == current_mtime:
                return self._layer_cache[filename]

            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)

            if data.get("type") != "FeatureCollection" or not isinstance(data.get("features"), list):
                logger.warning(f"Invalid GeoJSON structure in {filename}")
                return {
                    "status": "UNAVAILABLE",
                    "error": f"Invalid GeoJSON collection: {filename}",
                    "features": [],
                    "source_type": "STATIC_GIS",
                }

            metadata = data.get("metadata") or {}
            required = ("source", "retrieved_at", "attribution")
            if not all(metadata.get(field) for field in required):
                logger.warning(f"Missing required provenance in {filename}")
                return {
                    "status": "UNAVAILABLE",
                    "error": f"Missing required provenance in {filename}",
                    "features": [],
                    "source_type": "STATIC_GIS",
                }

            for feature in data["features"]:
                if not self._valid_geometry(feature.get("geometry")):
                    logger.warning(f"Invalid or out-of-bounds geometry in {filename}")
                    return {
                        "status": "UNAVAILABLE",
                        "error": f"Invalid or out-of-bounds geometry in {filename}",
                        "features": [],
                        "source_type": "STATIC_GIS",
                    }

            data["status"] = "AVAILABLE"
            data["source_type"] = "STATIC_GIS"
            self._layer_cache[filename] = data
            self._cache_mtime[filename] = current_mtime
            logger.info(f"Loaded GIS layer '{filename}' ({len(data['features'])} features, mtime={current_mtime})")
            return data

        except Exception as e:
            logger.error(f"Error loading GIS layer {filename}: {e}", exc_info=True)
            return {
                "status": "UNAVAILABLE",
                "error": f"Error parsing {filename}: {str(e)}",
                "features": [],
                "source_type": "STATIC_GIS",
            }

    @staticmethod
    def _valid_geometry(geometry: Any) -> bool:
        if not isinstance(geometry, dict) or not geometry.get("coordinates"):
            return False

        def coordinates(value: Any):
            if isinstance(value, (list, tuple)) and len(value) >= 2 and all(isinstance(item, (int, float)) for item in value[:2]):
                yield value
            elif isinstance(value, (list, tuple)):
                for item in value:
                    yield from coordinates(item)

        points = list(coordinates(geometry["coordinates"]))
        return bool(points) and all(-180 <= point[0] <= 180 and -90 <= point[1] <= 90 for point in points)

    def get_drains(self) -> Dict[str, Any]:
        return self._load_layer_geojson("bmc_drains.geojson")

    def get_manholes(self) -> Dict[str, Any]:
        return self._load_layer_geojson("bmc_manholes.geojson")

    def get_flooding_spots(self) -> Dict[str, Any]:
        return self._load_layer_geojson("bmc_flooding_spots.geojson")

    def get_critical_infrastructure(self) -> Dict[str, Any]:
        return self._load_layer_geojson("bmc_critical_infrastructure.geojson")

    def get_roads(self) -> Dict[str, Any]:
        return self._load_layer_geojson("osm_roads.geojson")

    def get_buildings(self) -> Dict[str, Any]:
        return self._load_layer_geojson("osm_buildings.geojson")

    def get_water_bodies(self) -> Dict[str, Any]:
        return self._load_layer_geojson("osm_waterways.geojson")


gis_service = GisService()

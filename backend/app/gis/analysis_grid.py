from typing import Any, Dict, List
from shapely.geometry import box, mapping

from app.core.config import settings
from app.gis.crs import calculate_metric_area_m2


def generate_analysis_grid(step_deg: float = 0.0035) -> List[Dict[str, Any]]:
    """
    Generate uniform analysis grid cells (approx 350m x 380m) covering the study area.
    Calculates exact ground surface area in metric hectares using UTM 43N (EPSG:32643).
    """
    study_area = settings.load_study_area()
    bbox = study_area["bbox"]

    cells = []
    cell_idx = 1

    lat = bbox["min_lat"]
    while lat < bbox["max_lat"]:
        lat_top = min(lat + step_deg, bbox["max_lat"])
        lon = bbox["min_lon"]
        while lon < bbox["max_lon"]:
            lon_right = min(lon + step_deg, bbox["max_lon"])

            poly = box(lon, lat, lon_right, lat_top)
            area_m2 = calculate_metric_area_m2(poly)
            area_hectares = area_m2 / 10000.0  # 1 hectare = 10,000 m2

            center_lon = round((lon + lon_right) / 2.0, 5)
            center_lat = round((lat + lat_top) / 2.0, 5)

            cells.append({
                "cell_id": f"GRID_{cell_idx:04d}",
                "unit_type": "ANALYSIS_GRID",
                "center": {"lon": center_lon, "lat": center_lat},
                "area_m2": round(area_m2, 2),
                "area_hectares": round(area_hectares, 3),
                "runoff_coefficient": 0.75,  # Urban built-up Mumbai default
                "geometry": mapping(poly),
                "bbox": {
                    "min_lon": lon,
                    "min_lat": lat,
                    "max_lon": lon_right,
                    "max_lat": lat_top
                }
            })
            cell_idx += 1
            lon += step_deg
        lat += step_deg

    return cells

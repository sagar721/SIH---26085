from typing import Any, Dict, List, Optional
from shapely.geometry import box, shape, mapping


def validate_and_clean_geometry(geom_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Validate GeoJSON geometry without silently repairing source data."""
    try:
        geom = shape(geom_dict)
        if geom.is_empty:
            return None
        if not geom.is_valid:
            return None
        return mapping(geom)
    except Exception:
        return None


def is_within_bbox(geom_dict: Dict[str, Any], bbox: Dict[str, float]) -> bool:
    """Check if geometry intersects or lies within study area bbox."""
    try:
        geom = shape(geom_dict)
        study_box = box(bbox["min_lon"], bbox["min_lat"], bbox["max_lon"], bbox["max_lat"])
        return geom.intersects(study_box)
    except Exception:
        return False

from typing import Any, Tuple
import pyproj
from shapely.geometry import shape, mapping
from shapely.ops import transform

# WGS84 standard geographic CRS
CRS_GEOGRAPHIC = "EPSG:4326"

# UTM Zone 43N (Metric projected CRS for Mumbai / Maharashtra, India)
CRS_PROJECTED_MUMBAI = "EPSG:32643"

# Transformer for metric area/distance calculations
_wgs84_to_utm43n = pyproj.Transformer.from_crs(CRS_GEOGRAPHIC, CRS_PROJECTED_MUMBAI, always_xy=True).transform
_utm43n_to_wgs84 = pyproj.Transformer.from_crs(CRS_PROJECTED_MUMBAI, CRS_GEOGRAPHIC, always_xy=True).transform


def to_projected_metric(geom):
    """Transform geometry from EPSG:4326 to metric UTM Zone 43N (EPSG:32643)."""
    return transform(_wgs84_to_utm43n, geom)


def to_geographic_wgs84(geom):
    """Transform geometry from metric UTM Zone 43N to EPSG:4326."""
    return transform(_utm43n_to_wgs84, geom)


def calculate_metric_area_m2(geom) -> float:
    """Calculate the true ground surface area of a geometry in square meters."""
    projected = to_projected_metric(geom)
    return float(projected.area)


def calculate_metric_length_m(geom) -> float:
    """Calculate the true ground length of a linear geometry in meters."""
    projected = to_projected_metric(geom)
    return float(projected.length)


def calculate_metric_distance_m(geom1, geom2) -> float:
    """Calculate true distance between two geometries in meters."""
    p1 = to_projected_metric(geom1)
    p2 = to_projected_metric(geom2)
    return float(p1.distance(p2))

import pytest
from shapely.geometry import LineString, Point, Polygon

from app.gis.crs import (
    CRS_GEOGRAPHIC,
    CRS_PROJECTED_MUMBAI,
    calculate_metric_area_m2,
    calculate_metric_distance_m,
    calculate_metric_length_m,
    to_geographic_wgs84,
    to_projected_metric,
)
from app.services.gis_service import gis_service


def test_crs_constants():
    assert CRS_GEOGRAPHIC == "EPSG:4326"
    assert CRS_PROJECTED_MUMBAI == "EPSG:32643"


def test_utm43n_metric_calculations():
    # Point near Bandra Kurla Complex (BKC, Mumbai)
    p1 = Point(72.8679, 19.0657)
    p2 = Point(72.8779, 19.0657)

    dist_m = calculate_metric_distance_m(p1, p2)
    # ~0.01 deg lon difference at lat 19N is ~1050 meters
    assert 1000.0 < dist_m < 1100.0

    # LineString test
    line = LineString([(72.8679, 19.0657), (72.8779, 19.0657)])
    length_m = calculate_metric_length_m(line)
    assert length_m == pytest.approx(dist_m, rel=1e-3)

    # Square polygon ~100m on a side
    poly = Polygon([
        (72.8670, 19.0650),
        (72.8679, 19.0650),
        (72.8679, 19.0659),
        (72.8670, 19.0659),
        (72.8670, 19.0650)
    ])
    area_m2 = calculate_metric_area_m2(poly)
    assert area_m2 > 0


def test_gis_service_missing_file_handling():
    res = gis_service._load_layer_geojson("non_existent_layer.geojson")
    assert res["status"] == "UNAVAILABLE"
    assert res["source_type"] == "STATIC_GIS"
    assert "Dataset not ingested" in res["error"]


def test_gis_service_geometry_validation():
    valid_geom = {"type": "Point", "coordinates": [72.85, 19.07]}
    assert gis_service._valid_geometry(valid_geom) is True

    # Out of bounds latitude (> 90)
    invalid_geom = {"type": "Point", "coordinates": [72.85, 95.0]}
    assert gis_service._valid_geometry(invalid_geom) is False

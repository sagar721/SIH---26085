import pytest
from app.schemas.common import ProviderStatusEnum, DataSourceTypeEnum, GeoJsonFeatureCollection, GeoJsonGeometry, GeoJsonFeature
from app.schemas.weather import WeatherCurrentResponse
from app.schemas.drainage import DrainageUtilizationResponse, DrainageSection
from app.schemas.routing import SafeRouteRequest, LatLng
from datetime import datetime, timezone


def test_provider_status_enum_values():
    assert ProviderStatusEnum.CONNECTED.value == "CONNECTED"
    assert ProviderStatusEnum.NOT_CONFIGURED.value == "NOT_CONFIGURED"
    assert ProviderStatusEnum.UNAVAILABLE.value == "UNAVAILABLE"
    assert ProviderStatusEnum.DELAYED.value == "DELAYED"
    assert ProviderStatusEnum.ERROR.value == "ERROR"


def test_datasource_type_enum_values():
    assert DataSourceTypeEnum.OBSERVED.value == "OBSERVED"
    assert DataSourceTypeEnum.FORECAST.value == "FORECAST"
    assert DataSourceTypeEnum.DERIVED.value == "DERIVED"
    assert DataSourceTypeEnum.ASSUMED_FOR_PROTOTYPE.value == "ASSUMED_FOR_PROTOTYPE"


def test_geojson_feature_collection_validation():
    geom = GeoJsonGeometry(type="LineString", coordinates=[[72.85, 19.05], [72.86, 19.06]])
    feature = GeoJsonFeature(geometry=geom, properties={"name": "Test Drain"})
    fc = GeoJsonFeatureCollection(features=[feature])
    assert fc.type == "FeatureCollection"
    assert len(fc.features) == 1
    assert fc.features[0].properties["name"] == "Test Drain"


def test_safe_route_request_validation():
    req = SafeRouteRequest(
        start=LatLng(lat=19.0688, lng=72.8700),
        destination=LatLng(lat=19.0725, lng=72.8800),
        time_step_min=30
    )
    assert req.start.lat == 19.0688
    assert req.destination.lng == 72.8800
    assert req.vehicle_type == "emergency"

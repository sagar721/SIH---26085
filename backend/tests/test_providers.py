import asyncio
import pytest
from datetime import datetime, timezone

from app.data_sources.base import DataSourceType, ProviderStatus
from app.data_sources.open_meteo import OpenMeteoSource
from app.data_sources.osm import OsmSource
from app.data_sources.tomorrow import TomorrowIOSource


def test_provider_status_enum_completeness():
    valid_statuses = {"CONNECTED", "DELAYED", "UNAVAILABLE", "NOT_CONFIGURED", "ERROR"}
    for status in ProviderStatus:
        assert status.value in valid_statuses


def test_tomorrow_reports_not_configured_when_key_missing():
    source = TomorrowIOSource()
    metadata = source.metadata()

    assert metadata["name"] == "Tomorrow.io"
    assert metadata["source_type"] == "NOWCAST"


def test_tomorrow_fetch_reports_not_configured():
    source = TomorrowIOSource()
    result = asyncio.run(source.fetch())
    assert result["status"] == "NOT_CONFIGURED"
    assert "TOMORROW_API_KEY" in result["error"]


def test_osm_bbox_validation():
    source = OsmSource()

    # Valid Mumbai bounding box
    valid_bbox = {"min_lat": 19.05, "min_lon": 72.84, "max_lat": 19.10, "max_lon": 72.90}
    min_lat, min_lon, max_lat, max_lon = source._validate_bbox(valid_bbox)
    assert min_lat == 19.05
    assert max_lat == 19.10

    # Inverted latitude (min > max)
    invalid_bbox = {"min_lat": 19.15, "min_lon": 72.84, "max_lat": 19.10, "max_lon": 72.90}
    with pytest.raises(ValueError, match="out of valid range"):
        source._validate_bbox(invalid_bbox)

    # Missing keys
    incomplete_bbox = {"min_lat": 19.05}
    with pytest.raises(ValueError, match="Invalid bounding box structure"):
        source._validate_bbox(incomplete_bbox)


def test_open_meteo_source_metadata():
    source = OpenMeteoSource()
    meta = source.metadata()

    assert meta["name"] == "Open-Meteo"
    assert meta["source_type"] == "FORECAST"
    assert "Open-Meteo.com" in meta["attribution"]

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_weather_endpoints():
    res = client.get("/api/v1/weather/current")
    assert res.status_code == 200
    data = res.json()
    assert data["provider"] in ["Open-Meteo", "open_meteo"]
    assert "status" in data

    res_fc = client.get("/api/v1/weather/forecast")
    assert res_fc.status_code == 200
    assert "hourly_forecast" in res_fc.json() or "forecast_steps" in res_fc.json() or "data" in res_fc.json()


def test_rainfall_endpoints():
    res = client.get("/api/v1/rainfall/current")
    assert res.status_code == 200
    data = res.json()
    assert "corridor" in data
    assert "current_intensity_mm_per_hr" in data

    res_fc = client.get("/api/v1/rainfall/forecast")
    assert res_fc.status_code == 200
    data_fc = res_fc.json()
    assert "forecast_steps" in data_fc


def test_gis_endpoints():
    for layer in ["roads", "drains", "critical-infrastructure"]:
        res = client.get(f"/api/v1/gis/{layer}")
        assert res.status_code == 200
        data = res.json()
        assert data.get("type") == "FeatureCollection" or data.get("status") in ["CONNECTED", "AVAILABLE"]


def test_provenance_endpoint_contract():
    res = client.get("/api/v1/provenance")
    assert res.status_code == 200
    data = res.json()
    assert "datasets" in data
    assert "models" in data
    assert "rules_compliance" in data

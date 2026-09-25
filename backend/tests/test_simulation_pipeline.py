import asyncio
import pytest
from fastapi import status

from app.data_sources import PROVIDERS
from app.core.config import settings
from app.services.simulation_service import simulation_service


def test_simulation_execution_to_completion(client, monkeypatch):
    monkeypatch.setattr(settings, "DRAINAGE_OUTFALL_CAPACITY_M3S", 30.0)
    # Submit simulation with a 45 mm/hr monsoon scenario
    sim = asyncio.run(
        simulation_service.submit(
            horizon_minutes=60,
            timestep_minutes=15,
            scenario_rainfall_mm_hr=45.0,
        )
    )
    sim_id = sim["simulation_id"]
    assert sim["status"] in ("QUEUED", "RUNNING")

    # Await simulation execution directly to completion
    asyncio.run(simulation_service._run(sim_id))

    completed_record = simulation_service.get(sim_id)
    assert completed_record is not None
    assert completed_record["status"] == "COMPLETED"
    assert completed_record["provenance"]["drainage_capacity_type"] == "CONFIGURED_ASSUMPTION"
    assert completed_record["provenance"]["drainage_capacity_m3s"] == 30.0
    assert len(completed_record["timeline"]) == 4  # 60m / 15m = 4 steps
    assert completed_record["peak_flood_depth_m"] > 0.0

    # 1. Test /flood/depth endpoint
    res_depth = client.get(f"/api/v1/flood/depth?simulation_id={sim_id}")
    assert res_depth.status_code == status.HTTP_200_OK
    depth_data = res_depth.json()
    assert depth_data["type"] == "FeatureCollection"
    assert len(depth_data["features"]) > 0
    assert "depth_m" in depth_data["features"][0]["properties"]
    assert depth_data["result_type"] == "DERIVED"

    # 2. Test /flood/risk endpoint
    res_risk = client.get(f"/api/v1/flood/risk?simulation_id={sim_id}")
    assert res_risk.status_code == status.HTTP_200_OK
    risk_data = res_risk.json()
    assert risk_data["status"] == "AVAILABLE"
    assert "risk_breakdown" in risk_data
    assert risk_data["result_type"] == "DERIVED"

    # 3. Test /flood/affected-roads endpoint
    res_roads = client.get(f"/api/v1/flood/affected-roads?simulation_id={sim_id}")
    assert res_roads.status_code == status.HTTP_200_OK
    roads_data = res_roads.json()
    assert roads_data["label"] == "DERIVED FLOOD-IMPACT ESTIMATE"
    assert roads_data["type"] == "FeatureCollection"

    # 4. Test /flood/critical-locations endpoint
    res_crit = client.get(f"/api/v1/flood/critical-locations?simulation_id={sim_id}")
    assert res_crit.status_code == status.HTTP_200_OK
    crit_data = res_crit.json()
    assert crit_data["type"] == "FeatureCollection"

    # 5. Test safe routing with this simulation ID
    route_req = {
        "start": {"lon": 72.8600, "lat": 19.0700},
        "destination": {"lon": 72.8700, "lat": 19.0750},
        "simulation_id": sim_id,
    }
    res_route = client.post("/api/v1/routing/safe-route", json=route_req)
    assert res_route.status_code in (status.HTTP_200_OK, 422)


def test_simulation_fails_closed_when_weather_is_unavailable(monkeypatch):
    class UnavailableWeather:
        name = "Unavailable weather"
        source_type = type("SourceType", (), {"value": "FORECAST"})()

        async def fetch(self, **kwargs):
            return {"status": "UNAVAILABLE", "hourly": {}, "current": {}}

    monkeypatch.setitem(PROVIDERS, "open_meteo", UnavailableWeather())
    sim = asyncio.run(
        simulation_service.submit(
            horizon_minutes=15,
            timestep_minutes=15,
        )
    )

    asyncio.run(simulation_service._run(sim["simulation_id"]))
    failed = simulation_service.get(sim["simulation_id"])

    assert failed is not None
    assert failed["status"] == "FAILED"
    assert "Rainfall forecast unavailable" in failed["error"]

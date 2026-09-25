import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_simulation_lifecycle_and_timeline():
    # 1. Start simulation
    resp = client.post(
        "/api/v1/simulation/run",
        json={"corridor": "mithi", "rainfall_intensity_mm_hr": 75.0, "drainage_blockage_pct": 20.0}
    )
    assert resp.status_code == 202
    data = resp.json()
    sim_id = data["simulation_id"]
    assert sim_id is not None
    assert data["status"] in ["QUEUED", "RUNNING", "COMPLETED"]

    # 2. Check status
    status_resp = client.get(f"/api/v1/simulation/{sim_id}/status")
    assert status_resp.status_code == 200
    st_data = status_resp.json()
    assert st_data["id"] == sim_id

    # 3. Complete the simulation execution
    import asyncio
    from app.services.simulation_service import simulation_service
    asyncio.run(simulation_service._run(sim_id))

    # 4. Check timeline (contains 3D-ready spatial steps)
    timeline_resp = client.get(f"/api/v1/simulation/{sim_id}/timeline")
    assert timeline_resp.status_code == 200
    tl_data = timeline_resp.json()
    assert "steps" in tl_data
    assert len(tl_data["steps"]) > 0

    first_step = tl_data["steps"][0]
    assert "water_polygons" in first_step
    assert "max_depth_m" in first_step

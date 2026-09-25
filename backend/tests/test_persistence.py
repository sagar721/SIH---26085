import asyncio
import uuid
import pytest

from app.services.runtime_store import runtime_store


def test_runtime_store_persists_simulation():
    sim_id = f"test_sim_{uuid.uuid4().hex[:8]}"
    record = {
        "simulation_id": sim_id,
        "status": "COMPLETED",
        "created_at": runtime_store.now(),
        "horizon_minutes": 60,
        "timestep_minutes": 15,
        "timeline": [],
        "provenance": {"model": "Rational Method"},
    }

    asyncio.run(runtime_store.save_simulation(sim_id, record))

    # Retrieve from memory
    retrieved = asyncio.run(runtime_store.get_simulation(sim_id))
    assert retrieved is not None
    assert retrieved["simulation_id"] == sim_id
    assert retrieved["status"] == "COMPLETED"


def test_runtime_store_persists_alert():
    alert_id = f"alert_{uuid.uuid4().hex[:8]}"
    alert = {
        "alert_id": alert_id,
        "severity": "CRITICAL",
        "title": "High Water Alert",
        "location_name": "Kurla Junction",
        "predicted_depth_m": 0.45,
    }

    asyncio.run(runtime_store.add_alert(alert))

    # Check alert was buffered
    assert any(a.get("alert_id") == alert_id for a in runtime_store.alerts)


def test_runtime_store_reports_configured_durability_backend():
    assert runtime_store.durability.startswith("SQLITE:")


def test_runtime_store_returns_isolated_simulation_records():
    sim_id = f"test_copy_{uuid.uuid4().hex[:8]}"
    record = {"simulation_id": sim_id, "nested": {"status": "QUEUED"}}
    asyncio.run(runtime_store.save_simulation(sim_id, record))

    retrieved = asyncio.run(runtime_store.get_simulation(sim_id))
    assert retrieved is not None
    retrieved["nested"]["status"] = "MUTATED"

    stored = asyncio.run(runtime_store.get_simulation(sim_id))
    assert stored is not None
    assert stored["nested"]["status"] == "QUEUED"

import asyncio
import pytest
from fastapi import status

from app.services.alert_service import alert_service
from app.services.provenance_service import provenance_service
from app.workers.weather_worker import weather_worker


def test_alert_service_creation_and_filtering():
    # Create an alert
    alert = asyncio.run(
        alert_service.create_alert(
            severity="CRITICAL",
            location="Kurla West Station Underpass",
            predicted_depth_m=0.55,
            time_to_critical_min=15,
            affected_road="LBS Marg",
        )
    )

    assert alert["severity"] == "CRITICAL"
    assert alert["predicted_depth_m"] == 0.55
    assert alert["result_type"] == "DERIVED"
    assert alert["label"] == "System-generated derived flood-risk alert"

    # Verify retrieval
    all_alerts = alert_service.get_all_alerts()
    assert any(a["alert_id"] == alert["alert_id"] for a in all_alerts)

    crit_alerts = alert_service.get_critical_alerts()
    assert any(a["alert_id"] == alert["alert_id"] for a in crit_alerts)


def test_provenance_service_completeness():
    prov = provenance_service.get_system_provenance()
    assert prov["status"] == "AVAILABLE"
    assert "EPSG:32643" in prov["study_area"]["crs"]
    assert len(prov["data_sources"]) > 0
    assert "runoff_formula" in prov["hydrologic_model"]


def test_weather_worker_single_refresh():
    # Execute a manual refresh run
    asyncio.run(weather_worker.refresh_once())
    assert weather_worker.last_run_timestamp is not None
    assert weather_worker.last_run_status in ("CONNECTED", "UNAVAILABLE", "ERROR")


def test_alerts_endpoint(client):
    res = client.get("/api/v1/alerts")
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert "alerts" in data
    assert data["label"] == "System-generated derived flood-risk alert"

    res_crit = client.get("/api/v1/alerts/critical")
    assert res_crit.status_code == status.HTTP_200_OK


def test_provenance_endpoint(client):
    res = client.get("/api/v1/provenance")
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert "hydrologic_model" in data
    assert "study_area" in data

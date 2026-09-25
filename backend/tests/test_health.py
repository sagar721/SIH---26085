import pytest
from fastapi import status


def test_root_endpoint(client):
    response = client.get("/")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["message"] == "Welcome to M-FLOOD API"
    assert data["docs"] == "/docs"


def test_health_endpoint(client):
    response = client.get("/api/v1/health")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "M-FLOOD"
    assert data["version"] == "0.1.0"
    assert "timestamp" in data


def test_health_live_endpoint(client):
    response = client.get("/api/v1/health/live")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["status"] == "live"
    assert "timestamp" in data


def test_health_ready_endpoint(client):
    response = client.get("/api/v1/health/ready")
    assert response.status_code == status.HTTP_503_SERVICE_UNAVAILABLE
    assert response.json()["detail"]["status"] == "not_ready"


def test_swagger_docs_endpoint(client):
    response = client.get("/docs")
    assert response.status_code == status.HTTP_200_OK
    assert "swagger-ui" in response.text.lower()


def test_openapi_schema(client):
    response = client.get("/api/v1/openapi.json")
    assert response.status_code == status.HTTP_200_OK
    schema = response.json()
    assert schema["info"]["title"] == "M-FLOOD API"
    assert "/api/v1/health" in schema["paths"]
    assert "/api/v1/health/live" in schema["paths"]
    assert "/api/v1/health/ready" in schema["paths"]


def test_openapi_exposes_typed_simulation_contracts(client):
    schema = client.get("/api/v1/openapi.json").json()
    run_operation = schema["paths"]["/api/v1/simulation/run"]["post"]
    status_operation = schema["paths"]["/api/v1/simulation/{simulation_id}/status"]["get"]

    assert "SimulationSubmitResponse" in run_operation["responses"]["202"]["content"]["application/json"]["schema"]["$ref"]
    assert "SimulationStatusResponse" in status_operation["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]

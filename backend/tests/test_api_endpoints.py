import pytest
from fastapi import status

from app.core import config


def test_network_status_endpoint(client):
    response = client.get("/api/v1/routing/network-status")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert "status" in data
    assert "nodes" in data
    assert "edges" in data
    assert "EPSG:32643" in data["crs"]


def test_safe_route_endpoint_baseline(client):
    payload = {
        "start": {"lon": 72.8600, "lat": 19.0700},
        "destination": {"lon": 72.8700, "lat": 19.0750},
        "simulation_id": "baseline",
    }
    response = client.post("/api/v1/routing/safe-route", json=payload)
    # If roads dataset is available, returns 200, otherwise returns 200 with UNAVAILABLE or 422 if impassable
    assert response.status_code in (status.HTTP_200_OK, 422)
    data = response.json()
    if response.status_code == status.HTTP_200_OK:
        assert data["result_type"] == "DERIVED"


def test_safe_route_missing_simulation(client):
    payload = {
        "start": {"lon": 72.8600, "lat": 19.0700},
        "destination": {"lon": 72.8700, "lat": 19.0750},
        "simulation_id": "non-existent-sim-id",
    }
    response = client.post("/api/v1/routing/safe-route", json=payload)
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_drainage_utilization_endpoint(client):
    response = client.get("/api/v1/drainage/utilization?rainfall_mm_hr=50.0&runoff_coefficient=0.8")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["rainfall_mm_hr"] == 50.0
    assert "status" in data


def test_drainage_overloaded_endpoint(client):
    response = client.get("/api/v1/drainage/overloaded?rainfall_mm_hr=75.0")
    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert "status" in data
    assert "overloaded_count" in data
    assert data["result_type"] == "DERIVED"


def test_simulation_requires_jwt_when_authentication_is_enabled(client, monkeypatch):
    from app.core.auth import hash_password

    monkeypatch.setattr(config.settings, "JWT_SECRET_KEY", "test-secret")
    monkeypatch.setattr(config.settings, "AUTH_ADMIN_USERNAME", "admin")
    monkeypatch.setattr(config.settings, "AUTH_ADMIN_PASSWORD_HASH", hash_password("correct-password"))

    unauthorized = client.post("/api/v1/simulation/run", json={"scenario_rainfall_mm_hr": 0.0})
    assert unauthorized.status_code == status.HTTP_401_UNAUTHORIZED

    invalid = client.post(
        "/api/v1/auth/token",
        json={"username": "admin", "password": "wrong-password"},
    )
    assert invalid.status_code == status.HTTP_401_UNAUTHORIZED

    token_response = client.post(
        "/api/v1/auth/token",
        json={"username": "admin", "password": "correct-password"},
    )
    assert token_response.status_code == status.HTTP_200_OK
    token = token_response.json()["access_token"]

    authorized = client.post(
        "/api/v1/simulation/run",
        headers={"Authorization": f"Bearer {token}"},
        json={"scenario_rainfall_mm_hr": 0.0},
    )
    assert authorized.status_code == status.HTTP_202_ACCEPTED


def test_hashed_password_and_token_revocation(client, monkeypatch):
    from app.core.auth import hash_password

    monkeypatch.setattr(config.settings, "JWT_SECRET_KEY", "test-secret")
    monkeypatch.setattr(config.settings, "AUTH_ADMIN_USERNAME", "hashed-admin")
    monkeypatch.setattr(config.settings, "AUTH_ADMIN_PASSWORD", None)
    monkeypatch.setattr(config.settings, "AUTH_ADMIN_PASSWORD_HASH", hash_password("correct-password"))

    token_response = client.post(
        "/api/v1/auth/token",
        json={"username": "hashed-admin", "password": "correct-password"},
    )
    assert token_response.status_code == status.HTTP_200_OK
    token = token_response.json()["access_token"]

    revoked = client.post("/api/v1/auth/revoke", headers={"Authorization": f"Bearer {token}"})
    assert revoked.status_code == status.HTTP_204_NO_CONTENT

    rejected = client.post(
        "/api/v1/simulation/run",
        headers={"Authorization": f"Bearer {token}"},
        json={"scenario_rainfall_mm_hr": 0.0},
    )
    assert rejected.status_code == status.HTTP_401_UNAUTHORIZED

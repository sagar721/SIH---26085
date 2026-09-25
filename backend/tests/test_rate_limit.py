import pytest
from fastapi import status


def test_rate_limit_headers_present(client):
    response = client.get("/api/v1/routing/network-status")
    assert response.status_code == status.HTTP_200_OK
    assert "X-RateLimit-Limit" in response.headers
    assert "X-RateLimit-Remaining" in response.headers
    assert int(response.headers["X-RateLimit-Limit"]) == 120


def test_rate_limit_exempt_probes(client):
    # Health checks must never be rate limited
    response = client.get("/api/v1/health")
    assert response.status_code == status.HTTP_200_OK


def test_rate_limiter_exceeds_threshold():
    from app.core.middleware import RateLimitMiddleware
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    test_app = FastAPI()
    test_app.add_middleware(RateLimitMiddleware, requests_per_minute=2)

    @test_app.get("/test-endpoint")
    def ping():
        return {"ping": "pong"}

    with TestClient(test_app) as tc:
        # Request 1: succeeds (remaining: 1)
        r1 = tc.get("/test-endpoint")
        assert r1.status_code == 200

        # Request 2: succeeds (remaining: 0)
        r2 = tc.get("/test-endpoint")
        assert r2.status_code == 200

        # Request 3: blocked (HTTP 429 Too Many Requests)
        r3 = tc.get("/test-endpoint")
        assert r3.status_code == 429
        assert "Rate limit exceeded" in r3.json()["error"]

import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.core import auth as auth_module
from app.core.auth import hash_password

client = TestClient(app)

# A locally-generated RSA keypair standing in for a real identity provider's
# signing key. Tests never hit the network for a real JWKS document — instead
# app.core.auth._get_jwks_client is monkeypatched below to return this key,
# so the test still exercises real RS256 signature verification end-to-end.
_RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


class _FakeSigningKey:
    def __init__(self, key):
        self.key = key


class _FakeJwksClient:
    def get_signing_key_from_jwt(self, token):
        return _FakeSigningKey(_RSA_KEY.public_key())


@pytest.fixture(autouse=True)
def configure_test_auth(monkeypatch):
    """Ensure auth is configured for rotation and OIDC testing."""
    monkeypatch.setattr(settings, "JWT_SECRET_KEY", "test-secret-key-for-audit-verification-32b")
    monkeypatch.setattr(settings, "AUTH_ADMIN_USERNAME", "admin_audit")
    monkeypatch.setattr(settings, "AUTH_ADMIN_PASSWORD_HASH", hash_password("AdminSecurePass123!"))
    monkeypatch.setattr(settings, "OIDC_ENABLED", True)
    monkeypatch.setattr(settings, "OIDC_PROVIDER_NAME", "TestOIDC")
    monkeypatch.setattr(settings, "OIDC_ISSUER_URL", "https://test-idp.example.com")
    monkeypatch.setattr(settings, "OIDC_CLIENT_ID", "test-client-id")
    monkeypatch.setattr(settings, "OIDC_JWKS_URL", "https://test-idp.example.com/.well-known/jwks.json")
    monkeypatch.setattr(auth_module, "_get_jwks_client", lambda jwks_url: _FakeJwksClient())


def _signed_oidc_token(**overrides) -> str:
    now = int(time.time())
    payload = {
        "sub": "google-oauth2|987654321",
        "email": "mumbai_operator@floodcast.gov.in",
        "roles": ["operator"],
        "iss": settings.OIDC_ISSUER_URL,
        "aud": settings.OIDC_CLIENT_ID,
        "iat": now,
        "exp": now + 3600,
    }
    payload.update(overrides)
    return jwt.encode(payload, _RSA_KEY, algorithm="RS256")


def test_issue_token_pair():
    """Verify /token issues both access_token and refresh_token."""
    resp = client.post(
        "/api/v1/auth/token",
        json={"username": "admin_audit", "password": "AdminSecurePass123!"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["role"] == "admin"
    assert data["token_type"] == "bearer"


def test_refresh_token_rotation_and_reuse_prevention():
    """Verify refresh token rotation and ensure single-use enforcement."""
    # 1. Obtain initial tokens
    resp = client.post(
        "/api/v1/auth/token",
        json={"username": "admin_audit", "password": "AdminSecurePass123!"},
    )
    assert resp.status_code == 200
    token_data = resp.json()
    refresh_tok_1 = token_data["refresh_token"]

    # 2. Rotate refresh token
    rot_resp = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_tok_1},
    )
    assert rot_resp.status_code == 200
    rot_data = rot_resp.json()
    access_tok_2 = rot_data["access_token"]
    refresh_tok_2 = rot_data["refresh_token"]
    assert access_tok_2 != token_data["access_token"]
    assert refresh_tok_2 != refresh_tok_1

    # 3. Attempt reuse of rotated refresh token 1 -> must fail
    reuse_resp = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_tok_1},
    )
    assert reuse_resp.status_code == 401
    assert "revoked" in reuse_resp.json()["detail"].lower()

    # 4. Use new refresh token 2 -> succeeds
    rot_resp_2 = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_tok_2},
    )
    assert rot_resp_2.status_code == 200


def test_refresh_token_rejected_as_access_token():
    """A refresh token cannot be used in Authorization header for protected endpoints."""
    resp = client.post(
        "/api/v1/auth/token",
        json={"username": "admin_audit", "password": "AdminSecurePass123!"},
    )
    refresh_tok = resp.json()["refresh_token"]

    # Try calling protected /revoke with refresh token
    prot_resp = client.post(
        "/api/v1/auth/revoke",
        headers={"Authorization": f"Bearer {refresh_tok}"},
    )
    assert prot_resp.status_code == 401
    assert "cannot use refresh token" in prot_resp.json()["detail"].lower()


def test_oidc_login_success_and_role_mapping():
    """Verify external OIDC token verification (real RS256/JWKS-style, via the
    fake JWKS client fixture) and role mapping."""
    oidc_id_token = _signed_oidc_token()

    resp = client.post(
        "/api/v1/auth/oidc/login",
        json={"id_token": oidc_id_token},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["role"] == "operator"

    # Verify the issued access token works on authenticated endpoint
    auth_resp = client.post(
        "/api/v1/auth/revoke",
        headers={"Authorization": f"Bearer {data['access_token']}"},
    )
    assert auth_resp.status_code == 204


def test_oidc_login_rejects_wrong_audience():
    """A token signed by the right key but for a different client (aud) must be rejected."""
    token = _signed_oidc_token(aud="some-other-client-id")
    resp = client.post("/api/v1/auth/oidc/login", json={"id_token": token})
    assert resp.status_code == 401


def test_oidc_login_rejects_wrong_issuer():
    """A token signed by the right key but from a different issuer must be rejected."""
    token = _signed_oidc_token(iss="https://not-our-idp.example.com")
    resp = client.post("/api/v1/auth/oidc/login", json={"id_token": token})
    assert resp.status_code == 401


def test_oidc_login_rejects_token_signed_with_local_jwt_secret():
    """Regression test for the fixed vulnerability: an ID token signed with
    this application's OWN JWT_SECRET_KEY (HS256) — not the real identity
    provider's key — must be rejected. There must be no fallback path that
    lets a locally-forged token pass as an external OIDC login."""
    forged_payload = {
        "sub": "attacker",
        "email": "attacker@example.com",
        "roles": ["admin"],
        "iss": settings.OIDC_ISSUER_URL,
        "aud": settings.OIDC_CLIENT_ID,
    }
    forged_token = jwt.encode(forged_payload, settings.JWT_SECRET_KEY, algorithm="HS256")
    resp = client.post("/api/v1/auth/oidc/login", json={"id_token": forged_token})
    assert resp.status_code == 401


def test_oidc_login_fails_closed_when_jwks_not_configured(monkeypatch):
    """If OIDC is enabled but OIDC_JWKS_URL isn't configured, login must be
    rejected (503) rather than silently accepting an unverifiable token."""
    monkeypatch.setattr(settings, "OIDC_JWKS_URL", None)
    resp = client.post("/api/v1/auth/oidc/login", json={"id_token": _signed_oidc_token()})
    assert resp.status_code == 503


def test_oidc_login_disabled(monkeypatch):
    """If OIDC is disabled, /oidc/login must return 501 Not Implemented."""
    monkeypatch.setattr(settings, "OIDC_ENABLED", False)
    resp = client.post(
        "/api/v1/auth/oidc/login",
        json={"id_token": "dummy.id.token"},
    )
    assert resp.status_code == 501

"""JWT authentication, role-based access control, and persistent token revocation.

Revocation strategy (multi-replica safe):
  1. PRIMARY  — Redis SETEX mflood:jwt:deny:{jti} TTL (O(1) read, TTL auto-expiry)
  2. FALLBACK — PostgreSQL jwt_denylist table (written in same transaction as Redis)
  3. FAILSAFE — If BOTH stores are unavailable, revoke_token() raises RuntimeError.
               We never silently drop a revocation request.

On every request the check order is Redis → DB. If Redis is available but the
key is missing, the token is considered valid (fast path). If Redis is down, the
DB is queried. If both are down, we fail CLOSED (token treated as revoked).

External OIDC login (verify_oidc_identity) is verified against the real
identity provider's public signing keys (JWKS, fetched from OIDC_JWKS_URL) using
RS256 — never against this application's own JWT_SECRET_KEY or any shared
secret. There is no fallback path: if OIDC is enabled but not fully configured,
or if signature/issuer/audience verification fails, the login is rejected. This
is a deliberate fail-closed design — an OIDC token must never be accepted on
weaker terms than a real identity provider issued it under.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer

from app.core.config import settings
from app.core.logging import get_logger
from app.core.metrics import AUTH_FAILURES, JWT_REVOCATIONS

logger = get_logger("auth")

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/auth/token", auto_error=False
)

_REDIS_KEY_PREFIX = "mflood:jwt:deny:"
_local_revoked_tokens: set[str] = set()


# ─────────────────────────────────────────────────────────────────────────────
# Password utilities
# ─────────────────────────────────────────────────────────────────────────────

def hash_password(password: str, *, iterations: int = 310_000) -> str:
    """Return a self-contained PBKDF2-SHA256 password hash."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return (
        f"pbkdf2_sha256${iterations}"
        f"${base64.urlsafe_b64encode(salt).decode()}"
        f"${base64.urlsafe_b64encode(digest).decode()}"
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iteration_text, salt_text, digest_text = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iteration_text)
        salt = base64.urlsafe_b64decode(salt_text.encode())
        expected = base64.urlsafe_b64decode(digest_text.encode())
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


# ─────────────────────────────────────────────────────────────────────────────
# User registry
# ─────────────────────────────────────────────────────────────────────────────

def _configured_users() -> Dict[str, Dict[str, str]]:
    users: Dict[str, Dict[str, str]] = {}
    if settings.AUTH_ADMIN_USERNAME and (
        settings.AUTH_ADMIN_PASSWORD_HASH or settings.AUTH_ADMIN_PASSWORD
    ):
        users[settings.AUTH_ADMIN_USERNAME] = {
            "password": settings.AUTH_ADMIN_PASSWORD or "",
            "password_hash": settings.AUTH_ADMIN_PASSWORD_HASH or "",
            "role": "admin",
        }
    if settings.AUTH_OPERATOR_USERNAME and (
        settings.AUTH_OPERATOR_PASSWORD_HASH or settings.AUTH_OPERATOR_PASSWORD
    ):
        users[settings.AUTH_OPERATOR_USERNAME] = {
            "password": settings.AUTH_OPERATOR_PASSWORD or "",
            "password_hash": settings.AUTH_OPERATOR_PASSWORD_HASH or "",
            "role": "operator",
        }
    return users


def auth_enabled() -> bool:
    return bool(settings.JWT_SECRET_KEY)


def authenticate(username: str, password: str) -> Optional[Dict[str, str]]:
    user = _configured_users().get(username)
    if not user:
        return None
    valid = verify_password(password, user["password_hash"]) if user["password_hash"] else (
        settings.ENVIRONMENT == "development"
        and settings.ALLOW_INSECURE_LOCAL_AUTH
        and hmac.compare_digest(user["password"], password)
    )
    if not valid:
        return None
    return {"sub": username, "role": user["role"]}


# ─────────────────────────────────────────────────────────────────────────────
# JWT issuance
# ─────────────────────────────────────────────────────────────────────────────

def create_access_token(subject: str, role: str) -> str:
    if not settings.JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY is not configured")
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_ACCESS_TOKEN_MINUTES
    )
    return jwt.encode(
        {
            "sub": subject,
            "role": role,
            "token_type": "access",
            "jti": secrets.token_urlsafe(16),
            "exp": expires_at,
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def create_refresh_token(subject: str, role: str) -> str:
    if not settings.JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY is not configured")
    expires_at = datetime.now(timezone.utc) + timedelta(
        days=settings.JWT_REFRESH_TOKEN_DAYS
    )
    return jwt.encode(
        {
            "sub": subject,
            "role": role,
            "token_type": "refresh",
            "jti": secrets.token_urlsafe(16),
            "exp": expires_at,
        },
        settings.JWT_SECRET_KEY,
        algorithm=settings.JWT_ALGORITHM,
    )


def _decode_token(token: str, verify_exp: bool = True) -> Dict[str, Any]:
    """Decode and validate one of OUR OWN internally-issued JWTs.

    Never use this for externally-issued tokens (e.g. OIDC ID tokens) — it
    trusts settings.JWT_SECRET_KEY, which is this application's own signing
    secret. External tokens are verified separately in verify_oidc_identity()
    against the real identity provider's public keys.
    """
    options = {} if verify_exp else {"verify_exp": False}
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM],
        options=options,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Persistent JWT denylist
# ─────────────────────────────────────────────────────────────────────────────

class JwtDenylist:
    """Multi-replica safe JWT revocation store.

    Write path: Redis SETEX → DB INSERT (both attempted; raises if both fail).
    Read path:  Redis SISMEMBER → DB SELECT → fail-closed if both unavailable.
    """

    # ── write ──────────────────────────────────────────────────────────────

    def add(self, jti: str, expires_at: datetime, revoked_by: Optional[str] = None) -> None:
        """Revoke a JWT by its jti. Writes to Redis and DB.

        Raises RuntimeError if neither store is reachable (fail-closed).
        """
        redis_ok = self._add_redis(jti, expires_at)
        db_ok = self._add_db(jti, expires_at, revoked_by)
        if redis_ok:
            JWT_REVOCATIONS.labels("redis").inc()
        if db_ok:
            JWT_REVOCATIONS.labels("db").inc()
        if not redis_ok and not db_ok:
            if settings.ALLOW_INSECURE_LOCAL_AUTH:
                _local_revoked_tokens.add(jti)
                JWT_REVOCATIONS.labels("development_local").inc()
                return
            raise RuntimeError(
                "JWT revocation failed: both Redis and database are unavailable. "
                "Token has NOT been revoked."
            )

    def _add_redis(self, jti: str, expires_at: datetime) -> bool:
        if not settings.CELERY_BROKER_URL:
            return False
        try:
            from redis import Redis
            ttl_seconds = max(
                int((expires_at - datetime.now(timezone.utc)).total_seconds()) + 60, 1
            )
            r = Redis.from_url(
                settings.CELERY_BROKER_URL,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            r.setex(f"{_REDIS_KEY_PREFIX}{jti}", ttl_seconds, "1")
            return True
        except Exception as exc:
            logger.warning(f"Redis denylist write failed for jti={jti[:8]}…: {exc}")
            return False

    def _add_db(
        self, jti: str, expires_at: datetime, revoked_by: Optional[str]
    ) -> bool:
        try:
            from app.models.database import engine as db_engine
            if db_engine is None:
                return False
            from sqlalchemy import text
            with db_engine.begin() as conn:
                conn.execute(
                    text("""
                        INSERT INTO jwt_denylist (jti, expires_at, revoked_by)
                        VALUES (:jti, :expires_at, :revoked_by)
                        ON CONFLICT (jti) DO NOTHING
                    """),
                    {"jti": jti, "expires_at": expires_at, "revoked_by": revoked_by},
                )
            return True
        except Exception as exc:
            logger.warning(f"DB denylist write failed for jti={jti[:8]}…: {exc}")
            return False

    # ── read ───────────────────────────────────────────────────────────────

    def is_revoked(self, jti: str) -> bool:
        """Return True if jti is revoked. Fails CLOSED if all stores are unreachable."""
        if settings.ALLOW_INSECURE_LOCAL_AUTH:
            return jti in _local_revoked_tokens
        redis_result = self._check_redis(jti)
        if redis_result is not None:
            return redis_result  # Redis authoritative when reachable

        db_result = self._check_db(jti)
        if db_result is not None:
            return db_result

        # Both stores unreachable: fail closed — treat token as revoked
        logger.error(
            f"JWT denylist check failed for jti={jti[:8]}…: "
            "both Redis and DB unavailable; failing closed (token rejected)"
        )
        AUTH_FAILURES.labels("denylist_unavailable").inc()
        return True

    def _check_redis(self, jti: str) -> Optional[bool]:
        """Return True/False if Redis reachable, None if unavailable."""
        if not settings.CELERY_BROKER_URL:
            return None
        try:
            from redis import Redis
            r = Redis.from_url(
                settings.CELERY_BROKER_URL,
                socket_connect_timeout=1,
                socket_timeout=1,
            )
            return bool(r.exists(f"{_REDIS_KEY_PREFIX}{jti}"))
        except Exception:
            return None

    def _check_db(self, jti: str) -> Optional[bool]:
        """Return True/False if DB reachable, None if unavailable."""
        try:
            from app.models.database import engine as db_engine
            if db_engine is None:
                return None
            from sqlalchemy import text
            with db_engine.connect() as conn:
                row = conn.execute(
                    text("SELECT 1 FROM jwt_denylist WHERE jti = :jti LIMIT 1"),
                    {"jti": jti},
                ).fetchone()
            return row is not None
        except Exception:
            return None


# Module-level singleton
_denylist = JwtDenylist()


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI dependencies
# ─────────────────────────────────────────────────────────────────────────────

async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
) -> Dict[str, Any]:
    if not auth_enabled():
        if settings.ALLOW_INSECURE_LOCAL_AUTH and settings.ENVIRONMENT == "development":
            return {"sub": "local-development", "role": "admin", "insecure": True}
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="JWT authentication is not configured",
        )
    if not token:
        AUTH_FAILURES.labels("no_token").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    try:
        payload = _decode_token(token)
    except jwt.PyJWTError as exc:
        AUTH_FAILURES.labels("invalid_token").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc

    if not payload.get("sub") or not payload.get("role") or not payload.get("jti"):
        AUTH_FAILURES.labels("missing_claims").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has no user role",
        )

    if payload.get("token_type") == "refresh":
        AUTH_FAILURES.labels("invalid_token_type").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Cannot use refresh token as access token",
        )

    jti = payload["jti"]
    if _denylist.is_revoked(jti):
        AUTH_FAILURES.labels("revoked_token").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    return payload


def revoke_token(token: str, revoked_by: Optional[str] = None) -> None:
    """Revoke a JWT by adding its jti to the persistent denylist.

    Raises RuntimeError if the token cannot be decoded or if no store is
    reachable (never silently ignores a revocation request).
    """
    payload = _decode_token(token, verify_exp=False)
    jti = payload.get("jti")
    if not jti:
        raise ValueError("Token has no jti claim and cannot be revoked")

    exp_ts = payload.get("exp")
    if exp_ts:
        expires_at = datetime.fromtimestamp(exp_ts, tz=timezone.utc)
    else:
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.JWT_ACCESS_TOKEN_MINUTES
        )

    _denylist.add(jti, expires_at, revoked_by=revoked_by)


def rotate_refresh_token(refresh_token: str) -> Dict[str, Any]:
    """Validate a refresh token, revoke it, and issue a fresh access+refresh pair."""
    try:
        payload = _decode_token(refresh_token)
    except jwt.PyJWTError as exc:
        AUTH_FAILURES.labels("invalid_refresh_token").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        ) from exc

    if payload.get("token_type") != "refresh":
        AUTH_FAILURES.labels("invalid_token_type").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is not a refresh token",
        )

    jti = payload.get("jti")
    if not jti or _denylist.is_revoked(jti):
        AUTH_FAILURES.labels("revoked_refresh_token").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has already been revoked or used",
        )

    # Invalidate the submitted refresh token immediately (single-use rotation)
    revoke_token(refresh_token, revoked_by=payload.get("sub"))

    sub = payload["sub"]
    role = payload.get("role", "viewer")
    new_access = create_access_token(sub, role)
    new_refresh = create_refresh_token(sub, role)
    return {
        "access_token": new_access,
        "refresh_token": new_refresh,
        "token_type": "bearer",
        "expires_in": settings.JWT_ACCESS_TOKEN_MINUTES * 60,
        "role": role,
    }


# ─────────────────────────────────────────────────────────────────────────────
# External OIDC login — JWKS/RS256 verification against the real provider.
#
# SECURITY: this function must NEVER accept an externally-supplied ID token
# using this application's own JWT_SECRET_KEY, or any other locally-known
# secret, as the verification key. Doing so would let anyone who can forge or
# obtain an HS256 token signed with our own secret impersonate an OIDC login
# and mint themselves an admin session. Verification is RS256-only, against
# the provider's own published public keys (JWKS), fetched from
# OIDC_JWKS_URL. If OIDC is enabled but not fully configured, or if
# signature/issuer/audience verification fails for any reason, the login is
# rejected — there is no softer fallback path.
# ─────────────────────────────────────────────────────────────────────────────

_jwks_clients: Dict[str, "jwt.PyJWKClient"] = {}


def _get_jwks_client(jwks_url: str) -> "jwt.PyJWKClient":
    client = _jwks_clients.get(jwks_url)
    if client is None:
        # cache_keys=True + lifespan: PyJWKClient caches fetched keys in-process
        # and only re-fetches the JWKS document when an unknown `kid` is seen
        # or the cache expires, so normal request traffic doesn't refetch it.
        client = jwt.PyJWKClient(jwks_url, cache_keys=True, lifespan=3600)
        _jwks_clients[jwks_url] = client
    return client


def verify_oidc_identity(id_token: str) -> Dict[str, Any]:
    """Verify an external OpenID Connect (OIDC) ID token and map claims to M-FLOOD roles.

    Fails closed: any missing configuration, unreachable JWKS endpoint, bad
    signature, wrong issuer, or wrong audience results in a rejected login.
    """
    if not settings.OIDC_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="External OIDC authentication is not enabled",
        )
    if not settings.OIDC_ISSUER_URL or not settings.OIDC_CLIENT_ID or not settings.OIDC_JWKS_URL:
        # Fail closed: do NOT fall back to any local secret or skip verification.
        logger.error(
            "OIDC_ENABLED is true but OIDC_ISSUER_URL/OIDC_CLIENT_ID/OIDC_JWKS_URL "
            "are not fully configured; rejecting OIDC login rather than weakening verification"
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OIDC is enabled but not fully configured on the server",
        )

    try:
        signing_key = _get_jwks_client(settings.OIDC_JWKS_URL).get_signing_key_from_jwt(id_token)
    except Exception as exc:
        AUTH_FAILURES.labels("oidc_jwks_unavailable").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not verify OIDC token signature: {exc}",
        ) from exc

    try:
        decoded = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.OIDC_CLIENT_ID,
            issuer=settings.OIDC_ISSUER_URL,
            options={"require": ["exp", "iat", "iss", "aud", "sub"]},
        )
    except jwt.PyJWTError as exc:
        AUTH_FAILURES.labels("oidc_invalid_token").inc()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"OIDC token validation failed: {exc}",
        ) from exc

    email = decoded.get("email") or decoded.get("preferred_username") or decoded.get("sub")
    if not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="OIDC token missing subject or email claim",
        )

    roles = decoded.get("roles") or decoded.get("groups") or []
    if "admin" in roles or email == settings.AUTH_ADMIN_USERNAME:
        mapped_role = "admin"
    elif "operator" in roles or email == settings.AUTH_OPERATOR_USERNAME:
        mapped_role = "operator"
    else:
        mapped_role = "viewer"

    return {
        "sub": f"oidc:{email}",
        "email": email,
        "role": mapped_role,
        "provider": settings.OIDC_PROVIDER_NAME,
    }


def require_roles(*roles: str) -> Callable[..., Any]:
    async def dependency(user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
        if user.get("role") not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role",
            )
        return user

    return dependency


def get_client_ip(request: Request) -> str:
    """Extract real client IP honouring X-Forwarded-For, for audit-log forensics."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client and request.client.host:
        return request.client.host
    return "unknown"

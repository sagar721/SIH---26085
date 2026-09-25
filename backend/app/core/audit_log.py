"""Structured audit logging for auth events, admin actions, and simulation triggers.

Every security-relevant event is written to the audit_log table (created in
migration 0003). Failures are logged but never swallowed silently — if the DB is
unavailable, audit logging degrades to structured stderr logging only, and
a warning counter is incremented in Prometheus.
"""

from __future__ import annotations

import traceback
from datetime import datetime, timezone
from typing import Any, Optional

from app.core.logging import get_logger
from app.core.metrics import AUDIT_LOG_ERRORS

logger = get_logger("audit_log")


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def log_auth_event(
    event_type: str,
    *,
    username: Optional[str] = None,
    role: Optional[str] = None,
    ip_address: Optional[str] = None,
    success: bool = True,
    detail: Optional[str] = None,
    jti: Optional[str] = None,
    simulation_id: Optional[str] = None,
) -> None:
    """Write an audit event to the persistent audit_log table.

    Falls back to structured stderr log if the database is unavailable.
    Never raises — audit logging must not break the request path.

    Args:
        event_type: One of TOKEN_ISSUED, TOKEN_REVOKED, TOKEN_REFRESHED,
            OIDC_LOGIN, AUTH_FAILED, AUTH_SUCCESS, ADMIN_ACTION,
            SIMULATION_TRIGGERED.
        username: Authenticated username (may be None for unauthenticated failures).
        role: User role at time of event.
        ip_address: Client IP for forensics.
        success: Whether the action succeeded.
        detail: Free-text detail for humans and automated analysis.
        jti: JWT token ID, for token lifecycle correlation.
        simulation_id: Simulation UUID for SIMULATION_TRIGGERED events.
    """
    entry: dict[str, Any] = {
        "event_type": event_type,
        "username": username,
        "role": role,
        "ip_address": ip_address,
        "success": success,
        "detail": detail,
        "jti": jti,
        "simulation_id": simulation_id,
        "created_at": _now_utc(),
    }

    # Always emit to structured log (captured by JSON formatter in production)
    log_fn = logger.info if success else logger.warning
    log_fn(
        "AUDIT",
        extra={
            "audit_event": event_type,
            "audit_username": username,
            "audit_role": role,
            "audit_ip": ip_address,
            "audit_success": success,
            "audit_detail": detail,
            "audit_jti": jti,
            "audit_simulation_id": simulation_id,
        },
    )

    # Persist to DB (best-effort; never block the request)
    try:
        from app.models.database import engine as db_engine
        if db_engine is not None:
            from sqlalchemy import text
            with db_engine.begin() as conn:
                conn.execute(
                    text("""
                        INSERT INTO audit_log
                            (event_type, username, role, ip_address, success,
                             detail, jti, simulation_id, created_at)
                        VALUES
                            (:event_type, :username, :role, :ip_address, :success,
                             :detail, :jti, :simulation_id, :created_at)
                    """),
                    {
                        "event_type": entry["event_type"],
                        "username": entry["username"],
                        "role": entry["role"],
                        "ip_address": entry["ip_address"],
                        "success": entry["success"],
                        "detail": entry["detail"],
                        "jti": entry["jti"],
                        "simulation_id": entry["simulation_id"],
                        "created_at": entry["created_at"],
                    },
                )
    except Exception as exc:
        logger.error(
            f"audit_log DB write failed for event_type={event_type}: {exc}",
            extra={"audit_db_error": traceback.format_exc()},
        )
        AUDIT_LOG_ERRORS.inc()

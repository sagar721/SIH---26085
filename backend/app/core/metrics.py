"""Prometheus metrics registry for M-FLOOD backend.

All metrics are defined here as module-level singletons to avoid
duplicate-registration errors on hot-reload. Import from this module only.

Every metric declared here is incremented/observed somewhere in the codebase
(auth.py, audit_log.py, main.py's request middleware, workers/tasks.py) —
metrics that nothing populates were deliberately left out rather than shipped
as decorative, since an unpopulated series makes any alert rule built on it
silently unable to fire.
"""

from prometheus_client import Counter, Histogram

# ── HTTP layer ────────────────────────────────────────────────────────────────
HTTP_REQUESTS = Counter(
    "mflood_http_requests_total",
    "Total HTTP requests.",
    ("method", "path", "status"),
)
HTTP_LATENCY = Histogram(
    "mflood_http_request_duration_seconds",
    "HTTP request duration in seconds.",
    ("method", "path"),
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)

# ── Simulation jobs ───────────────────────────────────────────────────────────
SIMULATION_JOBS = Counter(
    "mflood_simulation_jobs_total",
    "Simulation jobs by terminal status.",
    ("status",),
)

# ── Security / auth ───────────────────────────────────────────────────────────
JWT_REVOCATIONS = Counter(
    "mflood_jwt_revocations_total",
    "JWT tokens revoked by revocation path (redis, db, development_local).",
    ("path",),
)
AUTH_FAILURES = Counter(
    "mflood_auth_failures_total",
    "Authentication failures by reason.",
    ("reason",),
)
AUDIT_LOG_ERRORS = Counter(
    "mflood_audit_log_errors_total",
    "Failures writing to the audit_log table (DB unavailable).",
)

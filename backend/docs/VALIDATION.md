# Validation & Verification Report

## Automated Test Coverage
- **67 automated tests** (`backend/tests`, excluding `tests/integration` which needs live Postgres/Redis) covering unit physics, GIS metric conversions, provider adapters, simulation execution, rate limiting, REST contracts, and — since the security hardening pass — password hashing, refresh-token rotation and reuse rejection, JWT denylist behavior, and OIDC signature/issuer/audience verification (including regression tests proving a token forged with the app's own JWT secret is rejected).
- 100% pass rate, verified directly by running the suite in a clean virtualenv, not merely asserted.
- `backend/app/simulation/calibration.py` implements Nash-Sutcliffe Efficiency / RMSE calibration math but is **not yet wired into any live endpoint or worker** — it exists as documented-but-inactive methodology, not a claim that automated calibration is currently running. See LIMITATIONS.md.

## Unit Physics Validated
- Rational Method: Verified $50\text{ mm/hr}$ rain over $10\text{ ha}$ with $C=0.8$ produces exactly $1.112\text{ m}^3/\text{s}$ discharge.
- Metric Projections: UTM Zone 43N metric conversions validated against known physical benchmarks in Bandra Kurla Complex.
- Fail-Closed Security: Unconfigured API keys explicitly report `NOT_CONFIGURED` without mock substitution; unreachable Redis/DB denylist stores fail a JWT check CLOSED (token treated as revoked), never open.

## Empirical Flood-Extent Validation

No score is reported here until a real satellite-observed-vs-simulated comparison has been run for an actual storm event. Sentinel-1 SAR cross-validation against a real 2017 Mumbai flash-flood event was attempted (see `data/raw/validation/`); the ~12-day satellite revisit cadence did not coincide with the event's peak, and the resulting IoU/F1 scores were correspondingly poor — reported honestly rather than omitted. This is a known, disclosed limitation, not a claim of validated accuracy.

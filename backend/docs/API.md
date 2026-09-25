# M-FLOOD API Specification (v1)

Base URL: `/api/v1`  
Interactive Documentation: `/docs` (Swagger UI) & `/redoc` (ReDoc)

---

## 1. System Health & Probes
- `GET /api/v1/health`: Basic operational status and version.
- `GET /api/v1/health/live`: Kubernetes liveness probe (HTTP 200).
- `GET /api/v1/health/ready`: Kubernetes readiness probe — validates database, Redis, Celery worker, and provider availability together; returns HTTP 503 with a per-dependency status breakdown if any are down. Each dependency degrades gracefully (`NOT_CONFIGURED` when intentionally unset, e.g. local development, vs. `UNAVAILABLE: <reason>` when configured but unreachable).

## 1a. Authentication
- `POST /api/v1/auth/token`: Username/password login (PBKDF2-hashed). Returns a short-lived access token and a refresh token.
- `POST /api/v1/auth/refresh`: Single-use refresh-token rotation — the submitted refresh token is immediately revoked and a fresh access+refresh pair is issued.
- `POST /api/v1/auth/oidc/login`: External OIDC login — the ID token is verified against the real identity provider's JWKS (RS256), never against any locally-known secret.
- `POST /api/v1/auth/revoke`: Revokes the caller's current access token (written to the durable Redis+Postgres denylist).

## 2. Providers, Weather & Rainfall
- `GET /api/v1/providers`: Health status and audit of all external providers.
- `GET /api/v1/weather/current`: Current weather conditions from Open-Meteo for the configured study area.
- `GET /api/v1/weather/forecast`: 48-hour hourly precipitation forecast time-series.
- `GET /api/v1/rainfall/current`: Normalized corridor rainfall rate and current intensity.
- `GET /api/v1/rainfall/forecast`: 24-hour projected rainfall accumulation and peak intensity timeline.

## 3. Municipal GIS Features
- `GET /api/v1/gis/roads`: Road network GeoJSON for the study area (OpenStreetMap).
- `GET /api/v1/gis/buildings`: Building footprint polygons (OpenStreetMap).
- `GET /api/v1/gis/drains`: Storm water drainage network geometry (BMC GIS).
- `GET /api/v1/gis/manholes`: Storm water manholes (BMC GIS).
- `GET /api/v1/gis/flooding-spots`: Documented municipal chronic flood hotspots (BMC GIS).
- `GET /api/v1/gis/critical-infrastructure`: Hospitals, police stations, fire stations (BMC GIS).
- `GET /api/v1/gis/water-bodies`: River channels and waterways (OpenStreetMap).

## 4. Drainage Hydraulics
- `GET /api/v1/drainage`: Raw drainage network attributes with traceable capacity tags.
- `GET /api/v1/drainage/utilization`: Network hydraulic stress test using Rational Method runoff under supplied rainfall intensity.
- `GET /api/v1/drainage/overloaded`: Drainage segments exceeding design discharge capacity.
- `GET /api/v1/drainage/{drain_id}`: Attributes and capacity for an individual drainage segment.

## 5. Simulation Jobs & Timeline
- `POST /api/v1/simulation/run`: Submits an asynchronous coupled simulation with an explicit `mode` (`LIVE` — current observation, rejects stale/unavailable data; `FORECAST` — hourly provider forecast; `SCENARIO` — an explicit `scenario_rainfall_mm_hr` value, no live provider call required). Identical in-flight requests are deduplicated via a config hash rather than launching redundant work. Returns HTTP 202 with `simulation_id` and `status: QUEUED`, or 503 if the Celery broker is unavailable.
- `GET /api/v1/simulation/{id}/status`: Polls execution status (`QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`).
- `GET /api/v1/simulation/{id}/timeline`: Returns 3D-ready time-indexed spatial steps with extruded water depths for CesiumJS animation.

## 6. Derived Flood Results
- `GET /api/v1/flood/depth`: GeoJSON FeatureCollection of inundated grid cells and water depths.
- `GET /api/v1/flood/risk`: Risk summary breakdown (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`), peak depth, and timeline.
- `GET /api/v1/flood/affected-roads`: GeoJSON LineStrings of roads with water depths $\ge 0.05$m. Labeled `DERIVED FLOOD-IMPACT ESTIMATE`.
- `GET /api/v1/flood/critical-locations`: GeoJSON Points of impacted emergency infrastructure.

## 7. Flood-Aware Routing
- `POST /api/v1/routing/safe-route`: Dijkstra safe pathfinding avoiding roads exceeding critical flood depth ($\ge 0.30$m).
- `GET /api/v1/routing/network-status`: Road network topological graph size and CRS projection status.

## 8. Operational Alerts
- `GET /api/v1/alerts`: Active derived flood-risk alerts.
- `GET /api/v1/alerts/critical`: High-priority critical alerts ($\ge 0.30$m depth or hospital inundation).
- `GET /api/v1/alerts/{id}`: Detailed alert metadata and coordinates.

## 9. Provenance & Live Updates
- `GET /api/v1/provenance`: Data source lineage, model formulations, and prototype assumptions.
- `WS /api/v1/ws/updates`: WebSocket streaming live provider updates, simulation lifecycles, and critical alerts.

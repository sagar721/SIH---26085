# M-FLOOD — Mumbai Urban Flood Nowcasting & Drainage Intelligence Platform

> **Ministry of Earth Sciences (MoES) — SIH26085**  
> Urban Flood Nowcasting System (Drainage and Rainfall Coupling)  
> Primary Study Area: Mumbai, Maharashtra (Kurla / BKC / Mithi River Basin)

---

## 🏛️ Architecture & Physics Pipeline

```text
WEATHER OBSERVATIONS & FORECAST (Open-Meteo / Scenario)
                         ↓
    RATIONAL METHOD RUNOFF (Q = 0.00278 * C * I * A)
                         ↓
    DRAINAGE CAPACITY & OVERFLOW (overflow = max(Q - C, 0))
                         ↓
    2.5D TERRAIN INUNDATION (Mass-Balance Volume Redistribution)
                         ↓
    SPATIAL ROAD NETWORK OVERLAY (OSM Road Inundation Depths)
                         ↓
    CRITICAL INFRASTRUCTURE EXPOSURE (Hospitals & Fire Stations)
                         ↓
    DYNAMIC FLOOD-AWARE ROUTING & OPERATIONAL ALERTS
```

---

## 🚀 Quick Start (Local)

1. **Activate Virtual Environment & Install Dependencies**:
   ```powershell
   .\.venv\Scripts\python -m pip install -r requirements.txt
   .\.venv\Scripts\python scripts/check_deps.py   # optional sanity check that everything installed correctly
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env`. Without `DATABASE_URL`, simulation jobs and alerts persist in SQLite at `RUNTIME_STORE_PATH` (default: `data/runtime_store.db`). With `DATABASE_URL`, the runtime store uses the configured PostgreSQL database.

   The inundation engine uses a finite-volume local-inertial 2D prototype with explicit tidal boundary stage input through `TIDAL_STAGE_M`. It is mass-conserving across cell interfaces but still requires calibration before operational use.

3. **Start Application Server**:
   ```powershell
   .\.venv\Scripts\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   Runs with `ENVIRONMENT=development` by default, so no database, Redis, or Celery is required to boot — everything degrades gracefully to `NOT_CONFIGURED`. Scheduled weather/data refresh loops run in-process automatically (`RUN_SCHEDULED_REFRESHES_IN_API` defaults to `True`); no extra setup needed.

4. **Run Automated Test Suite**:
   ```powershell
   .\.venv\Scripts\python -m pytest -v
   ```

Interactive Swagger documentation is available at `http://localhost:8000/docs`.

---

## 🐳 Docker & Multi-Container Deployment

```bash
docker compose up --build
```

Brings up PostGIS, Redis, the API, a Celery worker, and a dedicated `scheduler` service that runs the weather/data refresh loops as its own process (`RUN_SCHEDULED_REFRESHES_IN_API=false` in this stack, so they aren't started twice). This split is optional and production-oriented — it only applies inside `docker-compose.yml`; a plain local run (step 3 above) keeps the simpler single-process default with zero extra setup.

Health probes:
- Liveness: `GET /api/v1/health/live` (HTTP 200 — process is responsive)
- Readiness: `GET /api/v1/health/ready` (HTTP 200 only when database, Redis, a live Celery worker, and at least one data provider are ALL reachable; 503 with a per-dependency status breakdown otherwise). In `ENVIRONMENT=production`, the server additionally **refuses to start at all** unless the database and Redis are reachable at boot — this startup gate never applies to `ENVIRONMENT=development` (the default), so local development and any demo that doesn't explicitly set `ENVIRONMENT=production` are never blocked by it.
- Metrics: `GET /metrics` (Prometheus exposition format) — see `monitoring/` for ready-to-use Prometheus scrape config, alert rules, and a Grafana dashboard.

CI: `.github/workflows/backend-integration.yml` (at the repo root) runs the test suite on every push/PR touching `backend/**`, plus a full `docker compose` integration job that boots the whole stack, applies migrations, and exercises a real end-to-end simulation.

---

## 📡 Frontend API Contract

| Endpoint | Method | Description |
| :--- | :---: | :--- |
| `/api/v1/auth/token` | `POST` | Username/password login (PBKDF2-hashed) — returns an access + refresh token pair. |
| `/api/v1/auth/refresh` | `POST` | Single-use refresh-token rotation. |
| `/api/v1/auth/oidc/login` | `POST` | External OIDC login, verified against the provider's real JWKS. |
| `/api/v1/auth/revoke` | `POST` | Revoke the caller's current token. |
| `/api/v1/health` | `GET` | Application health and version. |
| `/api/v1/providers` | `GET` | Live health and availability audit of all external providers. |
| `/api/v1/weather/current` | `GET` | Current weather from Open-Meteo for the Mumbai study area. |
| `/api/v1/weather/forecast` | `GET` | 48-hour hourly rainfall forecast time-series. |
| `/api/v1/gis/roads` | `GET` | OpenStreetMap road network geometry. |
| `/api/v1/gis/drains` | `GET` | BMC Mumbai storm water drainage network. |
| `/api/v1/gis/critical-infrastructure` | `GET` | BMC hospitals, police stations, and fire stations. |
| `/api/v1/simulation/run` | `POST` | Asynchronously trigger a coupled rainfall-to-inundation simulation (requires a Bearer token; `admin` or `operator` role). |
| `/api/v1/simulation/{id}/status` | `GET` | Check simulation job status (`QUEUED`, `RUNNING`, `COMPLETED`). |
| `/api/v1/simulation/{id}/timeline` | `GET` | 3D-ready time-indexed spatial steps for CesiumJS animation. |
| `/api/v1/flood/depth` | `GET` | GeoJSON polygons of inundated grid cells with water depths. |
| `/api/v1/flood/risk` | `GET` | Risk breakdown (`LOW`, `MODERATE`, `HIGH`, `CRITICAL`) and statistics. |
| `/api/v1/flood/affected-roads` | `GET` | Road segments inundated by flood waters. |
| `/api/v1/flood/critical-locations` | `GET` | Emergency facilities exposed to water hazard. |
| `/api/v1/routing/safe-route` | `POST` | Flood-aware Dijkstra pathfinding avoiding roads with depth $\ge 0.30$m. |
| `/api/v1/alerts` | `GET` | Active system-generated derived flood-risk alerts. |
| `/api/v1/provenance` | `GET` | Data lineage, model formulas, and prototype assumptions. |
| `/api/v1/ws/updates` | `WS` | Live WebSocket event stream (simulations, provider status, alerts). |

---

## 📚 Technical Documentation

Detailed technical specifications are located in the `docs/` directory:
- [docs/API.md](docs/API.md) — Comprehensive API endpoint reference.
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) — Provider lineage, coverage, and refresh intervals.
- [docs/MODEL.md](docs/MODEL.md) — Rational Method, drainage overflow, and the local-inertial 2D inundation solver.
- [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md) — Documented prototype engineering assumptions.
- [docs/VALIDATION.md](docs/VALIDATION.md) — Automated test coverage and empirical validation status.
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md) — Disclaimers and operational boundaries.
- [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md) — ODbL, CC-BY 4.0, and municipal source licenses.

See [`PROJECT_MASTER_DOCUMENTATION.md`](../PROJECT_MASTER_DOCUMENTATION.md) at the repository root for the full project — frontend, backend, Demo Mode, security architecture, and deployment — in one place.

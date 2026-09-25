# SIH26085 — Urban Flood Nowcasting System

An open, explainable urban flood-intelligence prototype for **Mumbai** (Smart India Hackathon 2026, problem statement **SIH26085**). It couples rainfall, terrain, drainage capacity and road/infrastructure data into a flood simulation, flood-aware safe routing, and a decision-support dashboard. The project is referred to in code and docs as **FLOODCAST** (frontend/data pipeline) and **M-FLOOD** (backend).

> **Status: hackathon prototype.** Several parts are simulations or approximations, and this README says which. See [Implementation status](#implementation-status) and [Limitations](#limitations).

---

## Table of contents

1. [Overview](#1-project-overview) · 2. [Problem statement](#2-smart-india-hackathon-problem-statement) · 3. [Problem solved](#3-problem-being-solved) · 4. [Objectives](#4-objectives) · 5. [Pilot area](#5-targetpilot-area) · 6. [Features](#6-key-features) · 7. [Architecture](#7-system-architecture) · 8. [Tech stack](#8-technology-stack) · 9. [Data sources](#9-data-sources) · 10. [Methodology](#10-aiml--prediction-methodology) · 11. [Workflow](#11-flood-risk-workflow) · 12. [Digital twin](#12-digital-twin) · 13. [Geospatial](#13-mapgeospatial-functionality) · 14. [Safe routes](#14-safe-route-functionality) · 15. [Backend/API](#15-backendapi-architecture) · 16. [Database](#16-database-architecture) · 17. [Structure](#17-project-structure) · 18–22. [Setup & run](#18-local-setup) · 23. [Testing](#23-testing) · 24. [Deployment](#24-deployment) · 25. [Screenshots](#25-screenshotsdemo) · 26. [Team](#26-team) · 27. [Future scope](#27-future-scope) · 28. [License](#28-license)

---

## 1. Project overview

The repository contains two independently runnable halves plus a data pipeline:

| Part | Location | What it is |
|---|---|---|
| **Frontend** | [`frontend/`](frontend) | React + TypeScript + MapLibre dashboard (the product surface). Runs entirely client-side against static data files. |
| **Backend** | [`backend/`](backend) | FastAPI service with a server-side hydrologic simulation, flood-aware routing, JWT auth, persistence, and monitoring config. |
| **Data pipeline** | [`data/`](data) | Python scripts that download/process DEM, OSM, drainage, landcover and rainfall data into the static files the frontend ships. |

**Important:** the frontend does **not** call the backend. It reads pre-computed files under `frontend/public/data/` (Live Mode) or runs a self-contained synthetic engine (Demo Mode). The backend is a separately tested service that implements the same class of methodology server-side. (Verified: no `/api/v1` or backend URL is referenced in `frontend/src`.)

## 2. Smart India Hackathon problem statement

**SIH26085 — Urban Flood Nowcasting System (Drainage and Rainfall Coupling)**, Ministry of Earth Sciences (MoES), as recorded in [`backend/README.md`](backend/README.md). Primary study area: Mumbai, Maharashtra.

## 3. Problem being solved

Mumbai floods most monsoons. Authority-facing systems exist (MCGM's BRIMSTOWAD storm-water plan, MoES iFLOWS-Mumbai), but per the project's own research notes ([`PROJECT_MASTER_DOCUMENTATION.md`](PROJECT_MASTER_DOCUMENTATION.md) §2) they are not openly accessible to citizens and do not publicly expose what-if scenario simulation, flood-aware routing, or transparent data provenance. This project explores those four gaps. It does **not** claim to out-predict official systems.

## 4. Objectives

- Couple rainfall to drainage capacity and overland flooding in a transparent, documented model.
- Show flood impact on roads and critical infrastructure (hospitals, police, fire stations, etc.).
- Provide flood-aware safe routing that explains what it avoided and why.
- Let users explore hypothetical scenarios (rainfall multiplier, drain blockage).
- Label every number with its provenance (real / modelled / inferred / synthetic) and disclose limits honestly.

## 5. Target/pilot area

Greater Mumbai, with two pilot zones in the frontend: **Kurla–Sion–Chunabhatti** and **Hindmata–Dadar–Parel** (Mithi River basin / Kurla–BKC corridor). The backend's configured study area is the Mithi River – Kurla – Kalina – BKC corridor (`backend/config/study_area.json`, bbox 72.850–72.895°E, 19.055–19.115°N).

## 6. Key features

See [Implementation status](#implementation-status) for the implemented / prototype / planned breakdown.

- Interactive map (MapLibre GL) with flood, drainage, roads, buildings (3D in zone view), critical infrastructure and rainfall layers.
- **Live Mode** (pre-computed real data) and **Demo Mode** (synthetic scenario engine with 4 storm presets).
- Flood-aware routing (fastest / safest / balanced) with a flood-blind comparison route.
- Free-text place search (local landmark index, then Nominatim fallback).
- Command Center and mobile-first Citizen views.
- Analytics, Methodology, Data Provenance and Validation modals.
- Backend: async simulation jobs (Celery), REST API, WebSocket updates, JWT auth with refresh rotation and optional OIDC, audit log, Prometheus metrics.

## 7. System architecture

```text
 Frontend (React/Vite)                          Backend (FastAPI)
 ┌───────────────────────────┐                 ┌────────────────────────────────┐
 │ Live Mode  → static data  │                 │ /api/v1: auth, weather, GIS,   │
 │ Demo Mode  → synthetic    │   (not wired)   │ drainage, simulation, flood,   │
 │              engine       │ ◄─────────────► │ routing, alerts, provenance    │
 └────────────┬──────────────┘                 └───────────────┬────────────────┘
              │                                                │
   frontend/public/data/*  ◄── data/scripts/*.py       PostgreSQL/PostGIS · Redis · Celery
   (GeoJSON, PNG, JSON)        (DEM, OSM, MCGM, ...)   (optional; falls back to SQLite/in-process)
```

Backend layering: `api/v1/endpoints` → `services` → `simulation` (pure physics) → `data_sources` (provider adapters). Workers: `app/workers` (Celery tasks + refresh loops).

## 8. Technology stack

**Frontend** (from `frontend/package.json`): React 19, TypeScript, Vite 8, Zustand, MapLibre GL, Tailwind CSS 4, Framer Motion, date-fns, lucide-react; linting with oxlint.

**Backend** (from `backend/requirements.txt`): FastAPI, Uvicorn, Pydantic Settings, SQLAlchemy 2, GeoAlchemy2, psycopg 3, Alembic, Celery (Redis), Shapely, PyProj, NetworkX, SciPy, PyJWT, cryptography, prometheus-client.

**Data pipeline** (root `requirements.txt`): NumPy, pandas, rasterio, geopandas, Shapely, PyProj, Pillow, SciPy, python-dotenv, requests.

**Infra:** Docker / Docker Compose (PostGIS, Redis, API, worker, scheduler), GitHub Actions CI.

## 9. Data sources

Sources are catalogued in [`backend/docs/DATA_SOURCES.md`](backend/docs/DATA_SOURCES.md), [`data/data_manifest.json`](data/data_manifest.json) and the verified-sources sheet `Mumbai_SIH26085_Verified_Data_Sources_2.xlsx`.

| Layer | Source | Notes |
|---|---|---|
| Terrain | Copernicus GLO-30 DEM (via OpenTopography) | Requires an API key to re-download |
| Roads, buildings, waterways | OpenStreetMap (Overpass) | ODbL |
| Drains, manholes, flooding spots, critical infrastructure | MCGM/BMC ArcGIS REST services | Official underground pipe data is **not** published |
| Rainfall (frontend) | JAXA GSMaP hourly grid | The bundled 2026-09-06 window is dry (0 mm) |
| Rainfall / weather (backend adapters) | Open-Meteo, Tomorrow.io, IMD, IMD radar, NASA GPM IMERG, MCGM gauges | Adapters report `NOT_CONFIGURED`/`UNAVAILABLE` when no credential is set; nothing is fabricated |
| Landcover | ESA WorldCover | Used for the susceptibility score |
| Basemap | Esri World Imagery tiles | No key required |
| Geocoding / fallback routing | Nominatim, OSRM public demo server | External; fallback only |

## 10. AI/ML & prediction methodology

**No machine-learning model is implemented.** A search of the frontend, backend and data scripts finds no ML framework. Predictions come from a physics-based pipeline:

1. **Rational Method runoff:** `Q = 0.00278 · C · I · A`
2. **Drainage overflow:** `max(Q_runoff − Q_capacity, 0)`; capacity comes from source attributes or an explicit `DRAINAGE_OUTFALL_CAPACITY_M3S` setting (no hard-coded fallback).
3. **Inundation:** a prototype **local-inertial 2D finite-volume** overland-flow solver (`backend/app/simulation/inundation.py`) with a tidal boundary stage and a mass-balance-error diagnostic.
4. **Impact:** geometric intersection (Shapely) of flood extent with OSM roads and BMC infrastructure.

Details: [`backend/docs/MODEL.md`](backend/docs/MODEL.md), [`ASSUMPTIONS.md`](backend/docs/ASSUMPTIONS.md).

Also implemented: a DEM-based flood-susceptibility score and D8 flow-direction drainage inference (`data/scripts/`), and a sensitivity analysis script. The "nowcasting" aspect is limited to running the simulation from live/forecast weather inputs (`LIVE` / `FORECAST` / `SCENARIO` modes); there is no statistical or ML nowcast model.

## 11. Flood-risk workflow

```text
Rainfall (observed / forecast / scenario)
  → runoff (Rational Method)
  → drainage capacity vs. runoff → overflow
  → terrain-redistributed inundation depth
  → road + critical-infrastructure impact
  → flood-aware routing and alerts
```

Backend runs this as an async job (`POST /api/v1/simulation/run` → poll `/{id}/status` → `/{id}/timeline`). The frontend Demo Mode runs a simplified deterministic version client-side (`frontend/src/lib/demoEngine.ts`).

## 12. Digital twin

**Not implemented as a digital twin.** The word does not appear anywhere in the source. What exists is a map-based simulation viewer: a scenario simulation over real terrain/roads/buildings with a timeline player and 3D-extruded buildings (MapLibre). It is not synchronized with live sensors, does not assimilate observations, and is not calibrated against observed hydrographs. Note the backend's timeline endpoint mentions "CesiumJS"-compatible output naming, but **CesiumJS is not used** by the frontend (it is not a dependency).

## 13. Map/geospatial functionality

- MapLibre GL map with Esri satellite basemap; layers for boundary, water, roads, buildings (3D in zone view), critical infrastructure, rainfall, drainage graph, flood simulation and routing. Layers are clickable with provenance-labelled popups.
- Terrain-RGB tiles, slope/elevation and landcover rasters generated by `data/scripts/`.
- Backend GIS endpoints (`/api/v1/gis/*`): drains, manholes, flooding spots, critical infrastructure, roads, buildings, water bodies.

## 14. Safe-route functionality

Implemented in `frontend/src/lib/routingEngine.ts`, `computeSafeRoute.ts`, `geocoding.ts`, `externalRouting.ts`, and server-side in `backend/app/routing/` (`POST /api/v1/routing/safe-route`).

- Dijkstra over the OSM road graph with three cost modes: fastest, safest, balanced; blocked roads excluded; comparison against a flood-blind baseline; avoided-roads and risk-reduction reporting.
- Frontend fallback chain: local graph → wider snap tolerance → OSRM public server (labelled *not flood-aware*).
- ETA uses assumed road-class speeds, not real traffic.

## 15. Backend/API architecture

FastAPI, versioned under `/api/v1`. Router groups (from `backend/app/api/v1/api.py`): Health (`/health`, `/health/live`, `/health/ready`), Auth (`/auth/token`, `/refresh`, `/oidc/login`, `/revoke`), Providers, Weather, Rainfall, GIS, Drainage, Simulation, Flood (`/depth`, `/risk`, `/affected-roads`, `/critical-locations`), Routing (`/safe-route`, `/network-status`), Alerts, Provenance, and a WebSocket at `/api/v1/ws/updates`. Also `GET /metrics` (Prometheus). Full reference: [`backend/docs/API.md`](backend/docs/API.md); interactive docs at `/docs` when running.

Security features present in code: PBKDF2-SHA256 password hashing, single-use refresh rotation, JWT denylist (Redis + Postgres, fail-closed), OIDC verification via JWKS, audit logging, rate limiting, role checks for `/simulation/run`.

## 16. Database architecture

- SQLAlchemy models in `backend/app/models/`; Alembic migrations in `backend/alembic/versions/`: `0001_initial_schema`, `0002_initial_runtime_tables` (persistent simulations/alerts, PostGIS), `0003_add_audit_log_table`, `0004_add_jwt_denylist_table`.
- With `DATABASE_URL` set → PostgreSQL/PostGIS. Without it → SQLite runtime store (`backend/data/runtime_store.db`, git-ignored) and in-memory fallbacks.
- Redis is used for Celery and the JWT denylist (optional in development).

## 17. Project structure

```text
.
├── backend/
│   ├── app/            # FastAPI app: api, services, simulation, routing, data_sources, workers, models
│   ├── alembic/        # database migrations
│   ├── config/         # study_area.json, thresholds.json, providers.json
│   ├── docs/           # API, MODEL, ASSUMPTIONS, LIMITATIONS, VALIDATION, DATA_SOURCES, ATTRIBUTION
│   ├── monitoring/     # Prometheus rules + Grafana dashboard
│   ├── scripts/        # run/init/ingest helpers
│   ├── tests/          # pytest suite
│   ├── Dockerfile · docker-compose.yml · requirements.txt · .env.example
├── frontend/
│   ├── src/            # api, components, lib (routing/demo engine), stores, types
│   ├── public/data/    # static datasets served to the app
│   ├── routing_selftest.mjs
│   └── package.json · vite.config.ts
├── data/
│   ├── scripts/        # data acquisition & processing pipeline
│   ├── raw/ · processed/
│   └── data_manifest.json
├── .github/workflows/backend-integration.yml
├── PROJECT_MASTER_DOCUMENTATION.md
├── requirements.txt    # data-pipeline dependencies
└── .env.example        # data-pipeline credentials
```

## 18. Local setup

Prerequisites: Node.js (developed with v26; a current LTS should work), Python 3.12+ (CI uses 3.13), optionally Docker.

```bash
git clone https://github.com/sagar721/SIH---26085.git
cd SIH---26085
```

## 19. Environment variable setup

Copy the example files; **never commit real `.env` files** (they are git-ignored).

```bash
cp .env.example .env                    # data pipeline credentials (all optional)
cp backend/.env.example backend/.env    # backend settings
```

- Backend: an empty `DATABASE_URL` is a supported mode. To enable auth set `JWT_SECRET_KEY` and `AUTH_ADMIN_USERNAME` / `AUTH_ADMIN_PASSWORD_HASH` (generate the hash with the command in `backend/.env.example`). `POSTGRES_PASSWORD` is required only for Docker Compose.
- Root `.env`: `OPENTOPOGRAPHY_API_KEY`, `JAXA_FTP_USER/PASSWORD`, `COPERNICUS_DATASPACE_*` are only needed to re-download source data.
- The frontend needs no environment variables.

## 20. Running frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
npm run build      # tsc -b && vite build
```

If `npm install` yields a "Cannot find native binding" error from `rolldown`, `node_modules` was installed on another OS; delete `node_modules` and reinstall.

## 21. Running backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # http://localhost:8000/docs
```

Docker (PostGIS + Redis + API + Celery worker + scheduler): `cd backend && docker compose up --build` (requires `POSTGRES_PASSWORD` in `backend/.env`).

## 22. Running the data pipeline (optional)

Processed data is already included. To regenerate: `pip install -r requirements.txt` at the repo root, then run scripts in `data/scripts/` (see each script's header and `backend/docs/DATA_SOURCES.md`).

## 23. Testing

```bash
cd frontend && npm run lint && node routing_selftest.mjs    # lint (warnings only) + routing algorithm self-test
cd backend && python -m pytest -q                           # 72 tests passed on the last local run
```

CI (`.github/workflows/backend-integration.yml`) runs `pytest` on changes under `backend/**` and a Docker Compose job that boots the full stack, applies migrations and runs a `SCENARIO` simulation. There are no automated frontend unit tests. Empirical flood-extent accuracy has **not** been established (see Limitations).

## 24. Deployment

Only the backend has deployment configuration: `backend/Dockerfile` (runs migrations when `DATABASE_URL` is set, then Uvicorn), `backend/docker-compose.yml`, and Prometheus/Grafana config in `backend/monitoring/` (meant for an externally run monitoring stack). The frontend is a static Vite build (`frontend/dist`); no hosting configuration is included. In `ENVIRONMENT=production` the backend refuses to start unless the database and Redis are reachable.

## 25. Screenshots/demo

No screenshots are included in the repository. To see the demo: run the frontend, switch to **Demo Mode** in the top bar, open the **Simulation** tab, choose a preset, then use **Response & Routing** to pick two points.

## 26. Team

Repository owner: Sagar Kumar. *Additional team members and roles: to be added by the team.*

## 27. Future scope

Planned only — none of this is implemented:

- Calibrate the inundation solver against observed hydrographs (the NSE/RMSE code in `backend/app/simulation/calibration.py` exists but is not wired to any endpoint).
- Obtain official MCGM drainage-pipe data to replace the DEM-inferred network.
- Real population/exposure data (currently a Demo-Mode-only illustrative estimate).
- Connect the frontend to the backend API.
- Real traffic data for routing ETAs; multi-provider OIDC.

## Implementation status

| Area | Status |
|---|---|
| Map layers, Command/Citizen views, modals, KPI strip | **Implemented** (frontend) |
| Live Mode on pre-computed real data | **Implemented** — bundled rainfall window is dry |
| Flood-aware routing (Dijkstra, 3 modes, fallback chain) | **Implemented** (frontend + backend) |
| Backend REST API, auth, migrations, audit log, metrics config | **Implemented**, 72 tests passing |
| Rational-method + local-inertial inundation | **Prototype** — uncalibrated approximation |
| Demo Mode scenario engine, Population Exposed | **Simulation** — synthetic/illustrative, not prediction |
| Drainage network | **Inferred** from DEM (not official) |
| Sentinel-1 flood-extent validation | **Attempted; poor scores** (satellite revisit missed the event peak) |
| Frontend ↔ backend integration | **Not implemented** |
| ML/statistical nowcasting, digital twin, CesiumJS | **Not implemented** |

## Limitations

See [`backend/docs/LIMITATIONS.md`](backend/docs/LIMITATIONS.md) and `PROJECT_MASTER_DOCUMENTATION.md` §18. Key points: uncalibrated solver; no official drainage pipe data; no real population dataset; ETAs use assumed speeds; the OSM road extract is not one connected graph, so some routes fall back to a non-flood-aware external router. `PROJECT_MASTER_DOCUMENTATION.md` and `backend/docs/VALIDATION.md` cite 67 backend tests; the current suite has 72.

## 28. License

No license file is currently included, so all rights are reserved by default. Add a `LICENSE` before allowing reuse. Third-party data carries its own terms (e.g. OpenStreetMap ODbL); see [`backend/docs/ATTRIBUTION.md`](backend/docs/ATTRIBUTION.md).

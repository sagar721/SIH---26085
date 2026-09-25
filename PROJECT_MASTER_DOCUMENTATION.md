# FLOODCAST (SIH26085) — Master Documentation

**Single source of truth for this project.** Supersedes every prior audit report, merge report, verification report, and planning document that previously accumulated at the repository root and under `audits/`/`files/` — their durable content is folded in below; the documents themselves have been removed to keep the repository to one authoritative reference.

---

## 1. Project Overview

FLOODCAST is an urban flood-intelligence platform for Mumbai's Kurla–Sion–Chunabhatti and Hindmata–Dadar–Parel pilot zones (Mithi River basin / Kurla–BKC corridor), combining real terrain, rainfall, drainage, and infrastructure data into a coupled simulation, safe-routing, and decision-support system. It ships as two independently-runnable halves:

- **Frontend** (`frontend/`) — a React + TypeScript + MapLibre dashboard that is the actual product surface: real-time map visualization, KPI reporting, flood-aware routing, and a self-contained "Demo Mode" for presentations. This is what a judge interacts with.
- **Backend** (`backend/`) — a FastAPI service implementing the same class of hydrologic simulation server-side, with production-grade authentication, persistence, and observability. The frontend does **not** call this backend for its live dashboard (see §9) — it is a complete, independently-tested, independently-deployable system in its own right, built for the path to a real production deployment.

## 2. Problem Statement

Mumbai floods most years during the monsoon, and — unusually for an Indian metro — the problem is not government inattention: MCGM's BRIMSTOWAD storm-water master plan dates to 1993, an active BRIMSTOWAD-III tender is procuring a GIS/SCADA-digitised drainage network, the Ministry of Earth Sciences operates iFLOWS-Mumbai (an authority-facing early-warning system built with NCCR/IMD/IITM), and a 2026 MCGM–IIT Bombay ₹10,000-crore DPR targets ~300–350 chronically flood-vulnerable locations following intense July 2026 monsoon flooding. Mumbai is, if anything, the *most* "solved-for" Indian city for this problem on paper.

What none of the publicly-documented systems offer, confirmed by a dedicated pre-project research pass (government pages, MoES/NCCR documents, MCGM tender/RTI filings, and peer-reviewed literature):

- **Public, citizen-facing access.** iFLOWS-Mumbai, BRIMSTOWAD/SCADA, and Chennai's comparable C-FLOWS system are all authority-facing decision-support tools for a control room, not an open dashboard.
- **Hypothetical scenario simulation.** No existing system publicly offers "what if rainfall were 2x, or 30% of drains were blocked" exploration.
- **Safe/emergency routing** that reacts to simulated flood conditions.
- **Transparent methodology and provenance** — government systems are not designed to expose which numbers are real vs. modelled vs. assumed.

FLOODCAST's pitch is explicitly **not** "we predict floods better than MCGM/IIT-B" — it is openness, routing, scenario simulation, and honest provenance as the differentiators, while grounding every assumption in real, citable historical parameters: the city's drainage system was originally surveyed as **121 catchments** with **186 outfalls**, designed for a **50mm/hr rainfall intensity at runoff coefficient 1** (the 1993 BRIMSTOWAD standard — routinely exceeded today; Mumbai has recorded 300mm+ in a single day multiple times, and 300mm in six hours in 2024), of which historically only **~15%** of BRIMSTOWAD's original recommendations were actually implemented. These are the numbers FLOODCAST's own DEM-derived catchment/outfall inference is cross-validated against (see §6), and the numbers the default "design storm" scenario throughout this app is anchored to.

## 3. System Architecture

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│   Frontend (React/Vite)     │         │   Backend (FastAPI)           │
│                              │         │                                │
│  Live Mode ── real data ────┼── (never calls the backend) ─── independent, complete,
│  Demo Mode ── self-contained│                                  production-track system
│  synthetic engine, zero     │         │  Auth · Simulation · Routing   │
│  backend dependency          │         │  Migrations · Monitoring · CI  │
└─────────────┬────────────────┘         └───────────────┬────────────────┘
              │                                            │
   static GeoJSON/JSON files                    PostgreSQL/PostGIS + Redis
   under frontend/public/data/                  (optional — degrades to
   (produced by data/scripts/*.py               SQLite/in-memory when
   from real DEM/rainfall/GIS sources)          unconfigured)
```

The two halves share a *problem domain* (Mumbai flood simulation) and a *methodology* (Rational Method runoff → drainage overflow → terrain-redistributed inundation → road/infrastructure impact → routing), but are **not wired together**. This is a deliberate architectural choice, not an oversight — see §9.

## 4. Frontend Architecture

Stack: React + TypeScript, Zustand for state (`useSimulationStore`, `useZoneStore`, `useUIStore`, `useRoutingStore`, `useLayerStore`, `useWhatIfStore`, `useDataHealthStore`, `useRainfallStatusStore`), MapLibre GL for the map (Esri World Imagery satellite basemap, no API key required), Vite build.

**Layout**: `CommandCenter.tsx` is the top-level shell (Command mode). `TopBar.tsx` holds the Live/Demo and Command/Citizen toggles. A Decision-Flow Rail switches between Situation, Impact, Response & Routing, and Simulation tabs; a Reference rail links to Analytics, Methodology & Evidence, Data Provenance, and Validation Log modals — all real, fully-built (not stubs): `AnalyticsModal.tsx` (hydrograph/time-series charts, zone cross-comparison, asset vulnerability breakdown), `MethodologyModal.tsx` (provenance tiers, sensitivity analysis, stated limitations), `DataProvenanceModal.tsx` (searchable data-source catalog), `ValidationModal.tsx` (real Sentinel-1/IFI validation status, honest about poor scores — see §17). `CitizenView.tsx` is a second, complete, mobile-first UI mode (shelters, preparedness checklist, safe-route panel, emergency numbers) reached via the Command/Citizen toggle — orthogonal to Live/Demo, both modes read the same stores.

**Map** (`MapContainer.tsx`): boundary, water, city-context roads, buildings (flat in overview, 3D-extruded in zone view), critical infrastructure, rainfall, the legacy Scenario-Mode flood-fill layer, the precomputed/synthetic flood-simulation layer (2D circles + exaggerated 3D pillars), drainage graph, and routing layers (active route, flood-blind comparison route, endpoints) — every one of these is click/hover-interactive with a real, provenance-labeled popup (fixed during this project's Demo Mode pass: the 3D-buildings layer previously had no click handler despite being the primary pilot-zone view).

**KPI Strip** (`KpiStrip.tsx`): Live Mode renders exactly 5 non-interactive cards reading real data (Rainfall Intensity, Flood Coverage, Roads Blocked, Critical Assets, Population Exposed — the last an honest placeholder, no real population dataset exists in this project). Demo Mode renders 7 clickable cards (adds Drainage Capacity Exceeded and a Confidence Indicator), each opening a detail popover with methodology/assumptions and a deep link into the relevant modal. The two are structurally separate render branches, not a shared component with hidden fields — Demo Mode's additions cannot leak into Live Mode.

**Routing** (`lib/routingEngine.ts`, `lib/computeSafeRoute.ts`, `lib/geocoding.ts`, `lib/externalRouting.ts`, `components/routing/LocationAutocomplete.tsx`, `api/hooks/useAutoRouteRecompute.ts`): a debounced, keyboard-navigable free-text autocomplete searches a local landmark index — real MCGM/OSM infrastructure, roads, and buildings, with generic unnamed OSM nodes (bare `traffic_signal` points, which otherwise dominated results) excluded and named landmarks ranked ahead of them — first, then falls back to OpenStreetMap's Nominatim geocoder, bounded to the Mumbai metro area, for anything not found locally, so a judge can type any recognizable place, hospital, school, station, or address and get a route even if it isn't in the curated infrastructure dataset (an unbounded geocoding query matching a same-named place elsewhere in the world was a real bug found via live browser testing and fixed). Resolved origin/destination points then feed a three-priority fallback chain in `computeSafeRoute.ts`: (1) the real OSM road-network graph with Dijkstra across three cost functions (fastest/safest/balanced), reporting avoided roads and risk reduction versus a flood-blind "normal" baseline; (2) the same graph with a wider snap-to-road-node tolerance for a point just outside the pilot zone's road extract; (3) an external routing API (OSRM's public demo server, no key required) when the local extract genuinely can't connect the pair — always labeled "External routing fallback used" and never presented as flood-aware, since the external engine has no knowledge of this app's flood model. A 60km sanity cap rejects any external route implausible for a Mumbai pair, a second line of defense alongside the geocoder's own bounding box. Flood depth lookups use a spatial-bucket index (added during the Demo Mode performance fix — see §17) so scanning thousands of road segments against a dense flood-depth grid stays fast regardless of whether the grid is the real precomputed frame or Demo Mode's synthetic one. In Demo Mode, a destination inside simulated flooding shows a four-tier warning (LOW/MEDIUM/HIGH/CRITICAL, with the modelled depth in metres), and switching to a more severe scenario preset re-evaluates the recommended route live, surfacing "Flood conditions have altered the recommended route." whenever the safe route actually changes.

## 5. Backend Architecture

FastAPI, async, versioned under `/api/v1`. Layers: `app/api/v1/endpoints/*` (routers) → `app/services/*` (SimulationService, GisService, DrainageService, RuntimeStore, RiskService, AlertService) → `app/simulation/*` (pure physics functions: runoff, overflow, inundation, time-to-critical, calibration) → `app/data_sources/*` (11 provider adapters: Open-Meteo, Tomorrow.io, IMD, IMD radar, NASA GPM, MCGM rain gauges, BMC GIS, OSM, Copernicus DEM — each explicitly reports `NOT_CONFIGURED`/`UNAVAILABLE` rather than fabricating data when a credential or connection is missing). `app/workers/*` runs Celery tasks (simulation execution) and two long-lived asyncio loops (weather/data refresh). `app/models/database.py` provides SQLAlchemy + PostGIS, degrading to SQLite/in-memory when `DATABASE_URL` is unset.

## 6. Data Pipeline

Real, non-fabricated inputs, ingested by `data/scripts/*.py` (frontend-facing static files) and `backend/scripts/ingest_*.py` (backend's own PostGIS-oriented ingestion):

| Layer | Source | Provenance |
|---|---|---|
| Terrain | Copernicus GLO-30 DEM | OBSERVED |
| Roads, buildings, waterways | OpenStreetMap (Overpass API) | REAL (ODbL) |
| Storm drains, manholes, flooding spots, critical infrastructure | MCGM/BMC ArcGIS REST (136 ArcGIS services surveyed across 2 discovered map servers during a dedicated investigation; drainage-pipe-level data itself was confirmed NOT published — requires a formal SWD RTI request MCGM's own tender language confirms doesn't yet have a public GIS answer) | REAL where published, explicitly labeled UNAVAILABLE where not |
| Rainfall | GSMaP (frontend historical window), Open-Meteo/Tomorrow.io/IMD/NASA GPM (backend live providers) | OBSERVED / FORECAST per provider |
| Drainage network topology | Inferred via D8 flow-direction/accumulation on the real DEM, cross-validated against the historically-documented 121-catchment / 186-outfall structure (directional consistency, not exact matching, is the bar) | INFERRED / ESTIMATED, never presented as the official MCGM underground network |
| Susceptibility score (per road/infrastructure segment) | Composite of real DEM slope, landcover, and waterway proximity | MODELLED |
| Population exposure | *No real dataset* — a Demo-Mode-only illustrative estimate from real OSM building footprints × an assumed occupancy figure | SYNTHETIC, Demo Mode only (see §8) |

Sentinel-1 SAR was investigated as a path to empirical flood-extent validation; a specific cross-host-redirect auth-header bug was found and fixed, and the DEM's exact specs (file size, CRS, elevation range) were verified — but the ~12-day satellite revisit cadence never coincided with a real Mumbai storm's peak, so IoU/F1 validation scores, while computed and disclosed (§17), are poor by construction, not by modeling failure.

## 7. Simulation Engine

Two independent implementations of the same methodology exist, for different purposes:

**Backend** (`backend/app/simulation/`, real physics, async job): Rational Method runoff (`Q = 0.00278·C·I·A`) → drainage overflow (`max(Q_runoff − Q_capacity, 0)`, capacity summed from real per-segment attributes or an explicit `DRAINAGE_OUTFALL_CAPACITY_M3S` config — no hardcoded fallback) → a **local-inertial 2D finite-volume overland-flow solver** (`app/simulation/inundation.py`) that injects overflow at the real nearest drainage/outfall/manhole source cells (not spread uniformly), computes inter-cell transfers from head-difference discharge with a tidal boundary stage, and reports a real mass-balance-error diagnostic every run → real Shapely geometric intersection (not point-sampling) against OSM road/BMC infrastructure geometry, reporting `affected_length_ratio`. Runs asynchronously via Celery, submitted with an explicit `mode` (`LIVE`/`FORECAST`/`SCENARIO`), deduplicated via a config hash. Full math in `backend/docs/MODEL.md`.

**Frontend Demo Mode engine** (`frontend/src/lib/demoEngine.ts`) — see §8.

## 8. Demo Mode Design

Built as a **frontend-only, deterministic, self-contained simulation engine** — an explicit architectural decision so a judge can run a complete simulation with nothing but `npm run dev`, no backend/database/Redis/internet dependency. It is intentionally hypothetical/illustrative, not a claim of real prediction, and labeled "Scenario Simulation (Hypothetical)" throughout the UI (top bar tooltip, Simulation panel header, BottomDock badge, and a persistent map banner).

- **4 presets** (`DEMO_PRESETS` in `demoEngine.ts`): BRIMSTOWAD Design Storm (1.5x intensity, 0% blockage — moderate), Cyclone-Scale Downpour (2.2x, 20% blockage — fast-onset), 26 July 2005-Scale Deluge (3.0x, 30% blockage — extreme/long-duration), Drainage Network Collapse (1.0x, 80% blockage — infrastructure failure despite normal rainfall). Each has a distinct **timeline shape** (smooth ramp / early spike-then-plateau / fast-climb-then-long-plateau / linear-worsening), not just a different peak, so playback visibly evolves differently per preset.
- **Spatial model**: a small set of fixed "low-lying" seed points per zone with distance-decay falloff (radius scaling with storm severity), evaluated over an 80×80 grid sized so no point in a ~5km pilot zone is ever more than the 50m radius the rest of the app already uses for flood-depth lookups — so the synthetic frame is a drop-in replacement everywhere the real precomputed frame's `Feature[]` shape is consumed (routing, road/infrastructure enrichment, the 3D map layer), with **zero changes needed to those consumers**.
- **Single substitution point**: `useFloodSimulationFrame.ts` and `useFloodData.ts` branch on `mode === 'demo'` at exactly one place each. This is what makes every KPI, map layer, and routing decision agree with each other in Demo Mode — eliminating the split-pipeline inconsistency that existed before this work (documented, now resolved: previously the map's flood-fill layer, road closures, and infrastructure status each read from different, disconnected sources and could visibly contradict each other).
- **Population Exposed** (Demo Mode only): real OSM building footprints tested against the synthetic flood extent, contributing an assumed ~8 occupants/floor (OSM `levels` tag, or a 1-floor default) — explicitly labeled MODELLED, never shown in Live Mode.
- **Performance**: the dense synthetic grid initially caused a severe performance bug — `findFloodDepthAtSimNodes` (shared with the real-data path) did a linear scan per query, and with ~3,200 road segments × 3 samples against a ~10,000-node grid, this was tens of millions of haversine calls per preset change and froze the page. Found via live browser testing (not code review), fixed with a spatial bucket index inside that one function (same inputs/outputs, benefits both real and synthetic data) plus memoization of the generated frame across the multiple hooks that each independently request it.

## 9. Real Mode Design ("Live Mode")

Live Mode is the **authoritative real-data mode** and was explicitly required to remain byte-for-byte unchanged by the Demo Mode work. Every manual control (rainfall/blockage sliders, presets, playback, timeline scrubbing) is disabled at the store level (`useSimulationStore.ts` — every setter no-ops in `mode==='live'`, not just hidden in the UI), and switching into Live Mode atomically resets scenario multiplier to 1.0x, blockage to 0%, stops playback, jumps to the newest real timestamp, and turns off any Demo-only overlay. Live Mode's KPI strip, map layers, and routing all read real data through the same code paths as before any Demo Mode work existed — verified live (not just by inspection) after an initial mistake let two new KPI cards and click-interactivity leak into Live Mode; fixed with a hard per-mode branch in `KpiStrip.tsx` so there is no code path by which Demo Mode's concepts can appear in Live Mode's rendered output.

The frontend **never calls the backend** in either mode — both Live and Demo run entirely against static files under `frontend/public/data/` (real data, pre-computed by `data/scripts/*.py`) or, in Demo Mode, the synthetic engine in §8.

## 10. Security Architecture

- **Password storage**: PBKDF2-SHA256, 310,000 iterations, per-password random salt (`app/core/auth.py::hash_password`). A plaintext-password fallback exists but is gated behind `ALLOW_INSECURE_LOCAL_AUTH=True` **and** `ENVIRONMENT=development` — never usable in production even if accidentally left configured.
- **Token revocation**: `JwtDenylist` — every revocation writes to Redis (`SETEX`, TTL-expiring, O(1) reads) **and** a durable Postgres `jwt_denylist` table; every read checks Redis first, falls back to Postgres if Redis is unreachable, and **fails closed** (treats the token as revoked) if both stores are unreachable — a token is never trusted by default when its revocation status can't be verified.
- **OIDC**: RS256 signature verification against the real identity provider's published JWKS (fetched via `PyJWKClient`, cached in-process), explicit issuer and audience validation. There is **no fallback path** that verifies an external token against this application's own `JWT_SECRET_KEY` or any locally-known secret — a real vulnerability of this shape was found and fixed during the backend merge (the original code would verify "external" tokens using `OIDC_CLIENT_SECRET` as an HMAC key, or the app's own JWT secret if that wasn't set), with regression tests proving a forged token is rejected.
- **Audit logging**: every auth event (issue/refresh/revoke/OIDC login/failure) and every simulation trigger is written to the `audit_log` table with the real client IP (`X-Forwarded-For`-aware), degrading to structured stderr logging (never silently dropped) if the DB write fails.
- **Rate limiting**: token-bucket middleware, 120 req/min.

## 11. Authentication System

`POST /auth/token` (username/password → access + refresh JWT pair) → `POST /auth/refresh` (single-use rotation: the submitted refresh token is immediately revoked, a fresh pair issued; reuse of an already-rotated token is rejected) → `POST /auth/oidc/login` (external identity provider, §10) → `POST /auth/revoke` (revoke the caller's current token). Access tokens carry `jti`/`token_type` claims; `require_roles()` gates `admin`/`operator`-only endpoints (e.g. `/simulation/run`).

## 12. Monitoring Architecture

Prometheus scrape config (`backend/monitoring/prometheus.yml`, 15s interval against `/metrics`), 3 alert rules (`backend/monitoring/alerts.yml`: simulation failure rate >10%, readiness-probe failures, elevated auth-failure rate), and a 4-panel Grafana dashboard (`backend/monitoring/grafana/mflood-overview.json`: HTTP request rate, HTTP p95 latency, simulation outcomes, auth failures by reason). Every metric referenced by an alert or panel is confirmed populated by real application code — a `mflood_provider_staleness_seconds` gauge and its accompanying alert/panel existed in an earlier draft of this config but were never wired to any code path that actually set the value; removed during this hardening pass rather than merged as dead monitoring (replaced with the auth-failures panel/alert above, which uses metrics genuinely emitted by the merged auth system). These config files are meant to be consumed by an externally-run Prometheus/Grafana stack (not bundled as `docker-compose.yml` services) — a common pattern where monitoring infrastructure is shared across projects rather than per-project.

## 13. Deployment Architecture

- **Dockerfile**: installs GDAL/GEOS/PROJ system deps, then `python scripts/init_db.py && if [ -n "$DATABASE_URL" ]; then alembic upgrade head; fi && exec uvicorn ...` — migrations only run when a database is actually configured, preserving the documented "no database" prototype mode (this was a real, found-and-fixed regression: `init_db.py` previously exited with code 1 whenever `DATABASE_URL` was unset, even though that's an explicitly supported mode, which meant the container could never have booted DB-less even before Alembic was added to the boot chain).
- **docker-compose.yml**: `db` (PostGIS) → `redis` → `backend` (API, healthcheck on `/health/live`) → `worker` (Celery) → `scheduler` (optional, runs the weather/data refresh loops as its own process via `RUN_SCHEDULED_REFRESHES_IN_API=false`, paired with the same flag on `backend`/`worker` so the loops run in exactly one place). Removing the `scheduler` service and that env var returns to the simpler single-process default — local development's `python scripts/run.py` never needs any of this.
- **Production startup gate** (`app/main.py`): in `ENVIRONMENT=production` only, the server refuses to start unless the database and Redis are actually reachable — fail-fast rather than silently serving broken. This branch is a complete no-op for the default `ENVIRONMENT=development`, so it can never block local development or a hackathon demo (which also never touches the backend at all — see §9).
- **CI** (`.github/workflows/backend-integration.yml`, repo root — GitHub only recognizes workflows there, not nested under `backend/`): a fast `pytest -q` job on every push/PR touching `backend/**`, plus a `compose-celery` job that boots the full Docker stack, applies migrations, authenticates, submits a real `SCENARIO` simulation, and polls until it reports `COMPLETED`.

## 14. Database Schema Overview

Linear 4-revision Alembic chain (`backend/alembic/versions/`):

| Revision | Adds |
|---|---|
| `0001_initial_schema` | Base tables: `users`, simulation records, scenario metadata |
| `0002_runtime_tables` | `persistent_simulations`, `persistent_alerts` + enables the PostGIS extension |
| `0003_audit_log` | `audit_log` (event_type, username, role, ip_address, success, detail, jti, simulation_id, created_at) |
| `0004_jwt_denylist` | `jwt_denylist` (jti, expires_at, revoked_by, revoked_at) |

## 15. API Overview

Full reference in `backend/docs/API.md`. Grouped surface: System Health & Probes, Authentication (§11), Providers/Weather/Rainfall, Municipal GIS Features, Drainage Hydraulics, Simulation Jobs & Timeline, Derived Flood Results, Flood-Aware Routing, Operational Alerts, Provenance & Live Updates (including a WebSocket stream).

## 16. Key Features

- Real-data-grounded simulation (Rational Method → drainage overflow → 2D local-inertial inundation → road/infrastructure impact → flood-aware routing) with strict provenance labeling throughout (REAL/OBSERVED/MODELLED/INFERRED/ESTIMATED/SIMULATED/SYNTHETIC — never fabricated data presented as real).
- Flood-aware Dijkstra routing (fastest/safest/balanced) with an explicit flood-blind comparison baseline, avoided-road explanations, and risk-reduction reporting.
- Real free-text location search (local landmark index, ranked and deduplicated, plus a bounded Nominatim geocoding fallback) and a three-priority routing fallback chain (local graph → expanded snap tolerance → external routing API) so a route is returned whenever reasonably possible instead of failing outright.
- Demo Mode destination flood warnings (LOW/MEDIUM/HIGH/CRITICAL, with modelled depth) and live re-routing narration when a more severe scenario preset changes the recommended route.
- A fully self-contained Demo Mode for presentation contexts, cleanly isolated from the real-data Live Mode.
- Command and Citizen dual UI modes from one shared state layer.
- Durable, multi-replica-safe authentication (PBKDF2, refresh rotation, Redis+Postgres JWT denylist, real OIDC).
- Full observability path (structured audit log, Prometheus metrics, Grafana dashboard, CI integration testing).

## 17. Technical Innovations

- **Terrain-realistic overland flow**: injecting simulated overflow at real drainage-network source points rather than spreading it uniformly, with head-difference-driven inter-cell transfer and a reported mass-balance-error diagnostic — a genuine hydrologic-modeling improvement, not cosmetic.
- **Real geometric road-flood intersection** (Shapely `LineString`/`Polygon`, full segment length) replacing single-point sampling — catches partial-length flooding a midpoint sample would miss.
- **A single shared depth-lookup interface** (`FloodSimulationFrame`'s `Feature[]` shape) that both the real precomputed simulation and the synthetic Demo Mode engine implement identically, letting every consumer (routing, map rendering, road/infrastructure enrichment) stay agnostic to which one is active — the architectural choice that eliminated the pre-existing split-pipeline KPI inconsistency.
- **Fail-closed security posture applied consistently**: JWT revocation checks fail closed on dual-store outage; OIDC verification fails closed on incomplete configuration; production startup fails closed on missing dependencies — the same defensive philosophy applied at every layer, not just one.
- **Honest validation under real-world data limits**: rather than omitting or fabricating a flood-extent accuracy score, the Sentinel-1 cross-validation attempt and its poor IoU/F1 result (root-caused to a genuine satellite-revisit/storm-timing mismatch, not a modeling defect) are reported and explained in the Validation Log.

## 18. Limitations

- The inundation engine is a prototype local-inertial 2D approximation, not a certified Saint-Venant hydraulic solver, and is not yet calibrated against real observed hydrographs (`app/simulation/calibration.py` implements the NSE/RMSE math for this but is not wired into any live endpoint).
- No real population/census dataset exists in this project; Population Exposed is a Demo-Mode-only illustrative estimate, never shown as real in Live Mode.
- Official MCGM underground drainage pipe data is not publicly published (confirmed via a 136-service ArcGIS survey and MCGM's own BRIMSTOWAD-III tender language); the drainage network used throughout is DEM-inferred and historically cross-validated, never presented as the official network.
- Sentinel-1-based empirical flood-extent validation exists but scores poorly due to satellite revisit timing, not model quality — see `backend/docs/VALIDATION.md`.
- Routing ETA uses assumed road-class speeds, not real traffic data.
- The real OSM road-network extract for each pilot zone is not one single connected graph (a known, handled data-coverage gap in the bbox-clipped extract, not a routing defect) — some origin/destination pairs that are geographically close still fall through to the external routing fallback, which is not flood-aware, rather than a local flood-aware route.
- Road obstruction modeling uses predicted water depth only — ad-hoc barricades and real-time congestion are not tracked.
- The backend's monitoring stack (Prometheus/Grafana) expects an externally-run monitoring stack; it is not bundled as `docker-compose.yml` services.

## 19. Future Roadmap

- Wire `app/simulation/calibration.py` into a real endpoint once observed stage-discharge hydrographs become available (e.g. Mithi River at CST Road Bridge/BKC), and formally publish NSE/RMSE/IoU metrics against them.
- Pursue the formal MCGM SWD RTI/data-sharing path for real drainage-pipe attributes, replacing the DEM-inferred network where official data becomes available.
- Consider whether Demo Mode's synthetic engine should optionally drive the backend's `SCENARIO` simulation mode for audiences that specifically want to see the real backend exercised (a deliberate choice was made against this for the default hackathon path, to keep Demo Mode dependency-free — see §9).
- Expand OIDC to support multiple simultaneous providers and role-mapping configuration beyond the current single-provider setup.
- Add real population/exposure data (e.g. WorldPop or a gridded census product) to replace the Demo-Mode-only illustrative estimate.

## 20. Setup Instructions

**Frontend** (`frontend/`):
```bash
npm install
npm run dev       # Vite dev server, no backend required
npm run build     # tsc -b && vite build
npm run lint       # oxlint
node routing_selftest.mjs   # standalone algorithm self-test (Dijkstra + blocked-edge exclusion + risk-weighted cost) against a hand-checkable synthetic graph, independent of real road data
```

**Backend** (`backend/`):
```bash
python -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env   # edit as needed; empty DATABASE_URL is a supported mode
.venv\Scripts\python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
.venv\Scripts\python -m pytest -v
```
Or via Docker: `docker compose up --build` (see §13). Full detail in `backend/README.md`.

**Data pipeline** (`data/scripts/*.py`, regenerates the static files the frontend ships): `pip install -r requirements.txt` (repo root).

## 21. Demo Walkthrough (judge flow)

1. Switch to **Demo Mode** (top bar) — the map/KPI strip/Simulation tab immediately relabel as "Scenario Simulation (Hypothetical)."
2. Open the **Simulation** tab, pick a preset (e.g. Cyclone-Scale Downpour).
3. Watch the KPI strip update — Rainfall Intensity, Flood Coverage, Roads Blocked, Critical Assets, Population Exposed, Drainage Capacity, Confidence all change together, consistently.
4. Explore the map — flood extent, colored critical-infrastructure markers (green/amber/red, with a visible legend), 3D buildings, all clickable.
5. Click a critical asset for its classification reason (e.g. "AT RISK — simulated depth exceeds 0.1m but is below the 0.5m CRITICAL threshold").
6. Open **Response & Routing**, pick two points — the route avoids flooded roads and explains what it avoided and why.
7. Press **Play** on the timeline — KPIs, map, and routing evolve together as the storm progresses (verified live: Roads Blocked and Critical Assets both changed correctly as the timeline advanced).
8. Click any KPI card for its methodology/assumptions, and the Analytics / Methodology & Evidence / Data Provenance / Validation Log panels from the Reference rail.
9. Use "Brief NDRF & MCGM →" to generate a printable summary.

## 22. Judge-Facing Explanation

FLOODCAST is not claiming to out-predict MCGM/IIT-Bombay's own well-funded, real-sensor initiatives — it's demonstrating what an **open, explainable, routing-and-scenario-capable layer** on top of the same class of problem looks like, built entirely from public data with every number's provenance disclosed. The backend is a real, tested, security-hardened, production-track system (67 automated tests, durable auth, CI, monitoring) that exists independently of what's shown live — the frontend dashboard you're interacting with runs entirely client-side against pre-computed real data (or, in Demo Mode, a clearly-labeled illustrative simulation), so it works reliably with zero infrastructure in a demo setting while the backend proves the harder production-readiness case separately.

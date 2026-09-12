# FLOODWATCH — UX Information Architecture Audit

Every dataset, layer, chart, panel, and control in the app was inventoried directly from the component source (not from memory of what it's supposed to do), classified, and the results below were actually implemented — not just recommended. Goal: **a first-time user should understand the platform in under 60 seconds.**

## Classification key

- **CORE** — needed to understand what this platform is and does, on first contact.
- **IMPORTANT** — real, load-bearing functionality or credibility content, but reachable behind a click rather than needed in the first 60 seconds.
- **OPTIONAL** — genuinely useful to some users, low cost to keep, not needed for basic understanding.
- **UNUSED** — dead, decorative, fabricated, or fully duplicated elsewhere. Removed.

---

## Full inventory and classification

### Top bar
| Item | Class | Notes |
|---|---|---|
| FLOODWATCH title/logo | CORE | Identity |
| "Snapshot — [date] · Not Live" badge | CORE | The single most important honesty signal in the app |
| "MUMBAI" + bare OBSERVED/INFERRED badges | **UNUSED** | Two provenance chips floating next to a city name with no label explaining what they refer to. The provenance-tier concept is properly introduced, with real examples, in the Methodology modal — this was an orphaned, unexplained duplicate of that concept. **Removed**, "MUMBAI" label kept. |
| Analytics / Data Provenance / Validation / Methodology buttons | IMPORTANT | Real navigation to real content |
| System Status dropdown | CORE | Only place system health is computed live (not asserted) |
| Settings button → Settings modal | **UNUSED** | See below — the modal behind it was dead weight. **Removed.** |

### Left sidebar (Zone Selector + Dashboard Panels)
| Item | Class | Notes |
|---|---|---|
| Zone Selector (Mumbai overview / 2 pilot zones) | CORE | Primary navigation |
| "CURRENT ZONE RAINFALL" card | **UNUSED (duplicate)** | Showed `riskSummary.peakRainfallMmHr` — the exact same number, same source, already shown one panel away in the always-visible Right Panel as "Peak Rainfall (real)". Two panels visible on screen **simultaneously** showed the identical figure. **Removed**; the number lives in exactly one place now. |
| Scenario Mode sliders (rainfall multiplier, drainage blockage) | CORE | The interactive "what-if" mechanism the whole simulated layer depends on |
| Routing Panel | CORE | The flood-aware routing feature |
| "ENGINE: ONLINE" pill with pulsing green dot | **UNUSED (fabricated)** | A hardcoded status that was never computed from anything — it said "ONLINE" unconditionally, in permanent contradiction to this project's own rule (enforced everywhere else, including the real System Status dropdown two components away) that no status is ever asserted without checking. **Removed** as actively misleading, not just redundant. |

### Right sidebar (Intelligence panel)
| Item | Class | Notes |
|---|---|---|
| Overall Risk | CORE | |
| Key Metrics (Peak Rainfall, Max Depth, Affected Area, Affected Roads) | CORE | Now the *only* place Peak Rainfall appears |
| Rainfall-Aware Impact (zone severity / road impact / infra exposure) | IMPORTANT | Compact current-hour glance; the deeper time-series version in Analytics is a different depth of the same model, not a pure duplicate |
| Export (Roads GeoJSON / Infra CSV / Print Summary) | OPTIONAL | Real, functional, low clutter cost — kept |
| "Forecast Horizon: MODEL UNAVAILABLE" card | **UNUSED (duplicate)** | Word-for-word the same disclosure ("No rainfall nowcast/forecast model exists...") already listed in the Methodology modal's Limitations section. Permanently occupying primary sidebar space to announce a feature that doesn't exist worked against the 60-second goal. **Removed** from the sidebar; the disclosure still exists, once, in Methodology. |
| Top Risk Locations | IMPORTANT | |
| Affected Infrastructure list | CORE | |

### Map
| Item | Class | Notes |
|---|---|---|
| Layer picker — 13 real, toggleable layers (boundary, roads, buildings, water, landcover, infrastructure, rainfall, DEM, slope, inferred drainage, flood extent, susceptibility) | CORE | Every one of these maps 1:1 to a real MapLibre layer — verified against `LAYER_TO_MAPLIBRE` in `MapContainer.tsx`, no dead entries |
| "Official Drainage (MCGM)" — permanently disabled row | OPTIONAL | Kept, unlike the two below — drainage is a primary theme of a flood platform, so a disclosed "why this doesn't exist" row sits exactly where a user would look for it |
| "Historical Floods" — permanently disabled row | **UNUSED** | Can never be toggled (no point geometry to render, confirmed unreferenced anywhere in `MapContainer.tsx`). The same fact is already stated, with full context, in the Validation panel. **Removed** from the layer list. |
| "Validation Overlay" — permanently disabled row | **UNUSED** | Same reasoning — never toggleable, already disclosed in the Validation panel. **Removed.** |
| Map orientation caption (top overlay text) | CORE | The fastest "what am I looking at" signal on the map itself |
| Simulation Timeline (play/pause, 1x/2x/5x speed, scrubber) | CORE | |

### Modals
| Item | Class | Notes |
|---|---|---|
| Analytics (Hydrograph, Zone Comparison, Vulnerability tabs) | IMPORTANT | Real charts over real data; not needed for 60-second understanding but not padding either |
| Data Provenance catalog | IMPORTANT | The dataset-by-dataset trust register this whole project is built to support |
| Validation panel | IMPORTANT | Same purpose, for model accuracy specifically |
| Methodology modal | IMPORTANT | Now the single home for every "what's real vs. simulated" and "what's missing" disclosure that used to also be scattered across the sidebars |
| **Settings modal** | **UNUSED — removed entirely** | See below |

---

## Why the Settings modal was removed outright

This was the single biggest finding. Reading `SettingsModal.tsx` in full showed it had exactly two sections, and both were dead weight:

1. **"Simulation Playback Frame Rate"** — a 0.5x/1x/2x/5x button row controlling the same `playbackSpeed` store field the Simulation Timeline's own 1x/2x/5x buttons already control. Two different UI surfaces for one piece of state, with *inconsistent option sets between them* — a textbook duplicate control.
2. **"Emergency Impassability Depth Cutoff"** — displayed "Passenger Vehicles: 0.30m" and "Heavy Rescue / NDRF Trucks: 0.60m" as if the platform supported vehicle-class-aware routing. It does not: `routingEngine.ts` has exactly one constant, `IMPASSABLE_DEPTH_M = 0.3`, applied identically to every route regardless of vehicle type (this exact gap is documented as finding H3 in `GOVERNMENT_ROUTING_READINESS_REPORT.md`). This card wasn't just unused — it was **actively misleading**, asserting a capability that doesn't exist, which runs directly against this project's core data-honesty discipline.

With both sections gone, nothing in the modal did anything real, so the modal, its TopBar button, its lazy-loaded chunk, and its `'settings'` entry in the `ActiveModal` union were all removed rather than left as an empty shell.

---

## What was deliberately kept despite looking similar

- **RightPanel's compact "Rainfall-Aware Impact" card vs. AnalyticsModal's fuller version**: not a true duplicate. The sidebar card is a glance-level current-hour snapshot; Analytics adds a 24-hour time series, a zone comparison tab, and a vulnerability breakdown. Different depth for different intent (always-visible glance vs. opt-in deep dive) is a defensible pattern, not redundant — removing either would lose real capability.
- **"Official Drainage (MCGM)" disabled layer row**: kept, unlike the two removed alongside it, because drainage is a first-order theme of a flood platform and an evaluator looking for it should find the honest "why not" exactly where they'd expect a toggle to be, not only three clicks away in a modal.
- **The four reference modals (Analytics/Provenance/Validation/Methodology)**: none were cut. This project's credibility rests on the data-honesty discipline they contain; removing them to shorten the first-60-seconds path would trade away the platform's actual differentiator. They are classified IMPORTANT-not-CORE precisely so they stay one click away rather than in the way.

---

## Before / after

| Metric | Before | After |
|---|---|---|
| Always-visible panels showing "current rainfall" | 2 (Dashboard + Right Panel, same number) | 1 |
| Always-visible system-health indicators | 2 (real System Status dropdown + fake "ENGINE: ONLINE" pill) | 1 (real only) |
| Sidebar cards | 4 (Rainfall, Scenario, Routing, fake Engine status) | 2 (Scenario, Routing) |
| Right-panel cards permanently announcing a nonexistent feature | 1 ("Forecast Horizon: MODEL UNAVAILABLE") | 0 (disclosure kept once, in Methodology) |
| Top bar nav buttons | 5 (Analytics, Provenance, Validation, Methodology, **Settings**) | 4 |
| Modals in the app | 5 | 4 |
| Layer-picker rows | 16 (3 permanently un-toggleable) | 14 (1 disclosed-but-relevant, kept; 2 removed) |
| Controls for `playbackSpeed` | 2 (Timeline buttons + Settings buttons, inconsistent option sets) | 1 (Timeline only) |
| Controls asserting a routing capability that doesn't exist | 1 (vehicle-class depth cutoffs in Settings) | 0 |
| Distinct places the same "peak rainfall" figure appears on first load | 2 | 1 |

**First-60-seconds path, after this change:** open the app → Zone Selector + map are the two things demanding attention → pick a zone → Right Panel's Overall Risk / Key Metrics and the map's own layers explain the state of that zone with each fact appearing exactly once → the Scenario sliders are the one obvious "try something" affordance → Routing is visibly present but doesn't have to be used to understand the platform. Every reference/credibility modal (Analytics, Provenance, Validation, Methodology) is present but out of the way, one click deep, for the reader who wants to go further.

## Verification performed

- `npx tsc -b --noEmit` and `npm run build`: both clean after every removal (confirmed the `SettingsModal` chunk is gone from the production build output).
- Live Playwright pass against the running dev server: confirmed the Settings button, "CURRENT ZONE RAINFALL", "ENGINE:", and "Forecast Horizon" are all gone from the DOM; confirmed Peak Rainfall, Scenario Mode, and the Routing panel are still present and functional; confirmed the Layers picker now lists exactly 14 rows (13 toggleable + the one disclosed-but-kept Official Drainage row) instead of 16; zero console errors.

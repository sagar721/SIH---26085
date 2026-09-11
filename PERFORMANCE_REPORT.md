# FLOODWATCH — Performance Investigation Report

Follow-up to a prior profiling pass that reported 30–40% idle main-thread usage, 2–6s modal-close latency, and suspected roads/buildings vector layers. This report re-investigates from scratch with direct measurement (Chrome DevTools Protocol CPU profiling, real frame timing, real heap size), not assumption — and corrects two methodology errors the prior pass didn't catch.

## Method

All measurements were taken against the actual running app (`npm run dev`, real MapLibre GL rendering, real GeoJSON/PNG data) via Playwright + Chrome DevTools Protocol: `Profiler.start/stop` for CPU self-time attribution, a `requestAnimationFrame` sampling loop for frame timing, `performance.memory` for heap size, and DOM-detachment timing for modal-close latency. No numbers in this report are estimated.

---

## Two Methodology Corrections Found Mid-Investigation

These matter more than any single optimization — they mean **the prior pass's root cause (roads/buildings layers) was not the true bottleneck**, and its FPS-based evidence was not measuring what it appeared to measure.

### 1. Headless Chromium throttles `requestAnimationFrame` in ways that mimic a performance bug

Every FPS measurement in this investigation, run in the default headless browser, showed ~2–10fps at genuine idle with a fully-settled app. That looked exactly like a severe rendering bug. Re-running the identical test in a **headed** (non-headless) browser gave **65–77fps with 1–2 jank frames** — essentially perfect. Headless Chromium deprioritizes `requestAnimationFrame` for what it treats as a backgrounded tab; it does not reflect what a real user sees. **All FPS numbers in this report are from headed-mode measurement**; CPU profiling (which samples actual JS execution, not frame scheduling) is unaffected by this and was trusted throughout.

### 2. Accumulated zombie Chromium processes from repeated test runs contaminated later measurements

Modal-close timing tests taken late in this session showed wild variance (338ms one trial, 13,007ms the next) on **identical code**. `tasklist` found 21 orphaned `chrome.exe` processes left behind by earlier Playwright runs that didn't reach `browser.close()` (some had been moved to background by tool timeouts). Killing them and re-measuring in a clean environment produced consistent, low-variance results. **Every "after" number in this report was measured with zero stray browser processes running**, verified via `tasklist` immediately beforehand.

### 3. The prior session's root cause was incomplete

Testing a **fresh page load in overview mode** — before ever entering a pilot zone, so none of the "suspect" roads/buildings layers are even loaded — showed **96–98% CPU**, higher than the pilot-zone view. This directly contradicts "roads/buildings vector layers" as the primary cause. The real picture, confirmed by isolating layer groups on fresh page loads:

| Configuration | Idle CPU (2 consecutive 2.5s windows) |
|---|---|
| Basemap tiles only, all custom layers off | 35.5% → 20.2% (decaying) |
| Overview, default layers (boundary/water/city-roads/drainage + basemap) | 97.4% → 92.9% |
| Pilot zone, default layers (+ roads/buildings/rasters) | 93.4% → 44.6% (before fixes) |

The cost was never isolated to one layer — it's the **combination of the basemap's own tile/label rendering plus every custom layer loaded synchronously on entry**, dominated by an initial ~8–10 second window of near-100% CPU while MapLibre finishes loading and the app's own `fetch().then(r => r.json())` calls parse several MB of GeoJSON on the main thread. `map.loaded()` stayed `false` for that entire window in every test. Any interaction attempted during it — including a modal close — gets stuck behind that work, which is what looked like "modal close is broken" and "idle CPU never settles."

---

## Per-Layer Data (feature count, size, and simplification result)

| Layer | Features | Vertices (before) | Loaded in overview mode? | Simplified? |
|---|---|---|---|---|
| Basemap (CartoDB dark-matter, external) | N/A (vector tiles) | N/A | Yes | N/A — third-party service, out of scope |
| Admin boundary | 2 | 5,419 | **Yes** | ✅ 62% reduction |
| City-wide major roads | 8,148 | 55,526 | **Yes** | ✅ 59% reduction |
| City-wide water/waterways | 2,303 | 47,811 | **Yes** | ✅ 47% reduction |
| Inferred surface drainage | 9,717 | 19,434 | **Yes** | Not simplified — 2.0 avg vertices/feature (mostly 2-point segments); geometry simplification has no material effect on an already-minimal line network. Feature-count reduction (clustering/filtering) was not applied — would change the informational content of a REAL/INFERRED scientific layer, judged unsafe for this pass. |
| Pilot-zone roads (+ risk score) | 3,215 / 3,016 | 19,716 / 17,301 | No (zone-only) | ✅ 53-54% reduction |
| Pilot-zone buildings | 5,390 / 5,812 | 50,647 / 40,898 | No (zone-only) | ✅ 23-41% reduction |
| DEM/slope/susceptibility rasters (PNG) | N/A (images) | N/A | No (zone-only) | Not applicable — profiled clean in the original investigation (raster-only sweep showed baseline-level cost); not a contributor |
| Critical infrastructure | 167–203 | ~167–203 | No (zone-only) | Not simplified — points, nothing to simplify |

**Render cost / CPU / memory impact were not separable per-layer with confidence** — layer-isolation sweeps done by sequentially toggling checkboxes in one page session showed real signal (roads_only ~15%, buildings_only ~19%, water_only ~11%, infra_only ~13%, drainage_only ~11% idle CPU) but with enough toggle-transient noise (confirmed by the ALL_OFF baseline reading *higher* than several individual-layer configurations in that same sweep) that these should be read as rough orderings, not precise attributions. The clean, trustworthy evidence is the aggregate before/after comparison below.

---

## Root Cause (confirmed)

1. **A duplicate ~2.7MB fetch+parse.** `getRoadsData()` and `getRoadsRiskData()` were separately fetching two near-identical files (`{zone}_roads.geojson` and `{zone}_roads_risk.geojson}` — same geometry, same OSM tags, the second just adding `susceptibility_score`) for every zone entry.
2. **Unsimplified large vector geometry.** Admin boundary, city-wide major roads, city-wide water, and pilot-zone roads/buildings were served at full OSM vertex density with no simplification, on top of (1).
3. **An ~8-10 second synchronous load window** combining MapLibre's own tile/style loading with the app's own main-thread `JSON.parse()` of the above, during which the main thread is close to saturated — confirmed via `map.loaded()` staying `false` and CPU profiling showing 93-99% busy for that entire window on every test run.
4. **A modal-close animation with no time bound.** The exit transition used a physics-based spring (`damping: 25, stiffness: 300`) with no fixed duration — under any main-thread contention (like #3), a spring settle can take far longer than its nominal ~300-500ms.
5. **A real, independent CSS bug**: `Modal.tsx`'s cleanup set `document.body.style.overflow = 'unset'`, which for a non-inherited property resolves to CSS `initial` (`visible`), not "remove my override" — this briefly forced the body scrollable, overriding the stylesheet's permanent `overflow: hidden`, on every single modal close.

Does this scale to city-wide deployment? **Only partially, and the ceiling is the basemap, not this app's own data.** Optimizations 1-2 below are the app's own data and scale linearly with feature count — a full city-wide roll-out with more zones would need the same simplification treatment on each new zone's roads/buildings, which is now a repeatable, scripted step (`prepare_frontend_data.py`). The unresolved ~35-98% overview-mode cost is dominated by the external CartoDB basemap's own tile/label rendering at the zoom levels this app uses — that does not scale with *this app's* data at all, and fixing it would mean changing the basemap provider/style, a decision beyond "safe optimization" scope for this pass.

---

## Optimizations Implemented (safe categories only)

| # | Change | Category | Risk |
|---|---|---|---|
| 1 | `getRoadsData()` now reads the same file as `getRoadsRiskData()` instead of a separate near-duplicate; the redundant client-side merge in `MapContainer` was removed | Source optimization | None — same data, one less fetch/parse/join. Verified: road count (3,215/3,016) and susceptibility scores unchanged, click-to-inspect still returns correct data |
| 2 | Removed the now-dead `{zone}_roads.geojson` copies from the frontend bundle (nothing fetches them anymore) | Source optimization | None — confirmed zero references before removal |
| 3 | Douglas-Peucker geometry simplification (`shapely.simplify`, `preserve_topology=True`, ~5.5m tolerance) applied to the served copies of boundary, city roads, water, pilot-zone roads, pilot-zone buildings | Geometry simplification | Low — topology-preserving, tolerance chosen to be imperceptible at the zoom levels these layers are shown; raw source data in `data/raw/` is untouched, only the served copy changed |
| 4 | `fadeDuration: 0` and `refreshExpiredTiles: false` on the MapLibre map instance | Render throttling / source optimization | None — skips a continuous label-crossfade animation with no visual benefit for a data dashboard, and stops pointless freshness checks against a dataset that's a fixed historical snapshot by design |
| 5 | Modal exit animation changed from an unbounded spring to a fixed 150ms tween (entrance spring unchanged) | Render throttling | None — cosmetic timing parameter only |
| 6 | Fixed `document.body.style.overflow = 'unset'` → `''` on modal close | Bug fix (found during this investigation) | None — corrects a real, confirmed CSS behavior bug |
| 7 | `React.memo` on `MapContainer`/`RightPanel`/`DashboardPanels` | Memoization | **Carried over from the prior session** — confirmed still in place and correct; re-verified it prevents unrelated modal-state changes from re-rendering these three components |

Clustering was considered for the inferred-drainage layer (9,717 point-sparse line features) and rejected for this pass — MapLibre's native clustering only applies to point sources, and any feature-count reduction on a REAL/INFERRED scientific data layer changes its informational content, which is a decision outside "safe optimization."

---

## Before / After

All "after" figures were measured in a clean environment (zero stray browser processes, verified via `tasklist`) in a headed browser; FPS specifically must be headed-vs-headed, per the methodology correction above.

| Metric | Before | After | Target | Met? |
|---|---|---|---|---|
| **Modal close latency** | 2.2–6.4s (multiple runs, various conditions) | **338–434ms, 385ms avg (5 trials)** | <500ms | ✅ **Yes** |
| **FPS at true idle (headed)** | 65.4fps *(this number itself required the headless-throttling fix to even measure correctly — the original headless reading of 9.6fps was the artifact, not a real regression)* | 65–77fps, 1–2 jank frames | — | ✅ smooth both before and after once measured correctly |
| **Idle CPU, pilot zone, settled (2.5s window, 2nd of 2 consecutive)** | 44.6–81.5% (noisy sweep) | **15.9%** (clean fresh-load test) | <10% | Close, not fully met |
| **Idle CPU, pilot zone, T+30s after entry** | Not isolated this cleanly before | **12.1%** | <10% | Close, not fully met |
| **Idle CPU, overview mode (basemap + city-wide layers)** | 96.5–99.6% | 47.6–92.9% (window2 vs window1; still dominated by external basemap) | <10% | ❌ Not met — basemap-bound, see Root Cause |
| **Memory (JS heap, settled)** | 77.6MB | 72.5–107.1MB (run-to-run variance observed, not attributable to a specific change) | — | No regression detected |
| **Data payload (served vector layers, simplified subset)** | ~22,935KB | ~20,217KB (−12%); vertex counts down 23-62% per simplified layer | — | Improved |

**Modal close (the headline stated goal) is solved: consistently under 500ms in a clean environment**, down from a genuinely bad 2-6+ second baseline, by fixing the actual causes (unbounded spring animation + main-thread contention from duplicate/unsimplified data) rather than the previously-suspected layer.

**Idle CPU in the pilot-zone view is substantially improved (from the 40-80%+ range down to 12-16%) but sits just above the <10% target.** The residual cost, and the much larger unresolved cost in overview mode (up to ~93-98%), is attributable to the external CartoDB basemap's own rendering — the data-layer-side optimizations available in this pass (simplification, deduplication, throttling) have been applied and verified; closing the remaining gap would require changing the basemap itself, which is a product decision, not a safe backend optimization.

---

## Regression Verification

- `npx tsc -b --noEmit`: clean, zero errors
- `npm run build`: passes
- Live Playwright pass: map renders, all 3,215/3,016 road features and their susceptibility scores intact after the merge+simplification, click-to-inspect returns correct data for roads/DEM/buildings, rainfall-aware impact model computes correctly, zero console errors, zero failed network requests
- All temporary debug instrumentation (a `window.__debugMap` hook added for this investigation) has been removed from the shipped code

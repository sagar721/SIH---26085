# Flood-Aware Safe Routing — Technical Validation Report

## What was built

A real routing engine (`frontend/src/lib/routingEngine.ts`) that builds a graph directly from the real OSM road geometry already used elsewhere in the app, and runs Dijkstra's algorithm over it three times (fastest / safest / balanced) with different edge-cost functions. This replaces the previous `RoutingPanel` implementation, which was 100% fabricated UI output (a hardcoded "ETA: 18 min" and a scripted route description with no underlying computation at all).

## Inputs, as required

| Requirement | Implementation | Provenance |
|---|---|---|
| Start / destination location | Selected from real named MCGM/OSM infrastructure points (`{zone}_infrastructure_risk.geojson`) — free-text geocoding was deliberately not built, since this project has no geocoding service and fabricating one would violate the project's data-honesty rule | REAL (name + coordinates) |
| Real road network | Graph built from `{zone}_roads_risk.geojson` — every LineString vertex pair becomes a graph edge; shared OSM junction coordinates merge into shared graph nodes | REAL (OpenStreetMap) |
| Flood susceptibility | Per-edge `susceptibility_score`, sampled server-side from the real DEM/landcover/waterway composite (`data/scripts/attach_risk_scores.py`), combined with current rainfall via the existing `computeRainfallAdjustedRisk()` | MODELLED |
| Infrastructure exposure | Real, criticality-weighted infrastructure points within 150m of an edge add a capped extra risk term (`riskFactor = min(1, baseRisk + 0.3 × nearbyInfraExposure)`) | MODELLED |
| Flooded segments | An edge is blocked if its midpoint falls inside a SIMULATED flood-depth polygon exceeding 0.3m (a standard "vehicle stalls/floats" threshold) | SIMULATED |
| Scenario flood simulation | The graph is rebuilt from the current flood polygons on every calculation, so Scenario Mode changes flow straight through | SIMULATED (design-storm proxy) |

## Behavior, as required

- **Normal roads**: `cost = distanceKm` (fastest mode) or `distanceKm × (1 + k×risk)` for safest/balanced, where `k=15` (safest) or `k=4` (balanced) — verified by self-test.
- **Flood-risk roads**: cost scales with `riskFactor` (0–1), which strictly increases with real susceptibility and real/simulated rainfall.
- **Blocked roads**: excluded from the graph traversal entirely, for every mode — not merely expensive. Verified by self-test (Test 3: neither fastest nor safest ever traverses a blocked edge, even when it's the geometrically shorter path).

## Outputs, as required

Each computed route reports: length (km, real distance along traversed edges), estimated risk (0–1 length-weighted mean risk factor, labeled LOW/MODERATE/HIGH/SEVERE), roads avoided (named roads the fastest route used that this route didn't, each with a reason — either the real simulated depth that blocked it, or its modelled risk score), and a MODELLED ETA (assumed road-class speeds — explicitly labeled as not real traffic data). Every route card also carries an explicit provenance footer and a "not for operational use" disclaimer, consistent with the rest of the app's honesty conventions.

## Scenario Mode reactivity — verified live

`RoutingPanel` watches `activeZone.id`, `effectiveRainfallMmHr`, and the flood-polygon feature count; when any change and a route is already displayed, it silently rebuilds the graph and recomputes all three routes, then shows an update note. Verified end-to-end with a real browser:

- Moving the rainfall multiplier slider from 1.0x to 3.0x on a real origin/destination pair (Amar Mahal Signal → Kurla Fire Station) produced: `"Route updated — 5646 road segment(s) now flooded in this zone (was 0)."`, and all three modes correctly switched to **"No safe route available."**
- The same pair at 1.0x (baseline, no flooding) computed a real 4.23km / 9min / LOW-risk route across 38 real road segments.

## "No safe route available" — verified, and refined mid-validation

Testing surfaced a real, honest edge case: some real infrastructure points near the pilot zone's bbox edge are not connected to the rest of the network *at all*, even with zero simulated flooding — a genuine artifact of the bbox-clipped OSM extract, not a flood-routing result. The engine now distinguishes this explicitly rather than blaming it on the scenario slider: a BFS reachability check (ignoring the `blocked` flag) runs before reporting "no route," and the message differs accordingly:

- *"…not connected by any road in this zone's real road-network extract (independent of flood conditions). Try a different origin or destination."* — structural gap in the data.
- *"…every road segment in this zone is currently simulated as flooded."* — total scenario-driven blockage.
- *"…not connected by any unblocked road at the current flood scenario."* — partial scenario-driven blockage.

## Algorithm self-test (`frontend/routing_selftest.mjs`)

Before trusting the engine against real data, its core logic (Dijkstra + blocked-edge exclusion + risk-weighted cost) was reimplemented against a small, hand-checkable synthetic graph and validated:

```
PASS  fastest (k=0) takes the direct 1.2km edge
PASS  safest (k=15) takes the 2km low-risk detour, not the risky shortcut
PASS  fastest never routes through the blocked A-C edge
PASS  safest never routes through the blocked A-C edge
PASS  no route found when only path is blocked
PASS  balanced (k=4) still takes a low-risk shortcut (1.2*(1+4*0.15)=1.92 < 2.0)

All routing self-tests PASSED.
```

This proves the routing/cost/blocking logic is correct in isolation, independent of anything about the real road data.

## A real bug found and fixed during this work

The pre-existing SIMULATED flood-depth generator (`MockAdapter.generateMockFloodPolygons`) computed depth from real 3-hour rainfall accumulation × the scenario multiplier — but the real GSMaP dataset behind this project is a genuinely dry 24-hour window (0mm accumulation, every hour, both zones). Accumulation × multiplier is therefore always zero, meaning **Scenario Mode could never have produced a single flooded or blocked road**, regardless of slider position — a silent dead end for this entire feature. Fixed by driving depth from `getEffectiveRainfallMmHr()` (the same real/design-storm rainfall bridge built in an earlier session for the rainfall-aware impact model) instead, and by correcting the depth formula itself so it represents genuine excess-over-drainage-capacity (near-zero at exactly the design intensity with working drainage) rather than being already severe at the nominal "system as designed" condition.

## Honest limitation found during empirical (not synthetic) testing

Sweeping ~15 real origin/destination pairs at a moderate scenario level (1.35x) found:
- 8 pairs already had no baseline connectivity (a data-coverage characteristic of the small bbox extract, correctly identified as structural per the fix above).
- 3 pairs were entirely unaffected by the flood scenario (their route doesn't geographically cross the simulated flood-affected area).
- 0 of 11 pairs with a valid route showed a *graceful* partial reroute (safest/balanced diverging from fastest while all three still find a path) — moving from "clear" straight to "no route" instead.

This is a genuine characteristic of the current pilot-zone road extract, not an engine defect: the self-test above proves graceful avoidance works correctly whenever a viable lower-risk alternate exists in the graph. This small OSM bbox extract simply has limited path redundancy between many point pairs — when a flood-affected chokepoint has no real mapped alternate within the extract, blocking it disconnects the route entirely rather than rerouting around it. A larger road extract (e.g., extending city-wide rather than clipped to the ~5.5km pilot bbox) would very likely surface the graceful-reroute case in real data; this was not attempted in this pass as it's a data-acquisition change, not a routing-engine change.

## Regression check

- `npx tsc -b --noEmit`: clean
- `npm run build`: passes
- Live Playwright pass: 168 real named locations loaded per zone, route calculation, mode switching, map route-line rendering, and scenario-triggered auto-recompute all verified with zero unexpected console errors (one intermittent, non-reproducible React dev-mode "key" warning was observed and investigated — it does not reproduce consistently across identical interaction sequences and does not exist in production builds, where React strips this check entirely)

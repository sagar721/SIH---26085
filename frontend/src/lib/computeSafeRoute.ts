// Single place that turns "current road/flood/rainfall inputs" into a
// stored routing result — called both by the manual "Calculate Route"
// button (RoutingPanel.tsx) and by the always-mounted background recompute
// hook (useAutoRouteRecompute.ts), so a safe route already on screen never
// goes stale just because the Response & Routing tab isn't the one open.
//
// Layered fallback chain (never just "No route available" when a reasonable
// alternative exists):
//   1. Local flood-aware road graph (real OSM geometry + simulated depth).
//   2. Same graph, but tolerating a wider origin/destination snap distance —
//      covers a geocoded point that's a few hundred metres outside the
//      pilot zone's road extract, still clearly "this zone", not adjacent.
//   3. External routing API (OSRM public demo server, no key needed) — used
//      only when the local graph genuinely can't serve the pair (too far
//      outside the extract, or a disconnected component). Always labeled
//      "External routing fallback used" and never presented as flood-aware,
//      since the external engine has no knowledge of this app's flood model.
import type { Feature, FeatureCollection } from 'geojson';
import { useRoutingStore, type LocationPoint } from '../stores/useRoutingStore';
import { buildRoadGraph, findNearestNodeWithDistance, computeRoutes, type RouteMode } from './routingEngine';
import { fetchExternalRoute } from './externalRouting';

export interface SafeRouteInputs {
  zoneId: string;
  origin: LocationPoint;
  destination: LocationPoint;
  roadsRisk: FeatureCollection;
  floodSimFeatures: Feature[] | null;
  legacyFloodFeatures: Feature[];
  infraRisk: FeatureCollection | null;
  effectiveRainfallMmHr: number;
  /** true when this call was triggered by a background change (simulation
   * timestep, scenario slider, or a live rainfall refresh) rather than the
   * user pressing "Calculate Route" — controls whether a "route updated"
   * note is surfaced. */
  isAutoUpdate: boolean;
}

// Priority 1 succeeds cleanly within this distance of a real road node.
const SNAP_OK_KM = 0.3;
// Priority 2 (still local, but flagged as an expanded/degraded snap) up to
// this distance. Beyond it, the local graph doesn't meaningfully cover the
// point at all — go straight to Priority 3.
const SNAP_MAX_KM = 1.5;

// Module-level, not component state: this dedupe needs to survive the
// RoutingPanel component unmounting (the user switching Decision-Flow
// tabs away from "Response & Routing") exactly like RealDataAdapter's
// module-level fetch cache survives its callers unmounting.
let prevRouteSignature: string | null = null;

export function resetSafeRouteAutoUpdateTracking(): void {
  prevRouteSignature = null;
}

export async function computeAndStoreSafeRoutes(inputs: SafeRouteInputs): Promise<{ error: string | null }> {
  const { zoneId, origin, destination, roadsRisk, floodSimFeatures, legacyFloodFeatures, infraRisk, effectiveRainfallMmHr, isAutoUpdate } = inputs;
  const store = useRoutingStore.getState();
  store.setCalculating(true);
  store.setExternalRoute(null);
  store.setUsedExpandedSnap(false);

  const graph = buildRoadGraph(roadsRisk, floodSimFeatures, legacyFloodFeatures, infraRisk, effectiveRainfallMmHr);
  const startSnap = findNearestNodeWithDistance(graph, origin.coord);
  const endSnap = findNearestNodeWithDistance(graph, destination.coord);

  const localGraphUsable =
    startSnap !== null && endSnap !== null &&
    startSnap.distanceKm <= SNAP_MAX_KM && endSnap.distanceKm <= SNAP_MAX_KM;

  if (localGraphUsable && startSnap && endSnap) {
    const expanded = startSnap.distanceKm > SNAP_OK_KM || endSnap.distanceKm > SNAP_OK_KM;
    const { routes, normalRouteComparison } = computeRoutes(graph, startSnap.key, endSnap.key);
    const anyFound = (Object.values(routes) as { found: boolean }[]).some((r) => r.found);

    if (anyFound) {
      // Priority 1 or 2 succeeded.
      store.setUsedExpandedSnap(expanded);
      const signature = JSON.stringify(
        (Object.keys(routes) as RouteMode[]).map((m) => {
          const r = routes[m];
          return r.found ? [m, r.distanceKm.toFixed(2), r.avoidedRoads.length] : [m, 'none'];
        })
      );
      const prevBlockedCount = useRoutingStore.getState().lastBlockedEdgeCount;
      if (isAutoUpdate && prevRouteSignature && signature !== prevRouteSignature) {
        store.setUpdateNote(
          prevBlockedCount !== null && graph.blockedEdges !== prevBlockedCount
            ? `Route updated — ${graph.blockedEdges} road segment(s) now flooded in this zone (was ${prevBlockedCount}).`
            : 'Route updated — flood conditions changed.'
        );
      } else if (!isAutoUpdate) {
        store.setUpdateNote(null);
      }
      prevRouteSignature = signature;

      store.setEdgeCounts(graph.blockedEdges, graph.totalEdges);
      store.setNormalRouteComparison(normalRouteComparison);
      store.setRoutes(routes, zoneId);
      store.setCalculating(false);
      return { error: null };
    }
    // Local graph is usable but every mode came back "no route" (a genuinely
    // disconnected pair within the extract) — fall through to Priority 3.
  }

  // Priority 3: external routing fallback. A sanity cap on distance is a
  // deliberate second line of defense alongside the geocoder's own Mumbai
  // bounding box (lib/geocoding.ts) — if a mis-resolved location ever slips
  // through as a coordinate far from Mumbai, this rejects the resulting
  // route rather than displaying a many-thousand-km "route" as if it were
  // a real local option.
  const MAX_SENSIBLE_EXTERNAL_ROUTE_KM = 60;
  const external = await fetchExternalRoute(origin.coord, destination.coord);
  store.setCalculating(false);
  if (external && external.distanceKm > MAX_SENSIBLE_EXTERNAL_ROUTE_KM) {
    return { error: `The resolved locations are implausibly far apart (${external.distanceKm.toFixed(0)}km) for a Mumbai route — one of them likely didn't geocode to the intended place. Try a more specific name.` };
  }
  if (external) {
    store.setRoutes(null, zoneId);
    store.setNormalRouteComparison(null);
    store.setEdgeCounts(null, null);
    store.setExternalRoute(external);
    if (!isAutoUpdate) store.setUpdateNote(null);
    return { error: null };
  }

  // All three priorities exhausted.
  const reason = !startSnap || !endSnap
    ? 'Neither the local road network nor the external routing fallback could locate these points.'
    : !localGraphUsable
      ? 'These locations are too far outside this pilot zone\'s road network, and the external routing fallback is currently unavailable.'
      : 'These locations are not connected by any route this app could find, locally or via the external routing fallback.';
  return { error: reason };
}

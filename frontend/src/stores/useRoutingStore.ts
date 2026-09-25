import { create } from 'zustand';
import type { NormalRouteComparison, RouteMode, RouteResult } from '../lib/routingEngine';
import type { ExternalRoute } from '../lib/externalRouting';
import type { LandmarkSource } from '../lib/geocoding';

export interface LocationPoint {
  name: string;
  amenity: string;
  coord: [number, number];
  /** Where this point came from — real MCGM/OSM infrastructure, a named
   * road/building, or an external geocoder. Shown as a small badge so a
   * free-text/geocoded pick is never confused with a verified local landmark. */
  source?: LandmarkSource;
}

interface RoutingState {
  origin: LocationPoint | null;
  destination: LocationPoint | null;
  routes: Record<RouteMode, RouteResult> | null;
  // Phase 6 — "NORMAL ROUTE vs FLOOD-AWARE SAFE ROUTE": the flood-blind
  // comparison baseline, computed alongside `routes` whenever a route exists.
  normalRouteComparison: NormalRouteComparison | null;
  activeMode: RouteMode;
  isCalculating: boolean;
  lastComputedForZoneId: string | null;
  lastUpdateNote: string | null;
  lastBlockedEdgeCount: number | null;
  /** Total real road-network edges in the active zone's graph — paired with
   * lastBlockedEdgeCount to explain "what fraction of this zone is flooded"
   * (see RoutingPanel's flood-reasoning summary). */
  lastTotalEdgeCount: number | null;
  /** Priority-3 fallback (lib/externalRouting.ts) — set only when the local
   * flood-aware graph genuinely could not produce a route (origin/destination
   * outside the pilot zone's road extract, or disconnected). Never flood-aware. */
  externalRoute: ExternalRoute | null;
  /** True whenever the snapped origin or destination is more than a "close
   * enough to trust" distance from the nearest real road-network node —
   * surfaced so the UI can say so rather than silently snapping far away. */
  usedExpandedSnap: boolean;
  setOrigin: (p: LocationPoint | null) => void;
  setDestination: (p: LocationPoint | null) => void;
  setRoutes: (routes: Record<RouteMode, RouteResult> | null, zoneId: string | null) => void;
  setNormalRouteComparison: (c: NormalRouteComparison | null) => void;
  setActiveMode: (mode: RouteMode) => void;
  setCalculating: (v: boolean) => void;
  setUpdateNote: (note: string | null) => void;
  setEdgeCounts: (blocked: number | null, total: number | null) => void;
  setExternalRoute: (route: ExternalRoute | null) => void;
  setUsedExpandedSnap: (v: boolean) => void;
  clearRoutes: () => void;
}

export const useRoutingStore = create<RoutingState>((set) => ({
  origin: null,
  destination: null,
  routes: null,
  normalRouteComparison: null,
  activeMode: 'balanced',
  isCalculating: false,
  lastComputedForZoneId: null,
  lastUpdateNote: null,
  lastBlockedEdgeCount: null,
  lastTotalEdgeCount: null,
  externalRoute: null,
  usedExpandedSnap: false,
  setOrigin: (p) => set({ origin: p }),
  setDestination: (p) => set({ destination: p }),
  setRoutes: (routes, zoneId) => set({ routes, lastComputedForZoneId: zoneId }),
  setNormalRouteComparison: (c) => set({ normalRouteComparison: c }),
  setActiveMode: (mode) => set({ activeMode: mode }),
  setCalculating: (v) => set({ isCalculating: v }),
  setUpdateNote: (note) => set({ lastUpdateNote: note }),
  setEdgeCounts: (blocked, total) => set({ lastBlockedEdgeCount: blocked, lastTotalEdgeCount: total }),
  setExternalRoute: (route) => set({ externalRoute: route }),
  setUsedExpandedSnap: (v) => set({ usedExpandedSnap: v }),
  clearRoutes: () => set({ routes: null, normalRouteComparison: null, lastUpdateNote: null, lastBlockedEdgeCount: null, lastTotalEdgeCount: null, externalRoute: null, usedExpandedSnap: false }),
}));

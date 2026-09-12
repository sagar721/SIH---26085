import { create } from 'zustand';
import type { NormalRouteComparison, RouteMode, RouteResult } from '../lib/routingEngine';

export interface LocationPoint {
  name: string;
  amenity: string;
  coord: [number, number];
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
  setOrigin: (p: LocationPoint | null) => void;
  setDestination: (p: LocationPoint | null) => void;
  setRoutes: (routes: Record<RouteMode, RouteResult> | null, zoneId: string | null) => void;
  setNormalRouteComparison: (c: NormalRouteComparison | null) => void;
  setActiveMode: (mode: RouteMode) => void;
  setCalculating: (v: boolean) => void;
  setUpdateNote: (note: string | null) => void;
  setBlockedEdgeCount: (n: number | null) => void;
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
  setOrigin: (p) => set({ origin: p }),
  setDestination: (p) => set({ destination: p }),
  setRoutes: (routes, zoneId) => set({ routes, lastComputedForZoneId: zoneId }),
  setNormalRouteComparison: (c) => set({ normalRouteComparison: c }),
  setActiveMode: (mode) => set({ activeMode: mode }),
  setCalculating: (v) => set({ isCalculating: v }),
  setUpdateNote: (note) => set({ lastUpdateNote: note }),
  setBlockedEdgeCount: (n) => set({ lastBlockedEdgeCount: n }),
  clearRoutes: () => set({ routes: null, normalRouteComparison: null, lastUpdateNote: null, lastBlockedEdgeCount: null }),
}));

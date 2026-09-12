// Flood-aware safe routing engine.
//
// Builds a real road-network graph from the same real OSM LineString
// geometry already rendered on the map (data/scripts/attach_risk_scores.py
// output — real geometry + a real, DEM-sampled susceptibility_score per
// segment), runs Dijkstra's algorithm over it with three different edge-cost
// functions, and reports which roads a safer route avoided and why.
//
// Provenance of every output number:
//   - road geometry / distance          -> REAL (OpenStreetMap)
//   - susceptibility_score per segment  -> MODELLED (real DEM/landcover/waterway composite)
//   - rainfall driving the risk factor  -> OBSERVED (real GSMaP) or SIMULATED (Scenario Mode design-storm)
//   - blocked/flooded segments          -> SIMULATED (deterministic flood-depth proxy, see MockAdapter)
//   - ETA                               -> MODELLED (assumed road-class speeds, NOT real traffic)
// This module never fabricates a route through geometry that doesn't exist,
// never invents a susceptibility value, and returns "no route found" rather
// than silently ignoring a blocked segment.
import type { Feature, FeatureCollection, Position } from 'geojson';
import { computeRainfallAdjustedRisk, getCriticalityWeight } from './riskModel';

// A road is impassable by a normal vehicle above this simulated depth —
// consistent with common emergency-management guidance that ~0.3m of
// moving water can stall or float a passenger vehicle. Phase 6: this no
// longer marks a hard block by itself — see floodSeverityTier() below — it
// now marks the floor of the HIGH (heavily-penalized-but-still-routable)
// tier, with the hard block moved to SEVERE_BLOCK_DEPTH_M.
export const IMPASSABLE_DEPTH_M = 0.3;

// Hard block threshold — beyond common guidance for "impassable to most
// vehicles, including 4x4/emergency", and matches this app's own ">50cm"
// depth-display bin (see lib/colorRamps.ts DEPTH_BINS_CM) so routing and the
// map's own flood-depth legend never disagree about what "severe" means.
export const SEVERE_BLOCK_DEPTH_M = 0.5;

export type FloodSeverityTier = 'NONE' | 'MODERATE' | 'HIGH' | 'SEVERE';

/**
 * Maps a simulated flood depth to a routing severity tier, using the SAME
 * depth-bin boundaries as the map's own flood-depth legend/color ramp
 * (lib/colorRamps.ts DEPTH_BINS_CM = [15, 30, 50, 100]) — not a
 * separately-invented threshold set.
 *   NONE     (<15cm):  dry / trivial puddling
 *   MODERATE (15-30cm): a real vehicle must slow substantially
 *   HIGH     (30-50cm): at/above the IMPASSABLE_DEPTH_M "vehicles stall"
 *                        guidance — passable only as a last resort
 *   SEVERE   (>=50cm):  at/beyond "impassable for most vehicles" guidance — blocked
 */
export function floodSeverityTier(depthM: number): FloodSeverityTier {
  const depthCm = depthM * 100;
  if (depthCm < 15) return 'NONE';
  if (depthCm < 30) return 'MODERATE';
  if (depthCm < SEVERE_BLOCK_DEPTH_M * 100) return 'HIGH';
  return 'SEVERE';
}

// Graduated routing-cost multiplier per tier — DOCUMENTED, not arbitrary
// round numbers dropped in without reasoning:
//   NONE:     1x  — no penalty
//   MODERATE: 3x  — real caution/slowdown, still a reasonable choice for
//                   "fastest" if nothing better exists
//   HIGH:     10x — strongly discouraged in every mode; only chosen if it is
//                   the sole remaining connection
//   SEVERE:   edge excluded from the graph entirely (see buildRoadGraph) —
//             this entry exists only so the multiplier table stays total.
export const FLOOD_COST_MULTIPLIER: Record<FloodSeverityTier, number> = {
  NONE: 1, MODERATE: 3, HIGH: 10, SEVERE: Infinity,
};

// How far from a precomputed flood-simulation drainage-graph node (Phase 3
// output, ~37m node spacing — see data/scripts/build_drainage_graph.py
// GRID_SIZE) a road-segment midpoint will still inherit that node's depth.
// Slightly larger than the node spacing so no road segment falls through
// the gaps between nodes. Exported so Phase 8's road/infrastructure impact
// (MapContainer.tsx) uses the exact same influence radius as routing.
export const FLOOD_NODE_INFLUENCE_RADIUS_KM = 0.05;

// Extra risk cost applied to edges within this radius of a real,
// criticality-weighted at-risk infrastructure point (roughly one Mumbai
// city block) — represents preferring not to route through-traffic past a
// facility that may itself be mid-emergency-response.
const INFRA_INFLUENCE_RADIUS_KM = 0.15;

const ROAD_CLASS_SPEED_KMH: Record<string, number> = {
  motorway: 50, trunk: 50, primary: 40, secondary: 32, tertiary: 26,
  unclassified: 20, residential: 18, service: 12, living_street: 12,
};
const DEFAULT_SPEED_KMH = 18;

export type RouteMode = 'fastest' | 'safest' | 'balanced';

interface EdgeInternal {
  to: string;
  distanceKm: number;
  roadName: string;
  highway: string;
  riskFactor: number; // rainfall-adjusted risk, 0-1, real susceptibility x current rainfall (+ nearby infra influence)
  susceptibility: number | null;
  blocked: boolean;
  blockReason: string | null;
  floodDepthM: number; // SIMULATED — see buildRoadGraph's floodSimFeatures/legacyFloodFeatures precedence
  floodSeverity: FloodSeverityTier;
  floodCostMultiplier: number;
  coords: [Position, Position]; // for map rendering of this edge
}

export interface RoadGraph {
  adjacency: Map<string, EdgeInternal[]>;
  nodeCoords: Map<string, [number, number]>;
  totalEdges: number;
  blockedEdges: number;
}

export interface AvoidedRoad {
  name: string;
  reason: string;
}

export interface RouteFound {
  mode: RouteMode;
  found: true;
  path: Position[];
  distanceKm: number;
  etaMinutes: number;
  estimatedRiskScore: number; // 0-1, length-weighted mean risk factor along the path
  riskLabel: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  avoidedRoads: AvoidedRoad[];
  segmentsTraversed: number;
  highRiskSegmentsTraversed: number;
}

export interface RouteNotFound {
  mode: RouteMode;
  found: false;
  reason: string;
}

export type RouteResult = RouteFound | RouteNotFound;

function nodeKey(coord: Position): string {
  // Round to ~0.11m — merges genuinely-shared OSM junction coordinates
  // (Douglas-Peucker simplification never moves a LineString's first/last
  // vertex, so real junctions stay exactly aligned) while tolerating tiny
  // floating-point drift.
  return `${coord[0].toFixed(6)},${coord[1].toFixed(6)}`;
}

function haversineKm(a: Position, b: Position): number {
  const R = 6371;
  const [lng1, lat1] = a, [lng2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function midpoint(a: Position, b: Position): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function pointInPolygon(pt: [number, number], ring: Position[]): boolean {
  // Standard ray-casting point-in-polygon test.
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const intersects = yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function findFloodDepthAtPolygons(pt: [number, number], floodFeatures: Feature[]): number {
  let maxDepth = 0;
  for (const f of floodFeatures) {
    if (f.geometry.type !== 'Polygon') continue;
    const ring = f.geometry.coordinates[0] as Position[];
    if (pointInPolygon(pt, ring)) {
      const d = parseFloat(String(f.properties?.depthMeters ?? 0));
      if (d > maxDepth) maxDepth = d;
    }
  }
  return maxDepth;
}

// Worst (max) depth among precomputed flood-simulation nodes (Phase 3 output
// — Point features carrying depth_m at the active zone/timestep/scenario)
// within FLOOD_NODE_INFLUENCE_RADIUS_KM of a point. Exported for reuse by
// Phase 8's road/infrastructure impact (MapContainer.tsx), so routing and
// impact status are never computed from two different depth lookups.
export function findFloodDepthAtSimNodes(pt: [number, number], simFeatures: Feature[]): number {
  let maxDepth = 0;
  for (const f of simFeatures) {
    if (f.geometry.type !== 'Point') continue;
    const coord = f.geometry.coordinates as [number, number];
    if (haversineKm(pt, coord) <= FLOOD_NODE_INFLUENCE_RADIUS_KM) {
      const d = parseFloat(String(f.properties?.depth_m ?? 0));
      if (d > maxDepth) maxDepth = d;
    }
  }
  return maxDepth;
}

// Precedence: the precomputed drainage-graph flood-simulation frame
// (Phase 1-4) is authoritative whenever it has loaded — the legacy
// Scenario-Mode mock flood polygons are used ONLY as a loading-state
// fallback (e.g. the very first render, before the frame fetch resolves),
// never alongside it once real simulation data exists, per Phase 6's
// "do not use the old formula when the new simulation is active" requirement.
function findFloodDepthAt(pt: [number, number], simFeatures: Feature[] | null, legacyFloodFeatures: Feature[]): number {
  if (simFeatures && simFeatures.length > 0) {
    return findFloodDepthAtSimNodes(pt, simFeatures);
  }
  return findFloodDepthAtPolygons(pt, legacyFloodFeatures);
}

interface InfraPoint { coord: [number, number]; exposureRisk: number }

function buildInfraInfluence(infraRisk: FeatureCollection | null, rainfallMmHr: number): InfraPoint[] {
  if (!infraRisk) return [];
  return infraRisk.features
    .filter((f) => f.geometry.type === 'Point' && typeof f.properties?.susceptibility_score === 'number')
    .map((f) => {
      const coord = (f.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
      const susceptibility = f.properties!.susceptibility_score as number;
      const weight = getCriticalityWeight(f.properties?.amenity as string | undefined);
      const exposureRisk = computeRainfallAdjustedRisk(susceptibility, rainfallMmHr) * weight;
      return { coord, exposureRisk };
    });
}

function nearbyInfraRisk(pt: [number, number], infra: InfraPoint[]): number {
  let maxNearby = 0;
  for (const p of infra) {
    if (haversineKm(pt, p.coord) <= INFRA_INFLUENCE_RADIUS_KM) {
      maxNearby = Math.max(maxNearby, p.exposureRisk);
    }
  }
  return maxNearby;
}

// Builds the real-road-network graph for one pilot zone under the current
// rainfall/scenario/timestep conditions. roadsRisk carries real geometry +
// real susceptibility_score (data/scripts/attach_risk_scores.py); infraRisk
// supplies the infrastructure-exposure influence term.
//
// Flood depth per road segment comes from TWO possible sources, in strict
// precedence order (see findFloodDepthAt): `floodSimFeatures` — the
// precomputed drainage-graph flood-simulation frame at the currently
// selected T+0..180 timestep (Phase 1-4) — is used whenever it has loaded;
// `legacyFloodFeatures` (the old Scenario-Mode mock flood polygons) is only
// a loading-state fallback, never a competing source once real simulation
// data exists.
export function buildRoadGraph(
  roadsRisk: FeatureCollection,
  floodSimFeatures: Feature[] | null,
  legacyFloodFeatures: Feature[],
  infraRisk: FeatureCollection | null,
  effectiveRainfallMmHr: number
): RoadGraph {
  const adjacency = new Map<string, EdgeInternal[]>();
  const nodeCoords = new Map<string, [number, number]>();
  const infra = buildInfraInfluence(infraRisk, effectiveRainfallMmHr);
  let totalEdges = 0;
  let blockedEdges = 0;

  const addEdge = (from: string, edge: EdgeInternal) => {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from)!.push(edge);
  };

  for (const feature of roadsRisk.features) {
    if (feature.geometry.type !== 'LineString') continue;
    const coords = feature.geometry.coordinates;
    if (coords.length < 2) continue;
    const susceptibility = typeof feature.properties?.susceptibility_score === 'number'
      ? (feature.properties.susceptibility_score as number) : null;
    const roadName = (feature.properties?.name as string) || (feature.properties?.highway as string) || 'Unnamed road';
    const highway = (feature.properties?.highway as string) || 'unclassified';

    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const distanceKm = haversineKm(a, b);
      if (distanceKm <= 0) continue;
      const mid = midpoint(a, b);

      const floodDepth = findFloodDepthAt(mid, floodSimFeatures, legacyFloodFeatures);
      const floodSeverity = floodSeverityTier(floodDepth);
      const blocked = floodSeverity === 'SEVERE';
      const floodCostMultiplier = FLOOD_COST_MULTIPLIER[floodSeverity];
      const blockReason = blocked
        ? `Flooded — ${floodDepth.toFixed(2)}m simulated depth (SEVERE) exceeds the ${SEVERE_BLOCK_DEPTH_M}m vehicle-passable threshold`
        : null;

      const baseRisk = susceptibility !== null ? computeRainfallAdjustedRisk(susceptibility, effectiveRainfallMmHr) : 0;
      const infraNearby = nearbyInfraRisk(mid, infra);
      // Real susceptibility-driven risk dominates; nearby critical
      // infrastructure exposure adds a smaller, capped influence.
      const riskFactor = Math.min(1, baseRisk + 0.3 * infraNearby);

      const keyA = nodeKey(a), keyB = nodeKey(b);
      nodeCoords.set(keyA, [a[0], a[1]]);
      nodeCoords.set(keyB, [b[0], b[1]]);

      const edgeAB: EdgeInternal = { to: keyB, distanceKm, roadName, highway, riskFactor, susceptibility, blocked, blockReason, floodDepthM: floodDepth, floodSeverity, floodCostMultiplier, coords: [a, b] };
      const edgeBA: EdgeInternal = { to: keyA, distanceKm, roadName, highway, riskFactor, susceptibility, blocked, blockReason, floodDepthM: floodDepth, floodSeverity, floodCostMultiplier, coords: [b, a] };
      addEdge(keyA, edgeAB);
      addEdge(keyB, edgeBA); // real streets are traversable both directions absent one-way data we trust for routing
      totalEdges++;
      if (blocked) blockedEdges++;
    }
  }

  return { adjacency, nodeCoords, totalEdges, blockedEdges };
}

export function findNearestNode(graph: RoadGraph, point: [number, number]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const [key, coord] of graph.nodeCoords.entries()) {
    const d = haversineKm(point, coord);
    if (d < bestDist) { bestDist = d; best = key; }
  }
  return best;
}

const COST_WEIGHT: Record<RouteMode, number> = {
  fastest: 0,
  balanced: 4,
  safest: 15,
};

// Binary-heap-backed Dijkstra over the real road graph. Blocked edges are
// excluded from traversal entirely (impassable, not merely "expensive") for
// every mode — only the risk WEIGHTING differs between fastest/balanced/safest.
// Plain BFS reachability check that ignores the `blocked` flag entirely —
// used only to distinguish "disconnected because of flooding" from
// "disconnected regardless of flooding" (a real gap in the bbox-clipped
// road extract) for honest error messaging.
function dijkstraIgnoringBlocks(graph: RoadGraph, startKey: string, endKey: string): boolean | null {
  if (!graph.adjacency.has(startKey)) return null;
  const visited = new Set<string>([startKey]);
  const queue = [startKey];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === endKey) return true;
    for (const edge of graph.adjacency.get(node) ?? []) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return null;
}

// `ignoreFlood`: used only by computeNormalRoute() below to compute the
// "as if there were no flooding at all" comparison baseline — a real
// pre-flood-aware navigation app's route, so its difference from the
// flood-aware routes is meaningful (how much distance/time flood-awareness
// costs, and how many flooded segments the naive route would have crossed).
function dijkstra(
  graph: RoadGraph, startKey: string, endKey: string, mode: RouteMode, ignoreFlood = false
): { path: string[]; distanceKm: number } | null {
  const k = COST_WEIGHT[mode];
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();
  const visited = new Set<string>();
  // Simple binary min-heap of [cost, node].
  const heap: [number, string][] = [[0, startKey]];
  dist.set(startKey, 0);

  const heapPush = (item: [number, string]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] <= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const heapPop = (): [number, string] | undefined => {
    if (heap.length === 0) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let smallest = i;
        if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
        if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const [cost, node] = heapPop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    if (node === endKey) break;

    const edges = graph.adjacency.get(node) ?? [];
    for (const edge of edges) {
      if (edge.blocked && !ignoreFlood) continue; // impassable for every flood-aware route mode
      // Flood depth adds a graduated cost penalty (see FLOOD_COST_MULTIPLIER)
      // to EVERY mode, not just safest/balanced — even "fastest" should not
      // treat a moderately-flooded road as free; k only controls the EXTRA
      // susceptibility-based risk aversion on top of that physical cost.
      const edgeCost = ignoreFlood
        ? edge.distanceKm
        : edge.distanceKm * (1 + k * edge.riskFactor) * edge.floodCostMultiplier;
      const next = cost + edgeCost;
      if (next < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, next);
        prev.set(edge.to, node);
        heapPush([next, edge.to]);
      }
    }
  }

  if (!dist.has(endKey)) return null;

  const path: string[] = [endKey];
  let cur = endKey;
  while (cur !== startKey) {
    const p = prev.get(cur);
    if (!p) return null;
    path.unshift(p);
    cur = p;
  }

  // Real distance along the path (not the risk-weighted cost) — the two
  // diverge whenever k > 0, and displayed "route length" must be real km.
  let distanceKm = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const edges = graph.adjacency.get(path[i]) ?? [];
    const edge = edges.find((e) => e.to === path[i + 1]);
    if (edge) distanceKm += edge.distanceKm;
  }

  return { path, distanceKm };
}

function edgeLookup(graph: RoadGraph, from: string, to: string): EdgeInternal | null {
  return (graph.adjacency.get(from) ?? []).find((e) => e.to === to) ?? null;
}

function summarizePath(graph: RoadGraph, pathNodes: string[]): {
  positions: Position[]; distanceKm: number; etaMinutes: number; riskWeightedSum: number;
  segmentsTraversed: number; highRiskSegmentsTraversed: number; roadKeysUsed: Set<string>;
} {
  const positions: Position[] = [graph.nodeCoords.get(pathNodes[0])!];
  let distanceKm = 0, etaMinutes = 0, riskWeightedSum = 0, highRisk = 0;
  const roadKeysUsed = new Set<string>();
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const edge = edgeLookup(graph, pathNodes[i], pathNodes[i + 1]);
    if (!edge) continue;
    positions.push(edge.coords[1]);
    distanceKm += edge.distanceKm;
    etaMinutes += (edge.distanceKm / (ROAD_CLASS_SPEED_KMH[edge.highway] ?? DEFAULT_SPEED_KMH)) * 60;
    riskWeightedSum += edge.riskFactor * edge.distanceKm;
    if (edge.riskFactor > 0.5) highRisk++;
    roadKeysUsed.add(`${edge.roadName}|${nodeKey([Math.min(edge.coords[0][0], edge.coords[1][0]), Math.min(edge.coords[0][1], edge.coords[1][1])])}`);
  }
  return { positions, distanceKm, etaMinutes, riskWeightedSum, segmentsTraversed: pathNodes.length - 1, highRiskSegmentsTraversed: highRisk, roadKeysUsed };
}

function riskLabel(score: number): RouteFound['riskLabel'] {
  if (score > 0.75) return 'SEVERE';
  if (score > 0.5) return 'HIGH';
  if (score > 0.25) return 'MODERATE';
  return 'LOW';
}

// Computes all three routes (fastest/safest/balanced) between two points
// already snapped to real road-network nodes. "Avoided roads" for
// safest/balanced is the set of named roads the fastest route would have
// used but this route didn't, each annotated with why (blocked + simulated
// depth, or high modelled risk under current rainfall).
export function computeRoutes(graph: RoadGraph, startKey: string, endKey: string): Record<RouteMode, RouteResult> {
  const results = {} as Record<RouteMode, RouteResult>;
  const fastestRaw = dijkstra(graph, startKey, endKey, 'fastest');
  const fastestSummary = fastestRaw ? summarizePath(graph, fastestRaw.path) : null;
  // If even a pure distance search (which already excludes blocked edges)
  // fails, check whether the two points are connected AT ALL in the raw
  // extract, ignoring flooding entirely — real bbox-clipped OSM data can
  // contain genuinely disconnected fragments (a point near the zone edge
  // whose only real road connections lie outside the extract). That's a
  // data-coverage gap, not a flood-routing result, and must be reported as
  // such rather than implying the scenario slider caused it.
  const structurallyConnected = fastestRaw !== null || dijkstraIgnoringBlocks(graph, startKey, endKey) !== null;

  (['fastest', 'safest', 'balanced'] as RouteMode[]).forEach((mode) => {
    const raw = mode === 'fastest' ? fastestRaw : dijkstra(graph, startKey, endKey, mode);
    if (!raw) {
      let reason: string;
      if (!structurallyConnected) {
        reason = 'No safe route available — these two locations are not connected by any road in this zone\'s real road-network extract (independent of flood conditions). Try a different origin or destination.';
      } else if (graph.blockedEdges === graph.totalEdges) {
        reason = 'No safe route available — every road segment in this zone is currently simulated as flooded.';
      } else {
        reason = 'No safe route available — the origin and destination are not connected by any unblocked road at the current flood scenario.';
      }
      results[mode] = { mode, found: false, reason };
      return;
    }
    const summary = summarizePath(graph, raw.path);
    const avoidedRoads: AvoidedRoad[] = [];
    if (fastestSummary && mode !== 'fastest') {
      const seen = new Set<string>();
      for (let i = 0; i < fastestRaw!.path.length - 1; i++) {
        const edge = edgeLookup(graph, fastestRaw!.path[i], fastestRaw!.path[i + 1]);
        if (!edge) continue;
        const usedByThisRoute = summary.roadKeysUsed.has(
          `${edge.roadName}|${nodeKey([Math.min(edge.coords[0][0], edge.coords[1][0]), Math.min(edge.coords[0][1], edge.coords[1][1])])}`
        );
        if (usedByThisRoute || seen.has(edge.roadName)) continue;
        if (edge.blocked) {
          seen.add(edge.roadName);
          avoidedRoads.push({ name: edge.roadName, reason: edge.blockReason! });
        } else if (edge.floodSeverity === 'HIGH' || edge.floodSeverity === 'MODERATE') {
          seen.add(edge.roadName);
          avoidedRoads.push({
            name: edge.roadName,
            reason: `${edge.floodSeverity} simulated flood depth (${edge.floodDepthM.toFixed(2)}m) — high routing cost penalty (${edge.floodCostMultiplier}x)`,
          });
        } else if (edge.riskFactor > 0.4) {
          seen.add(edge.roadName);
          avoidedRoads.push({
            name: edge.roadName,
            reason: `High modelled risk (${edge.riskFactor.toFixed(2)}) — susceptibility ${edge.susceptibility?.toFixed(2) ?? 'n/a'} under current rainfall`,
          });
        }
      }
    }
    const riskScore = summary.distanceKm > 0 ? summary.riskWeightedSum / summary.distanceKm : 0;
    results[mode] = {
      mode, found: true,
      path: summary.positions,
      distanceKm: summary.distanceKm,
      etaMinutes: summary.etaMinutes,
      estimatedRiskScore: riskScore,
      riskLabel: riskLabel(riskScore),
      avoidedRoads: avoidedRoads.slice(0, 8),
      segmentsTraversed: summary.segmentsTraversed,
      highRiskSegmentsTraversed: summary.highRiskSegmentsTraversed,
    };
  });

  return results;
}

export interface NormalRouteComparison {
  normalRoute: RouteResult;
  /** How many segments the flood-blind "normal" route would cross that are
   * currently at HIGH or SEVERE simulated flood severity — 0 when the
   * normal and flood-aware routes coincide or no flooding exists. */
  floodedSegmentsOnNormalRoute: number;
}

// "NORMAL ROUTE" (Phase 6 / Step: "Show NORMAL ROUTE vs FLOOD-AWARE SAFE
// ROUTE"): the shortest path a flood-blind navigation app would give —
// pure distance, blocked edges included, no risk/flood cost at all. Compared
// against the existing flood-aware "fastest" route so the UI can show
// concretely what flood-awareness changes (extra distance/time, and how many
// now-flooded segments the naive route would have driven through).
export function computeNormalRoute(graph: RoadGraph, startKey: string, endKey: string): NormalRouteComparison {
  const raw = dijkstra(graph, startKey, endKey, 'fastest', true);
  if (!raw) {
    return {
      normalRoute: {
        mode: 'fastest', found: false,
        reason: 'No route available — these two locations are not connected by any road in this zone\'s real road-network extract, independent of flooding.',
      },
      floodedSegmentsOnNormalRoute: 0,
    };
  }
  const summary = summarizePath(graph, raw.path);
  let floodedSegments = 0;
  for (let i = 0; i < raw.path.length - 1; i++) {
    const edge = edgeLookup(graph, raw.path[i], raw.path[i + 1]);
    if (edge && (edge.floodSeverity === 'HIGH' || edge.floodSeverity === 'SEVERE')) floodedSegments++;
  }
  const riskScore = summary.distanceKm > 0 ? summary.riskWeightedSum / summary.distanceKm : 0;
  return {
    normalRoute: {
      mode: 'fastest', found: true,
      path: summary.positions,
      distanceKm: summary.distanceKm,
      etaMinutes: summary.etaMinutes,
      estimatedRiskScore: riskScore,
      riskLabel: riskLabel(riskScore),
      avoidedRoads: [],
      segmentsTraversed: summary.segmentsTraversed,
      highRiskSegmentsTraversed: summary.highRiskSegmentsTraversed,
    },
    floodedSegmentsOnNormalRoute: floodedSegments,
  };
}

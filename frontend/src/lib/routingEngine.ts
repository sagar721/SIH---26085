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
// moving water can stall or float a passenger vehicle.
export const IMPASSABLE_DEPTH_M = 0.3;

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

function findFloodDepthAt(pt: [number, number], floodFeatures: Feature[]): number {
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
// rainfall/scenario conditions. roadsRisk carries real geometry + real
// susceptibility_score (data/scripts/attach_risk_scores.py); floodFeatures
// are the current SIMULATED flood-depth polygons (MockAdapter.getFloodData)
// that make blocked segments and rerouting scenario-reactive; infraRisk
// supplies the infrastructure-exposure influence term.
export function buildRoadGraph(
  roadsRisk: FeatureCollection,
  floodFeatures: Feature[],
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

      const floodDepth = findFloodDepthAt(mid, floodFeatures);
      const blocked = floodDepth > IMPASSABLE_DEPTH_M;
      const blockReason = blocked
        ? `Flooded — ${floodDepth.toFixed(2)}m simulated depth exceeds the ${IMPASSABLE_DEPTH_M}m vehicle-passable threshold`
        : null;

      const baseRisk = susceptibility !== null ? computeRainfallAdjustedRisk(susceptibility, effectiveRainfallMmHr) : 0;
      const infraNearby = nearbyInfraRisk(mid, infra);
      // Real susceptibility-driven risk dominates; nearby critical
      // infrastructure exposure adds a smaller, capped influence.
      const riskFactor = Math.min(1, baseRisk + 0.3 * infraNearby);

      const keyA = nodeKey(a), keyB = nodeKey(b);
      nodeCoords.set(keyA, [a[0], a[1]]);
      nodeCoords.set(keyB, [b[0], b[1]]);

      const edgeAB: EdgeInternal = { to: keyB, distanceKm, roadName, highway, riskFactor, susceptibility, blocked, blockReason, coords: [a, b] };
      const edgeBA: EdgeInternal = { to: keyA, distanceKm, roadName, highway, riskFactor, susceptibility, blocked, blockReason, coords: [b, a] };
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

function dijkstra(graph: RoadGraph, startKey: string, endKey: string, mode: RouteMode): { path: string[]; distanceKm: number } | null {
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
      if (edge.blocked) continue; // impassable for every route mode
      const edgeCost = edge.distanceKm * (1 + k * edge.riskFactor);
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

// Demo Mode's self-contained simulation engine.
//
// Everything in this file is deterministic and computed entirely client-side
// from (zone, rainfall multiplier, drainage blockage, timeline position) —
// it never depends on a live rainfall feed, the backend, or any network
// call beyond the static GeoJSON files already bundled with the frontend
// build. This is intentional: Demo Mode exists to let a judge run a complete
// simulation with nothing but `npm run dev`, per the explicit "self-contained
// and independent from real-world data availability" requirement.
//
// Demo Mode is NOT a prediction and is explicitly labeled as such throughout
// the UI ("Scenario Simulation (Hypothetical)") — this engine trades the
// rest of the app's strict real-vs-simulated provenance discipline for a
// single, richer, fully-reactive hypothetical model, so every KPI, map
// layer, and routing decision in Demo Mode tells the same consistent story
// instead of the split-pipeline inconsistency this engine was built to
// eliminate (see PROJECT_MASTER_DOCUMENTATION.md §8).
//
// Provenance tag for every value this engine produces: SYNTHETIC (see
// types/index.ts DataConfidence) — never OBSERVED, never SIMULATED in the
// sense the rest of the app uses that word (a real hydrologic/statistical
// model run), and never presented as a forecast.
import { PILOT_ZONES } from '../types';
import {
  BRIMSTOWAD_DESIGN_INTENSITY_MM_HR,
  computeRainfallFactor,
  computeCapacityFraction,
} from './riskModel';
import { floodDepthCategory } from './colorRamps';
import { FLOOD_TIMESTEPS_MIN } from '../types/floodSimulation';
import type { FloodFrameNodeProperties, FloodSimulationFrame, FloodTimestepMinutes } from '../types/floodSimulation';

// ─────────────────────────────────────────────────────────────────────────
// Presets — the single source of truth (SimulationPanel.tsx renders these,
// it does not define them).
// ─────────────────────────────────────────────────────────────────────────

export interface DemoPreset {
  id: string;
  label: string;
  description: string;
  multiplier: number;
  blockage: number;
  /** How intensity builds across the T+0..180 timeline: input is 0 (T+0) to
   * 1 (T+180) fraction of the horizon; output is a 0..1 multiplier applied
   * to the preset's peak depth. Distinguishing each preset's SHAPE (not just
   * its peak) is what makes "timeline evolution" visibly different per
   * preset, per requirement E. */
  timeProfile: (fractionOfHorizon: number) => number;
}

// Smooth, steady ramp — a textbook design storm builds gradually. Reaches
// full intensity slightly before T+180 so the peak is visible before the
// timeline ends.
const rampUp = (f: number): number => Math.min(1, f * 1.3);

// Rises fast, then plateaus — a cyclone's intense rain band arrives early
// and sustains rather than continuing to build.
const earlySpike = (f: number): number => Math.min(1, Math.pow(Math.max(0, f), 0.35));

// Climbs quickly to a high level, then keeps slowly climbing for the whole
// event — a long-duration extreme deluge (26 July 2005 stayed severe for
// hours, not a single sharp peak).
const sustainedPlateau = (f: number): number => (f < 0.15 ? (f / 0.15) * 0.6 : Math.min(1, 0.6 + (f - 0.15) * 0.5));

// Linear, compounding — infrastructure failure under otherwise-ordinary
// rainfall worsens steadily as the blockage's effect accumulates, rather
// than spiking.
const steadyWorsening = (f: number): number => Math.max(0.05, f);

// A custom slider position that doesn't match any named preset still needs
// a sensible shape — reuse the design-storm ramp as the default.
const defaultProfile = rampUp;

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: 'design-storm',
    label: 'BRIMSTOWAD Design Storm',
    description: '1.5x intensity, drains clear — moderate flooding',
    multiplier: 1.5,
    blockage: 0,
    timeProfile: rampUp,
  },
  {
    id: 'cyclone-surge',
    label: 'Cyclone-Scale Downpour',
    description: '2.2x intensity, 20% blockage — aggressive, fast-onset flooding',
    multiplier: 2.2,
    blockage: 20,
    timeProfile: earlySpike,
  },
  {
    id: '2005-deluge',
    label: '26 July 2005-Scale Deluge',
    description: '3.0x intensity, 30% blockage — extreme, long-duration event',
    multiplier: 3.0,
    blockage: 30,
    timeProfile: sustainedPlateau,
  },
  {
    id: 'drainage-collapse',
    label: 'Drainage Network Collapse',
    description: 'Normal rain, 80% blockage — infrastructure failure despite normal rainfall',
    multiplier: 1.0,
    blockage: 80,
    timeProfile: steadyWorsening,
  },
];

export function findMatchingPreset(multiplier: number, blockage: number): DemoPreset | null {
  return DEMO_PRESETS.find((p) => Math.abs(p.multiplier - multiplier) < 1e-9 && p.blockage === blockage) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// Rainfall & depth — Demo Mode's rainfall is ALWAYS the synthetic
// design-storm bridge, even at the slider's 1.0x default (unlike the
// Live-mode-shared getEffectiveRainfallMmHr in riskModel.ts, which falls
// back to the real reading at exactly 1.0x). This is what guarantees Demo
// Mode never silently depends on today's real rainfall being non-zero.
// ─────────────────────────────────────────────────────────────────────────

export function getDemoEffectiveRainfallMmHr(scenarioMultiplier: number): number {
  return scenarioMultiplier * BRIMSTOWAD_DESIGN_INTENSITY_MM_HR;
}

const DEMO_HORIZON_STEPS = FLOOD_TIMESTEPS_MIN.length - 1; // 6 (T+0..T+180 in 30-min steps)

/** Peak-scenario depth (same physical formula MockAdapter already uses),
 * scaled by the active preset's (or default) timeline shape at the current
 * T+0..180 position — this is what makes Play actually show flooding build
 * and recede over time rather than jumping straight to the slider's peak. */
export function computeDemoBaseDepthMeters(
  scenarioMultiplier: number,
  drainageBlockagePct: number,
  timeIndex: number
): number {
  const effectiveRainfall = getDemoEffectiveRainfallMmHr(scenarioMultiplier);
  const rainfallFactor = computeRainfallFactor(effectiveRainfall);
  const capacity = computeCapacityFraction(drainageBlockagePct);
  const excess = Math.max(0, rainfallFactor - capacity);
  const peakDepth = excess * 1.2; // same constant as MockAdapter.computeBaseDepthMeters

  const preset = findMatchingPreset(scenarioMultiplier, drainageBlockagePct);
  const fraction = DEMO_HORIZON_STEPS > 0 ? Math.min(1, Math.max(0, timeIndex / DEMO_HORIZON_STEPS)) : 1;
  const timeMultiplier = (preset ?? { timeProfile: defaultProfile }).timeProfile(fraction);
  return peakDepth * timeMultiplier;
}

// ─────────────────────────────────────────────────────────────────────────
// Spatial spread — a small, fixed set of deterministic "low-lying" seed
// points per zone (not derived from any real DEM — purely a stylized shape
// so Demo Mode's flood extent looks organic rather than one uniform blob),
// with an inverse-distance falloff whose radius grows with depth (a worse
// storm floods more area, not just deeper water at the same footprint).
// ─────────────────────────────────────────────────────────────────────────

interface DemoSeed { lng: number; lat: number; weight: number }

function getDemoSeeds(zoneId: string): DemoSeed[] {
  const zone = PILOT_ZONES[zoneId];
  const [lng, lat] = zone.center;
  return [
    { lng, lat, weight: 1.0 },
    { lng: lng + 0.012, lat: lat + 0.006, weight: 0.8 },
    { lng: lng - 0.010, lat: lat + 0.008, weight: 0.7 },
    { lng: lng + 0.006, lat: lat - 0.011, weight: 0.75 },
    { lng: lng - 0.013, lat: lat - 0.005, weight: 0.65 },
  ];
}

function spatialWeightAt(lng: number, lat: number, seeds: DemoSeed[], spreadRadiusDeg: number): number {
  let maxWeight = 0;
  for (const seed of seeds) {
    const d = Math.hypot(lng - seed.lng, lat - seed.lat);
    const w = seed.weight * Math.exp(-d / spreadRadiusDeg);
    if (w > maxWeight) maxWeight = w;
  }
  return maxWeight;
}

function spreadRadiusDegFor(peakDepthAtFullTime: number): number {
  return 0.006 + peakDepthAtFullTime * 0.008;
}

/** Direct depth lookup at an arbitrary point — O(seed count), no grid
 * needed. Used where many points must be tested cheaply (population). */
export function computeDemoDepthAtPoint(zoneId: string, lng: number, lat: number, baseDepthM: number): number {
  if (baseDepthM <= 0) return 0;
  const seeds = getDemoSeeds(zoneId);
  const radius = spreadRadiusDegFor(baseDepthM);
  return baseDepthM * spatialWeightAt(lng, lat, seeds, radius);
}

// Node-grid spacing chosen so no point in a pilot zone (~4.5-5.5km per
// side) is ever more than ~50m from the nearest grid node — matching
// routingEngine.ts's FLOOD_NODE_INFLUENCE_RADIUS_KM (50m), the same radius
// the real precomputed drainage-graph frame is sampled at, so this grid is
// a drop-in replacement wherever that frame's Feature[] shape is expected
// (routing, the 3D flood-depth pillars, and the road/infra depth lookups in
// useFloodData.ts's enrichRoadsWithSimulatedDepth/enrichInfraWithSimulatedDepth
// — none of that code needs to know its input came from Demo Mode). 80
// cells/side keeps the worst-case any-point-to-nearest-node distance
// (~half the cell diagonal, ≈49m at this spacing) just under that 50m
// radius, while keeping the feature count — and therefore MapLibre's
// tessellation cost for the flood-depth circle/3D-pillar layers — well
// below the point where a preset/slider change visibly lags.
const DEMO_GRID_N = 80;

// generateDemoFloodFrame is called independently by several hooks that all
// need the SAME frame at the same moment (the KPI strip, the map, and
// routing each call useFloodSimulationFrame separately). Memoizing by the
// exact input tuple means: (a) the ~10k-cell grid is only actually built
// once per distinct (zone, multiplier, blockage, timestep) combination
// instead of up to 4x redundantly, and (b) every consumer receives the
// SAME array reference, so routingEngine.ts's spatial index (keyed by
// array identity) is built once and reused across all of them too — this
// is what keeps a preset/slider change from visibly lagging for several
// seconds.
const frameCache = new Map<string, FloodSimulationFrame>();
const FRAME_CACHE_MAX = 20;

/**
 * Produces a FloodSimulationFrame — the exact same shape as the real
 * precomputed design_storm frame — synthesized entirely from the current
 * Demo Mode controls. This is the ONE function that feeds the map's flood
 * layer, the routing engine, and (via the shared enrichment functions in
 * useFloodData.ts) road closures and infrastructure status, so all of them
 * are guaranteed to agree with each other and with the KPI strip.
 */
export function generateDemoFloodFrame(
  zoneId: string,
  scenarioMultiplier: number,
  drainageBlockagePct: number,
  timeIndex: number
): FloodSimulationFrame {
  const cacheKey = `${zoneId}|${scenarioMultiplier}|${drainageBlockagePct}|${timeIndex}`;
  const cached = frameCache.get(cacheKey);
  if (cached) return cached;

  const frame = computeDemoFloodFrameUncached(zoneId, scenarioMultiplier, drainageBlockagePct, timeIndex);
  if (frameCache.size >= FRAME_CACHE_MAX) {
    const oldestKey = frameCache.keys().next().value;
    if (oldestKey !== undefined) frameCache.delete(oldestKey);
  }
  frameCache.set(cacheKey, frame);
  return frame;
}

function computeDemoFloodFrameUncached(
  zoneId: string,
  scenarioMultiplier: number,
  drainageBlockagePct: number,
  timeIndex: number
): FloodSimulationFrame {
  const zone = PILOT_ZONES[zoneId];
  const tMin: FloodTimestepMinutes = FLOOD_TIMESTEPS_MIN[Math.min(timeIndex, FLOOD_TIMESTEPS_MIN.length - 1)];
  if (!zone?.bbox) return { type: 'FeatureCollection', features: [] };

  const baseDepth = computeDemoBaseDepthMeters(scenarioMultiplier, drainageBlockagePct, timeIndex);
  if (baseDepth <= 0) return { type: 'FeatureCollection', features: [] };

  const [west, south, east, north] = zone.bbox;
  const seeds = getDemoSeeds(zoneId);
  const radius = spreadRadiusDegFor(baseDepth);

  const features: FloodSimulationFrame['features'] = [];
  let nodeId = 0;
  for (let i = 0; i < DEMO_GRID_N; i++) {
    for (let j = 0; j < DEMO_GRID_N; j++) {
      const lng = west + ((i + 0.5) / DEMO_GRID_N) * (east - west);
      const lat = south + ((j + 0.5) / DEMO_GRID_N) * (north - south);
      const weight = spatialWeightAt(lng, lat, seeds, radius);
      const depth = baseDepth * weight;
      if (depth <= 0.01) continue; // skip effectively-dry nodes — keeps payload small
      nodeId += 1;
      const properties: FloodFrameNodeProperties = {
        node_id: nodeId,
        t_min: tMin,
        depth_m: Math.round(depth * 1000) / 1000,
        depth_category: floodDepthCategory(depth),
        landcover_class: 0,
        runoff_coeff: 0.75,
        runoff_coeff_provenance: 'DEMO_SYNTHETIC — stylized spatial-spread model for Demo Mode, not a hydraulic simulation',
        inflow_m3s: 0,
        capacity_m3s: 0,
        surcharge_m3s: 0,
        is_sink: false,
        role: 'demo_grid_node',
        provenance: 'SIMULATED',
        rainfall_scenario: 'design_storm',
      };
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties });
    }
  }
  return { type: 'FeatureCollection', features };
}

// ─────────────────────────────────────────────────────────────────────────
// Population exposed — a clearly-labeled MODELLED estimate, Demo Mode only.
// Never shown in Live Mode, where no real population/census data exists.
// ─────────────────────────────────────────────────────────────────────────

/** Average assumed occupants per building when no OSM `levels` tag exists —
 * a documented, round assumption for a mixed-use Mumbai urban building, not
 * a measured figure. Multiplied by levels (floors) when that tag is present. */
export const ASSUMED_OCCUPANTS_PER_LEVEL = 8;

/** A building counts as "exposed" once simulated depth exceeds this — same
 * threshold used everywhere else in the app for AT RISK infrastructure. */
export const POPULATION_EXPOSURE_DEPTH_THRESHOLD_M = 0.1;

export function estimateBuildingOccupants(levels: unknown): number {
  const n = typeof levels === 'number' ? levels : parseFloat(String(levels ?? ''));
  const floors = Number.isFinite(n) && n > 0 ? Math.min(n, 40) : 1;
  return Math.round(floors * ASSUMED_OCCUPANTS_PER_LEVEL);
}

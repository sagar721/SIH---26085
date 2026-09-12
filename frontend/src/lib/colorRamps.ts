// Small, dependency-free color-ramp utilities for the flood-depth and
// rainfall-intensity visualizations.
//
// The flood-depth ramp is conceptually inspired by the "ironbow" thermal
// palette technique used in gods-eye-view-main/src/styles/thermal.js (a
// piecewise black -> purple -> red -> orange -> yellow -> white heat ramp) —
// reimplemented here from scratch as a plain TypeScript lookup table. No
// Cesium/GLSL/PostProcessStage code from that project is copied; only the
// palette-shape *idea* (low values read as "cool/dark", high values read as
// "hot/bright") carries over, applied to flood depth instead of temperature.

export type FloodDepthCategory = '0-15cm' | '15-30cm' | '30-50cm' | '50-100cm' | '>100cm';

// Depth bin thresholds (cm), per the problem statement's own visualization
// categories. These are display buckets, not an official hazard threshold.
export const DEPTH_BINS_CM = [15, 30, 50, 100] as const;
export const DEPTH_BIN_LABELS: FloodDepthCategory[] = ['0-15cm', '15-30cm', '30-50cm', '50-100cm', '>100cm'];

// ESTIMATED nominal local pooling footprint per drainage-graph node — MUST
// match data/scripts/flood_propagation_engine.py's NODE_BASIN_AREA_M2
// exactly, since this is the same assumption used to turn "N flooded nodes"
// into an area estimate both server-side (build_whatif_scenarios.py's
// peak_flooded_area_m2_estimate) and client-side (KpiStrip's Flood Coverage).
export const FLOOD_NODE_BASIN_AREA_M2 = 900;

// Ironbow-inspired stops: [depth_cm, "#rrggbb"]. Cool/dark at shallow depth,
// hot/bright at severe depth — the same perceptual idea as the God's Eye
// View ironbow ramp, tuned for a light basemap (see MapContainer.tsx's
// "Institutional Light" style) rather than a dark thermal-camera HUD.
const FLOOD_IRONBOW_STOPS: Array<[number, string]> = [
  [0, '#2A1B3D'], // near-zero: deep indigo (barely visible against basemap)
  [15, '#6A3D9A'], // purple
  [30, '#C9376D'], // magenta-red
  [50, '#E8672A'], // orange
  [100, '#F5B700'], // amber
  [150, '#FFF3B0'], // pale yellow-white (extreme, saturates like a hot ironbow highlight)
];

export function floodDepthCategory(depthM: number): FloodDepthCategory {
  const depthCm = depthM * 100;
  for (let i = 0; i < DEPTH_BINS_CM.length; i++) {
    if (depthCm < DEPTH_BINS_CM[i]) return DEPTH_BIN_LABELS[i];
  }
  return DEPTH_BIN_LABELS[DEPTH_BIN_LABELS.length - 1];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// Piecewise-linear interpolation through FLOOD_IRONBOW_STOPS — the same
// "ironbow" technique (a small ordered list of color stops interpolated by
// value) as thermal.js's ironbow(), just written for a depth-in-meters input
// and plain RGB hex output instead of a GLSL vec3.
export function floodDepthColor(depthM: number): string {
  const depthCm = Math.max(0, depthM * 100);
  const stops = FLOOD_IRONBOW_STOPS;
  if (depthCm <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [prevCm, prevColor] = stops[i - 1];
    const [curCm, curColor] = stops[i];
    if (depthCm <= curCm) {
      const t = (depthCm - prevCm) / (curCm - prevCm || 1);
      const a = hexToRgb(prevColor);
      const b = hexToRgb(curColor);
      return rgbToHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return stops[stops.length - 1][1];
}

// MapLibre `step` expression form of the same ramp, keyed on a numeric
// `depth_m` feature property — used directly in paint expressions so the
// GPU does the interpolation instead of per-feature JS.
export function floodDepthMapLibreStepExpression(propertyName = 'depth_m'): unknown[] {
  return [
    'step',
    ['coalesce', ['get', propertyName], 0],
    FLOOD_IRONBOW_STOPS[0][1],
    0.0001, FLOOD_IRONBOW_STOPS[1][1], // > 0m
    0.15, FLOOD_IRONBOW_STOPS[2][1], // >= 15cm
    0.30, FLOOD_IRONBOW_STOPS[3][1], // >= 30cm
    0.50, FLOOD_IRONBOW_STOPS[4][1], // >= 50cm
    1.00, FLOOD_IRONBOW_STOPS[5][1], // >= 100cm
  ];
}

export const FLOOD_DEPTH_LEGEND: Array<{ label: FloodDepthCategory; color: string }> = [
  { label: '0-15cm', color: FLOOD_IRONBOW_STOPS[1][1] },
  { label: '15-30cm', color: FLOOD_IRONBOW_STOPS[2][1] },
  { label: '30-50cm', color: FLOOD_IRONBOW_STOPS[3][1] },
  { label: '50-100cm', color: FLOOD_IRONBOW_STOPS[4][1] },
  { label: '>100cm', color: FLOOD_IRONBOW_STOPS[5][1] },
];

// --- Rainfall intensity ---
//
// Conceptually inspired by gods-eye-view-main/src/weatherEffectsMath.js's
// idea of mapping a rainfall rate to a bounded 0-1 visual-intensity curve —
// reimplemented here as a simple 5-bin categorical ramp (mm/hr thresholds
// straight from the problem statement) rather than that file's continuous
// weather-code-driven particle-effect curve, since this app renders rainfall
// as a MapLibre fill layer, not a 3D particle system.
export const RAINFALL_BINS_MM_HR = [10, 25, 50, 100] as const;
export type RainfallIntensityCategory = '0-10mm/h' | '10-25mm/h' | '25-50mm/h' | '50-100mm/h' | '100+mm/h';
const RAINFALL_BIN_LABELS: RainfallIntensityCategory[] = ['0-10mm/h', '10-25mm/h', '25-50mm/h', '50-100mm/h', '100+mm/h'];

const RAINFALL_COLOR_STOPS = ['#DCE8F5', '#8FB6E0', '#4A7FC4', '#2A56A0', '#152C56'];

export function rainfallIntensityCategory(mmHr: number): RainfallIntensityCategory {
  for (let i = 0; i < RAINFALL_BINS_MM_HR.length; i++) {
    if (mmHr < RAINFALL_BINS_MM_HR[i]) return RAINFALL_BIN_LABELS[i];
  }
  return RAINFALL_BIN_LABELS[RAINFALL_BIN_LABELS.length - 1];
}

export function rainfallMapLibreStepExpression(propertyName = 'intensity'): unknown[] {
  return [
    'step',
    ['coalesce', ['get', propertyName], 0],
    RAINFALL_COLOR_STOPS[0],
    10, RAINFALL_COLOR_STOPS[1],
    25, RAINFALL_COLOR_STOPS[2],
    50, RAINFALL_COLOR_STOPS[3],
    100, RAINFALL_COLOR_STOPS[4],
  ];
}

export const RAINFALL_LEGEND: Array<{ label: RainfallIntensityCategory; color: string }> = RAINFALL_BIN_LABELS.map(
  (label, i) => ({ label, color: RAINFALL_COLOR_STOPS[i] })
);

// --- Drainage graph node status ---
export type DrainageNodeStatus = 'normal' | 'approaching_capacity' | 'surcharge';

export function drainageNodeStatus(inflowM3s: number, capacityM3s: number): DrainageNodeStatus {
  if (capacityM3s <= 0) return inflowM3s > 0 ? 'surcharge' : 'normal';
  const ratio = inflowM3s / capacityM3s;
  if (ratio >= 1) return 'surcharge';
  if (ratio >= 0.7) return 'approaching_capacity';
  return 'normal';
}

export const DRAINAGE_STATUS_COLOR: Record<DrainageNodeStatus, string> = {
  normal: '#3D7A5C',
  approaching_capacity: '#C9A227',
  surcharge: '#B4392C',
};

// Rainfall-aware flood impact model — explicitly MODELLED, never OBSERVED
// or VALIDATED. Combines two real inputs:
//   1. A static, per-feature susceptibility score (0-1) sampled server-side
//      from the real DEM/landcover/waterway-derived susceptibility raster
//      (see data/scripts/attach_risk_scores.py) — provenance: MODELLED.
//   2. The real, currently-selected GSMaP rainfall intensity for the active
//      zone/hour — provenance: OBSERVED.
//
// The rainfall factor is normalized against 50 mm/hr — MCGM's own official
// post-BRIMSTOWAD storm-water design intensity (see
// data/processed/drainage/mcgm_swd_official_statistics.json,
// design_criteria.post_brimstowad_1993), not an arbitrary constant.
import type { Feature, FeatureCollection } from 'geojson';

export const BRIMSTOWAD_DESIGN_INTENSITY_MM_HR = 50;

export function computeRainfallFactor(rainfallMmHr: number): number {
  // 0 rain -> factor 0. At the official design intensity -> factor 1.
  // Capped at 3x (triple the design storm) so a single extreme hour doesn't
  // blow out the 0-1 display scale downstream.
  return Math.min(3, Math.max(0, rainfallMmHr / BRIMSTOWAD_DESIGN_INTENSITY_MM_HR));
}

export function computeRainfallAdjustedRisk(susceptibility: number, rainfallMmHr: number): number {
  return Math.min(1, susceptibility * computeRainfallFactor(rainfallMmHr));
}

// Scenario Mode <-> Rainfall-Aware Impact Model bridge.
//
// The real GSMaP rainfall acquired for this project is a genuinely dry
// 24-hour window (every hour, both pilot zones: 0.0 mm/hr — verified against
// the source CSV, not assumed). Multiplying zero by a scenario slider still
// yields zero, so without this bridge, cranking "Rainfall Multiplier" would
// visibly do nothing to the rainfall-aware model — a defect that looked like
// a wiring bug but was actually a data-honesty tradeoff (never silently
// fabricating a nonzero "observed" reading to fill the gap).
//
// The fix: Scenario Mode is reframed as "simulate a storm at N times the
// official BRIMSTOWAD design intensity" rather than "multiply today's real
// reading." At the default 1.0x position it changes nothing and the model
// runs on real OBSERVED rainfall, exactly as before. Moving the slider away
// from 1.0x explicitly switches the model's rainfall input to a SIMULATED
// design-storm intensity — never presented as observed.
export function isScenarioActive(scenarioMultiplier: number): boolean {
  return Math.abs(scenarioMultiplier - 1.0) > 1e-9;
}

export function getEffectiveRainfallMmHr(realRainfallMmHr: number, scenarioMultiplier: number): number {
  return isScenarioActive(scenarioMultiplier) ? scenarioMultiplier * BRIMSTOWAD_DESIGN_INTENSITY_MM_HR : realRainfallMmHr;
}

// Shared with MockAdapter.computeBaseDepthMeters — the single definition of
// "how much of nominal drainage capacity remains" given a % blockage. Pulled
// out here so the Situation Strip's capacity-margin statement (below) and
// the flood-depth simulator can never drift apart into two different
// notions of "capacity".
export function computeCapacityFraction(drainageBlockagePct: number): number {
  return Math.max(0.2, 1 - drainageBlockagePct / 150);
}

export interface CapacityMargin {
  rainfallFactor: number;
  capacity: number;
  excess: number; // > 0 means currently exceeding capacity
  isExceeding: boolean;
  marginPct: number; // |excess or headroom| as a % of capacity, always >= 0
}

export function computeCapacityMargin(effectiveRainfallMmHr: number, drainageBlockagePct: number): CapacityMargin {
  const rainfallFactor = computeRainfallFactor(effectiveRainfallMmHr);
  const capacity = computeCapacityFraction(drainageBlockagePct);
  const excess = rainfallFactor - capacity;
  return {
    rainfallFactor,
    capacity,
    excess,
    isExceeding: excess > 0,
    marginPct: capacity > 0 ? Math.abs(excess / capacity) * 100 : 0,
  };
}

export interface RainfallTrendPoint { rainfallMmHr: number; minutesFromNow: number }

// Honest time-to-threshold estimate for the Situation Strip headline
// ("...exceeds capacity in ~N min"). This is a genuine linear-regression
// extrapolation of a REAL recent rainfall trend, projected forward against
// the same capacity formula above — never a fabricated countdown. Returns
// null whenever the trend doesn't actually support a projection: too few
// points, a flat/falling trend, or capacity already exceeded (nothing left
// to project toward). Called out explicitly in
// FLOODWATCH_V3_DESIGN_SPEC.md §4.2.
export function estimateMinutesToCapacityThreshold(
  trend: RainfallTrendPoint[],
  drainageBlockagePct: number
): number | null {
  if (trend.length < 3) return null;
  const capacity = computeCapacityFraction(drainageBlockagePct);

  const xs = trend.map((p) => p.minutesFromNow);
  const ys = trend.map((p) => computeRainfallFactor(p.rainfallMmHr));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((a, x, i) => a + (x - meanX) * (ys[i] - meanY), 0);
  const den = xs.reduce((a, x) => a + (x - meanX) ** 2, 0);
  if (den === 0) return null;
  const slope = num / den; // rainfallFactor change per minute
  const intercept = meanY - slope * meanX;

  const currentFactor = ys[ys.length - 1];
  if (currentFactor >= capacity) return null; // already exceeding — nothing to project
  if (slope <= 1e-6) return null; // flat or falling — no honest ETA to give

  const crossingMinute = (capacity - intercept) / slope;
  const minutesFromNow = crossingMinute - xs[xs.length - 1];
  return minutesFromNow > 0 && minutesFromNow < 24 * 60 ? Math.round(minutesFromNow) : null;
}

export interface ScoredFeatureSummary {
  count: number;
  meanAdjustedRisk: number;
  highRiskCount: number; // adjusted risk > 0.5
  weightedMeanAdjustedRisk: number; // criticality-weighted mean (infra only; equals meanAdjustedRisk for roads)
}

// Infrastructure criticality tiers — a defensible, documented weighting so
// a hospital does not contribute the same "exposure" as a generic shed.
// Tiers are assigned by amenity/asset type, not by any observed damage data
// (there is none) — this is a MODELLED prioritization weight, not a
// measured criticality score.
export const CRITICALITY_TIERS = {
  VERY_HIGH: { label: 'Very High', weight: 1.0, amenities: ['hospital', 'fire_station'] },
  HIGH: { label: 'High', weight: 0.75, amenities: ['police', 'metro', 'railway'] },
  MEDIUM: { label: 'Medium', weight: 0.5, amenities: ['school', 'public_facility', 'college', 'university'] },
  LOW: { label: 'Low', weight: 0.25, amenities: [] as string[] }, // fallback for everything else
} as const;

export type CriticalityTierName = keyof typeof CRITICALITY_TIERS;

const AMENITY_TO_WEIGHT: Record<string, number> = {};
const AMENITY_TO_TIER: Record<string, CriticalityTierName> = {};
(Object.keys(CRITICALITY_TIERS) as CriticalityTierName[]).forEach((tier) => {
  CRITICALITY_TIERS[tier].amenities.forEach((a) => {
    AMENITY_TO_WEIGHT[a] = CRITICALITY_TIERS[tier].weight;
    AMENITY_TO_TIER[a] = tier;
  });
});

export function getCriticalityWeight(amenity: string | undefined): number {
  if (!amenity) return CRITICALITY_TIERS.LOW.weight;
  return AMENITY_TO_WEIGHT[amenity] ?? CRITICALITY_TIERS.LOW.weight;
}

export function getCriticalityTier(amenity: string | undefined): CriticalityTierName {
  if (!amenity) return 'LOW';
  return AMENITY_TO_TIER[amenity] ?? 'LOW';
}

function summarize(features: Feature[], rainfallMmHr: number, weighted: boolean): ScoredFeatureSummary {
  const rows = features
    .map((f) => ({
      score: f.properties?.susceptibility_score,
      weight: weighted ? getCriticalityWeight(f.properties?.amenity as string | undefined) : 1,
    }))
    .filter((r): r is { score: number; weight: number } => typeof r.score === 'number')
    .map((r) => ({ adjusted: computeRainfallAdjustedRisk(r.score, rainfallMmHr), weight: r.weight }));

  if (rows.length === 0) return { count: 0, meanAdjustedRisk: 0, highRiskCount: 0, weightedMeanAdjustedRisk: 0 };

  const meanAdjustedRisk = rows.reduce((a, r) => a + r.adjusted, 0) / rows.length;
  const totalWeight = rows.reduce((a, r) => a + r.weight, 0);
  const weightedMeanAdjustedRisk = totalWeight === 0 ? 0
    : rows.reduce((a, r) => a + r.adjusted * r.weight, 0) / totalWeight;

  return {
    count: rows.length,
    meanAdjustedRisk,
    highRiskCount: rows.filter((r) => r.adjusted > 0.5).length,
    weightedMeanAdjustedRisk,
  };
}

export function computeRoadImpactScore(roadsRisk: FeatureCollection | null, rainfallMmHr: number): ScoredFeatureSummary {
  return summarize(roadsRisk?.features ?? [], rainfallMmHr, false);
}

// Weighted by asset criticality (hospitals/fire stations count more than generic assets).
export function computeInfrastructureExposureScore(infraRisk: FeatureCollection | null, rainfallMmHr: number): ScoredFeatureSummary {
  return summarize(infraRisk?.features ?? [], rainfallMmHr, true);
}

// Categorical road status — an ADDITIONAL decision-support output layered on
// top of the existing continuous adjusted-risk score (computeRainfallAdjustedRisk),
// never a replacement for it. `affected` is the existing simulated
// flood-intersection flag (see RealDataAdapter.getRoadsData); adjustedRisk is
// the existing MODELLED susceptibility x rainfall score for the same road.
export type RoadStatus = 'NORMAL' | 'WATCH' | 'FLOODED' | 'HIGH RISK';

export function getRoadStatus(adjustedRisk: number, affected: boolean): RoadStatus {
  if (affected) return adjustedRisk > 0.5 ? 'HIGH RISK' : 'FLOODED';
  return adjustedRisk > 0.5 ? 'WATCH' : 'NORMAL';
}

export const ROAD_STATUS_COLOR: Record<RoadStatus, string> = {
  'NORMAL': '#8B8F7F',
  'WATCH': '#C9A227',
  'FLOODED': '#B4392C',
  'HIGH RISK': '#7A1F1A',
};

// Zone flood severity: a single 0-1 score blending road + criticality-weighted infrastructure exposure.
export function computeZoneFloodSeverity(
  roadsRisk: FeatureCollection | null,
  infraRisk: FeatureCollection | null,
  rainfallMmHr: number
): { score: number; label: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' } {
  const roads = computeRoadImpactScore(roadsRisk, rainfallMmHr);
  const infra = computeInfrastructureExposureScore(infraRisk, rainfallMmHr);
  const score = roads.count + infra.count === 0 ? 0
    : (roads.meanAdjustedRisk * roads.count + infra.weightedMeanAdjustedRisk * infra.count) / (roads.count + infra.count);
  const label = score > 0.75 ? 'SEVERE' : score > 0.5 ? 'HIGH' : score > 0.25 ? 'MODERATE' : 'LOW';
  return { score, label };
}

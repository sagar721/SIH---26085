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

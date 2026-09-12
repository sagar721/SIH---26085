// Deterministic Situation Brief / Recommended Action generator.
//
// Per FLOODWATCH_V3_DESIGN_SPEC.md §6.1: every sentence here is assembled
// from real, already-computed fields — never a free-generation model call.
// That's a deliberate constraint, not a shortcut: a template can be proven
// correct against its inputs, a free-text summary can't, and this project
// does not present anything it can't trace back to a real source. If a more
// natural-sounding phrasing layer is wanted later, it should be an LLM call
// given ONLY these pre-computed facts and instructed never to introduce a
// number that isn't one of them — never a replacement for this computation.
import type { ScoredFeatureSummary } from './riskModel';
import { type CapacityMargin } from './riskModel';

export type Confidence = 'Low' | 'Medium';
// 'High' is deliberately not a reachable value anywhere in this module —
// nothing in FLOODWATCH has been validated against an observed flood (see
// ValidationModal), so claiming high confidence would misrepresent that.

export interface SituationInput {
  zoneName: string;
  rainfallDataAvailable: boolean;
  realRainfallMmHr: number;
  effectiveRainfallMmHr: number;
  scenarioActive: boolean;
  drainageBlockagePct: number;
  capacityMargin: CapacityMargin;
  etaMinutes: number | null;
  zoneSeverity: { score: number; label: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' };
  roadImpact: ScoredFeatureSummary;
  infraExposure: ScoredFeatureSummary;
  affectedRoadNames: string[]; // named roads currently flagged 'affected', already deduped
  affectedAssetNames: string[]; // named critical infra currently CRITICAL/AT RISK
}

export interface SituationBrief {
  headline: string;
  briefParagraph: string;
  confidence: Confidence;
  confidenceReason: string;
}

export interface RecommendedAction {
  severity: 'Moderate' | 'High' | 'Severe';
  title: string;
  detail: string;
}

function confidenceOf(input: SituationInput): { confidence: Confidence; reason: string } {
  if (!input.rainfallDataAvailable) {
    return { confidence: 'Low', reason: 'No rainfall reading available for the current hour.' };
  }
  if (input.scenarioActive) {
    return { confidence: 'Medium', reason: 'GSMaP-calibrated susceptibility model, driven by a SIMULATED scenario rainfall — not an observed reading.' };
  }
  return { confidence: 'Medium', reason: 'GSMaP + DEM-derived susceptibility model — not validated against observed flooding.' };
}

export type HeadlineInput = Pick<
  SituationInput,
  'zoneName' | 'capacityMargin' | 'etaMinutes' | 'effectiveRainfallMmHr' | 'rainfallDataAvailable'
>;

export function generateSituationHeadline(input: HeadlineInput): string {
  const { zoneName, capacityMargin, etaMinutes, effectiveRainfallMmHr, rainfallDataAvailable } = input;

  if (!rainfallDataAvailable) {
    return `No rainfall reading available for ${zoneName} at this hour.`;
  }
  if (capacityMargin.rainfallFactor < 0.02) {
    return `No significant rainfall currently observed over ${zoneName}.`;
  }
  if (capacityMargin.isExceeding) {
    return `Rainfall of ${effectiveRainfallMmHr.toFixed(0)} mm/hr is already exceeding ${zoneName} drainage capacity by ${capacityMargin.marginPct.toFixed(0)}%.`;
  }
  if (etaMinutes !== null) {
    return `Rainfall of ${effectiveRainfallMmHr.toFixed(0)} mm/hr is projected to exceed ${zoneName} drainage capacity in ~${etaMinutes} min.`;
  }
  return `Rainfall of ${effectiveRainfallMmHr.toFixed(0)} mm/hr is running ${capacityMargin.marginPct.toFixed(0)}% below ${zoneName} drainage capacity — no exceedance projected at the current rate.`;
}

export function generateSituationBrief(input: SituationInput): SituationBrief {
  const headline = generateSituationHeadline(input);
  const { confidence, reason } = confidenceOf(input);

  const parts: string[] = [];
  if (input.rainfallDataAvailable && input.capacityMargin.rainfallFactor >= 0.02) {
    parts.push(
      input.scenarioActive
        ? `A ${(input.effectiveRainfallMmHr / 50).toFixed(1)}x design-storm scenario is being simulated over ${input.zoneName}.`
        : `Real GSMaP rainfall over ${input.zoneName} is currently ${input.realRainfallMmHr.toFixed(1)} mm/hr.`
    );
  }
  if (input.roadImpact.count > 0) {
    parts.push(
      input.affectedRoadNames.length > 0
        ? `${input.roadImpact.highRiskCount} of ${input.roadImpact.count} monitored road segments are at high modelled risk, including ${input.affectedRoadNames.slice(0, 2).join(' and ')}.`
        : `${input.roadImpact.highRiskCount} of ${input.roadImpact.count} monitored road segments are at high modelled risk.`
    );
  }
  if (input.infraExposure.highRiskCount > 0) {
    parts.push(
      input.affectedAssetNames.length > 0
        ? `${input.infraExposure.highRiskCount} critical facilities are currently at elevated exposure, including ${input.affectedAssetNames.slice(0, 2).join(' and ')}.`
        : `${input.infraExposure.highRiskCount} critical facilities are currently at elevated exposure.`
    );
  }
  if (parts.length === 0) {
    parts.push(`No elevated road or infrastructure risk is currently modelled for ${input.zoneName}.`);
  }

  return { headline, briefParagraph: parts.join(' '), confidence, confidenceReason: reason };
}

// Deliberately conservative: this project has no real MCGM pumping-station
// capacity/activation data (see SystemStatus's DRAINAGE row — "Official
// MCGM pipes: unavailable"), so it must never invent a specific pump count
// or activation instruction the way an illustrative mockup can. Every
// clause below is built only from data this app actually has.
export function generateRecommendedAction(input: SituationInput): RecommendedAction | null {
  if (input.zoneSeverity.label === 'LOW') return null;

  const clauses: string[] = [];
  if (input.roadImpact.highRiskCount > 0) {
    clauses.push(
      input.affectedRoadNames.length > 0
        ? `Restrict non-essential traffic on ${input.affectedRoadNames.slice(0, 2).join(' and ')}${input.roadImpact.highRiskCount > 2 ? ` and ${input.roadImpact.highRiskCount - 2} other segment(s)` : ''}.`
        : `Restrict non-essential traffic on ${input.roadImpact.highRiskCount} high-risk road segment(s).`
    );
  }
  if (input.infraExposure.highRiskCount > 0) {
    clauses.push(
      input.affectedAssetNames.length > 0
        ? `Alert ${input.affectedAssetNames.slice(0, 2).join(' and ')}${input.infraExposure.highRiskCount > 2 ? ` and ${input.infraExposure.highRiskCount - 2} other facility(ies)` : ''} to prepare for elevated flood exposure.`
        : `Alert ${input.infraExposure.highRiskCount} critical facility(ies) to prepare for elevated flood exposure.`
    );
  }
  if (clauses.length === 0) {
    clauses.push('Continue monitoring — no specific roads or facilities are currently flagged at high risk.');
  }

  const severity: RecommendedAction['severity'] =
    input.zoneSeverity.label === 'SEVERE' ? 'Severe' : input.zoneSeverity.label === 'HIGH' ? 'High' : 'Moderate';
  const title =
    input.roadImpact.highRiskCount > 0 && input.infraExposure.highRiskCount > 0
      ? 'Restrict traffic and alert at-risk facilities'
      : input.roadImpact.highRiskCount > 0
      ? 'Restrict non-essential traffic'
      : input.infraExposure.highRiskCount > 0
      ? 'Alert at-risk critical facilities'
      : 'Continue monitoring';

  return { severity, title, detail: clauses.join(' ') };
}

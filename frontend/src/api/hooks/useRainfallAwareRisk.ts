import { useEffect, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { useZoneStore } from '../../stores/useZoneStore';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useFloodData } from './useFloodData';
import { realAdapter } from '../adapters/RealDataAdapter';
import {
  computeRoadImpactScore,
  computeInfrastructureExposureScore,
  computeZoneFloodSeverity,
  getEffectiveRainfallMmHr,
  isScenarioActive as computeIsScenarioActive,
  type ScoredFeatureSummary,
} from '../../lib/riskModel';
import { getDemoEffectiveRainfallMmHr } from '../../lib/demoEngine';

// Rainfall-aware, timeline-aware flood impact model. Combines rainfall
// (real GSMaP intensity by default, or a SIMULATED design-storm intensity
// when Scenario Mode's rainfall multiplier is moved away from 1.0x — see
// getEffectiveRainfallMmHr) with real, DEM-sampled susceptibility scores
// attached to real road/infrastructure geometry. Explicitly MODELLED.
export function useRainfallAwareRisk() {
  const activeZone = useZoneStore((state) => state.activeZone);
  const { rainfallFeatures } = useFloodData();
  const scenarioMultiplier = useSimulationStore((state) => state.scenarioMultiplier);
  const mode = useSimulationStore((state) => state.mode);
  const [roadsRisk, setRoadsRisk] = useState<FeatureCollection | null>(null);
  const [infraRisk, setInfraRisk] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    if (!activeZone) return;
    realAdapter.getRoadsRiskData(activeZone.id).then(setRoadsRisk);
    realAdapter.getInfrastructureRiskData(activeZone.id).then(setInfraRisk);
  }, [activeZone]);

  // Distinguish "no rainfall reading for this hour" from "confirmed 0mm/hr" —
  // an empty features array means the requested timestamp had no matching
  // row (see RainfallDataService.getRowForTime), never silently defaulted.
  const rainfallDataAvailable = mode === 'demo' ? true : (rainfallFeatures?.features.length ?? 0) > 0;
  const realRainfallMmHr = (rainfallFeatures?.features[0]?.properties?.intensity as number) ?? 0;
  // Demo Mode always treats rainfall as the synthetic design-storm bridge —
  // even at the slider's 1.0x default — so it never silently falls back to
  // today's real (possibly 0mm/hr) reading. Live Mode keeps the existing
  // real-data-by-default behavior unchanged.
  const scenarioActive = mode === 'demo' ? true : computeIsScenarioActive(scenarioMultiplier);
  const effectiveRainfallMmHr = mode === 'demo'
    ? getDemoEffectiveRainfallMmHr(scenarioMultiplier)
    : getEffectiveRainfallMmHr(realRainfallMmHr, scenarioMultiplier);

  const roadImpact: ScoredFeatureSummary = computeRoadImpactScore(roadsRisk, effectiveRainfallMmHr);
  const infraExposure: ScoredFeatureSummary = computeInfrastructureExposureScore(infraRisk, effectiveRainfallMmHr);
  const zoneSeverity = computeZoneFloodSeverity(roadsRisk, infraRisk, effectiveRainfallMmHr);

  return {
    realRainfallMmHr,
    rainfallDataAvailable,
    effectiveRainfallMmHr,
    scenarioActive,
    scenarioMultiplier,
    roadImpact,
    infraExposure,
    zoneSeverity,
    roadsRisk,
    infraRisk,
  };
}

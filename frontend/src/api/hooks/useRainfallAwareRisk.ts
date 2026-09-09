import { useEffect, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import { useZoneStore } from '../../stores/useZoneStore';
import { useFloodData } from './useFloodData';
import { realAdapter } from '../adapters/RealDataAdapter';
import {
  computeRoadImpactScore,
  computeInfrastructureExposureScore,
  computeZoneFloodSeverity,
  type ScoredFeatureSummary,
} from '../../lib/riskModel';

// Rainfall-aware, timeline-aware flood impact model. Combines REAL rainfall
// (current GSMaP intensity for the active zone/hour, unscaled by the
// SIMULATED scenario sliders) with real, DEM-sampled susceptibility scores
// attached to real road/infrastructure geometry. Explicitly MODELLED.
export function useRainfallAwareRisk() {
  const activeZone = useZoneStore((state) => state.activeZone);
  const { rainfallFeatures } = useFloodData();
  const [roadsRisk, setRoadsRisk] = useState<FeatureCollection | null>(null);
  const [infraRisk, setInfraRisk] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    if (!activeZone) return;
    realAdapter.getRoadsRiskData(activeZone.id).then(setRoadsRisk);
    realAdapter.getInfrastructureRiskData(activeZone.id).then(setInfraRisk);
  }, [activeZone]);

  const realRainfallMmHr = (rainfallFeatures?.features[0]?.properties?.intensity as number) ?? 0;

  const roadImpact: ScoredFeatureSummary = computeRoadImpactScore(roadsRisk, realRainfallMmHr);
  const infraExposure: ScoredFeatureSummary = computeInfrastructureExposureScore(infraRisk, realRainfallMmHr);
  const zoneSeverity = computeZoneFloodSeverity(roadsRisk, infraRisk, realRainfallMmHr);

  return { realRainfallMmHr, roadImpact, infraExposure, zoneSeverity, roadsRisk, infraRisk };
}

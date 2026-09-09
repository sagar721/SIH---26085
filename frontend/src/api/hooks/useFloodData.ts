import { useState, useEffect } from 'react';
import type { FeatureCollection } from 'geojson';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useZoneStore } from '../../stores/useZoneStore';
import { mockAdapter } from '../adapters/MockAdapter';
import { realAdapter } from '../adapters/RealDataAdapter';
import type { FloodRiskSummary } from '../interfaces/FloodDataAdapter';

export const useFloodData = () => {
  const activeZone = useZoneStore((state) => state.activeZone);
  const activeZoneId = activeZone.id;
  
  const { timeIndex, availableTimestamps, scenarioMultiplier, drainageBlockage } = useSimulationStore();
  
  const [rainfallFeatures, setRainfallFeatures] = useState<FeatureCollection | null>(null);
  const [floodFeatures, setFloodFeatures] = useState<FeatureCollection | null>(null);
  const [infraFeatures, setInfraFeatures] = useState<FeatureCollection | null>(null);
  const [roadsFeatures, setRoadsFeatures] = useState<FeatureCollection | null>(null);
  const [riskSummary, setRiskSummary] = useState<FloodRiskSummary | null>(null);

  useEffect(() => {
    if (!activeZoneId || availableTimestamps.length === 0) return;

    const time = {
      timestamp: availableTimestamps[timeIndex],
      offsetMinutes: 0
    };

    // Rainfall: REAL (observed). Flood depth/extent: SIMULATED (no hydrology
    // backend). Infrastructure locations: REAL (OpenStreetMap), with a
    // flood-impact status derived from the simulated flood model.
    realAdapter.getRainfallData(activeZoneId, time).then(setRainfallFeatures);
    mockAdapter.getFloodData(activeZoneId, time, scenarioMultiplier, drainageBlockage).then(setFloodFeatures);
    realAdapter.getInfrastructureData(activeZoneId, time, scenarioMultiplier, drainageBlockage).then(setInfraFeatures);
    realAdapter.getRoadsData(activeZoneId, time, scenarioMultiplier, drainageBlockage).then(setRoadsFeatures);
    mockAdapter.getZoneRiskSummary(activeZoneId, time, scenarioMultiplier, drainageBlockage).then(setRiskSummary);
  }, [activeZoneId, timeIndex, availableTimestamps, scenarioMultiplier, drainageBlockage]);

  return { rainfallFeatures, floodFeatures, infraFeatures, roadsFeatures, riskSummary };
};

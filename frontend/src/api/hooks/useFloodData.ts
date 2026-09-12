import { useState, useEffect } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useZoneStore } from '../../stores/useZoneStore';
import { mockAdapter } from '../adapters/MockAdapter';
import { realAdapter } from '../adapters/RealDataAdapter';
import type { FloodRiskSummary } from '../interfaces/FloodDataAdapter';
import { findFloodDepthAtSimNodes, floodSeverityTier } from '../../lib/routingEngine';
import { FLOOD_TIMESTEPS_MIN } from '../../types/floodSimulation';

// Phase 8 — road/infrastructure flood impact is grounded in the SAME
// precomputed drainage-graph flood-simulation frame (Phase 1-4) that Phase 6
// routing uses, not a separate/looser estimate. "design_storm" is used here
// (matching the map's default flood layer — see useFloodSimulationFrame.ts);
// "observed" would be all-zero for the acquired real rainfall window anyway.
const IMPACT_SCENARIO = 'design_storm' as const;

function enrichInfraWithSimulatedDepth(infra: FeatureCollection, simFeatures: Feature[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: infra.features.map((f) => {
      if (f.geometry.type !== 'Point') return f;
      const depthM = findFloodDepthAtSimNodes(f.geometry.coordinates as [number, number], simFeatures);
      // Same 0.1m/0.5m thresholds RealDataAdapter.getInfrastructureData previously
      // used — only the depth SOURCE changes (real simulation, not a mock formula).
      const status = depthM > 0.5 ? 'CRITICAL' : depthM > 0.1 ? 'AT RISK' : 'SAFE';
      return {
        ...f,
        properties: {
          ...f.properties,
          depthMeters: depthM.toFixed(2),
          status,
          statusProvenance: 'SIMULATED (drainage-graph propagation engine, not a mock formula)',
        },
      };
    }),
  };
}

function enrichRoadsWithSimulatedDepth(roads: FeatureCollection, simFeatures: Feature[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads.features.map((f) => {
      if (f.geometry.type !== 'LineString') return f;
      const coords = f.geometry.coordinates;
      let maxDepth = 0;
      if (simFeatures.length > 0) {
        for (const i of new Set([0, Math.floor(coords.length / 2), coords.length - 1])) {
          const d = findFloodDepthAtSimNodes(coords[i] as [number, number], simFeatures);
          if (d > maxDepth) maxDepth = d;
        }
      }
      const floodSeverity = floodSeverityTier(maxDepth);
      const affected = floodSeverity === 'HIGH' || floodSeverity === 'SEVERE';
      return { ...f, properties: { ...f.properties, affected, simulatedFloodDepthM: maxDepth, floodSeverity } };
    }),
  };
}

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
      offsetMinutes: timeIndex * 30, // canonical T+0..180 step, see lib/timeline.ts
    };
    const tMin = FLOOD_TIMESTEPS_MIN[Math.min(timeIndex, FLOOD_TIMESTEPS_MIN.length - 1)];

    // Rainfall: REAL (observed). Flood extent polygon layer: SIMULATED
    // (existing Scenario-Mode mock formula, unchanged — still drives the
    // map's separate 'flood-fill' layer). Road/infra flood IMPACT below is
    // separately grounded in the real precomputed simulation (Phase 8).
    realAdapter.getRainfallData(activeZoneId, time).then(setRainfallFeatures);
    mockAdapter.getFloodData(activeZoneId, time, scenarioMultiplier, drainageBlockage).then(setFloodFeatures);

    const simFramePromise = realAdapter.getFloodSimulationFrame(activeZoneId, tMin, IMPACT_SCENARIO);

    Promise.all([
      realAdapter.getInfrastructureData(activeZoneId, time, scenarioMultiplier, drainageBlockage),
      simFramePromise,
    ]).then(([infra, simFrame]) => {
      setInfraFeatures(enrichInfraWithSimulatedDepth(infra, simFrame.features as unknown as Feature[]));
    });

    Promise.all([
      realAdapter.getRoadsData(activeZoneId, time, scenarioMultiplier, drainageBlockage),
      simFramePromise,
    ]).then(([roads, simFrame]) => {
      setRoadsFeatures(enrichRoadsWithSimulatedDepth(roads, simFrame.features as unknown as Feature[]));
    });

    mockAdapter.getZoneRiskSummary(activeZoneId, time, scenarioMultiplier, drainageBlockage).then(setRiskSummary);
  }, [activeZoneId, timeIndex, availableTimestamps, scenarioMultiplier, drainageBlockage]);

  return { rainfallFeatures, floodFeatures, infraFeatures, roadsFeatures, riskSummary };
};

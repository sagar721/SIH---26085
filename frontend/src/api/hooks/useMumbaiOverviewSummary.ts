import { useEffect, useState } from 'react';
import { PILOT_ZONES } from '../../types';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { mockAdapter } from '../adapters/MockAdapter';
import { realAdapter } from '../adapters/RealDataAdapter';
import type { FloodRiskSummary } from '../interfaces/FloodDataAdapter';

export interface ZoneOverviewRow {
  zoneId: string;
  zoneName: string;
  riskSummary: FloodRiskSummary;
  affectedRoads: number;
  totalRoads: number;
  affectedAssets: number;
  totalAssets: number;
}

// Real per-zone aggregation for the Mumbai Overview screen — fetches the
// same adapters every per-zone screen already uses, once per pilot zone,
// rather than (as the pre-V3 layout implicitly did) silently showing one
// zone's numbers under a "Greater Mumbai" label. Today this only covers
// the 2 pilot zones with real data; see FLOODCAST_V3_DESIGN_SPEC.md §3 —
// extending this to the rest of Greater Mumbai needs real citywide data,
// not a UI change.
export function useMumbaiOverviewSummary() {
  const { timeIndex, availableTimestamps, scenarioMultiplier, drainageBlockage } = useSimulationStore();
  const [rows, setRows] = useState<ZoneOverviewRow[] | null>(null);

  useEffect(() => {
    if (availableTimestamps.length === 0) return;
    let cancelled = false;
    const time = { timestamp: availableTimestamps[timeIndex], offsetMinutes: 0 };

    Promise.all(
      Object.values(PILOT_ZONES).map(async (zone) => {
        const [riskSummary, infra, roads] = await Promise.all([
          mockAdapter.getZoneRiskSummary(zone.id, time, scenarioMultiplier, drainageBlockage),
          realAdapter.getInfrastructureData(zone.id, time, scenarioMultiplier, drainageBlockage),
          realAdapter.getRoadsData(zone.id, time, scenarioMultiplier, drainageBlockage),
        ]);
        const row: ZoneOverviewRow = {
          zoneId: zone.id,
          zoneName: zone.name,
          riskSummary,
          affectedRoads: roads.features.filter((f) => f.properties?.affected).length,
          totalRoads: roads.features.length,
          affectedAssets: infra.features.filter((f) => f.properties?.status !== 'SAFE').length,
          totalAssets: infra.features.length,
        };
        return row;
      })
    ).then((result) => {
      if (!cancelled) setRows(result);
    });

    return () => { cancelled = true; };
  }, [timeIndex, availableTimestamps, scenarioMultiplier, drainageBlockage]);

  return rows;
}

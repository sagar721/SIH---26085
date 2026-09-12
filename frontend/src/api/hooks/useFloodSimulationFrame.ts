import { useEffect, useState } from 'react';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useZoneStore } from '../../stores/useZoneStore';
import { realAdapter } from '../adapters/RealDataAdapter';
import { FLOOD_TIMESTEPS_MIN } from '../../types/floodSimulation';
import type { FloodScenario, FloodSimulationFrame, FloodTimestepMinutes } from '../../types/floodSimulation';

// The scenario shown by default: the real observed window is a genuine dry
// period (0mm/hr throughout — see flood_propagation_engine.py), so there is
// nothing to visibly animate for "observed". "design_storm" is the SIMULATED
// scenario that actually exercises the drainage-graph surcharge cascade —
// this is the Phase 1-4 precomputed layer, independent of the pre-existing
// Scenario Mode rainfall/blockage sliders (which still drive the separate,
// unmodified MockAdapter flood-extent layer per useFloodData.ts).
const DEFAULT_SCENARIO: FloodScenario = 'design_storm';

/**
 * Loads the precomputed drainage-graph-node flood frame (Phase 3 output) for
 * the active zone at the current canonical timestep (useSimulationStore's
 * timeIndex, 0-6 -> T+0..T+180min). One fetch per (zone, timestep, scenario)
 * — cached by RealDataAdapter's loadStaticGeoJSON, so scrubbing back to an
 * already-visited timestep does not re-fetch.
 *
 * `enabled: false` (Phase 7 — the What-If panel's baseline/intervention
 * frames) skips the fetch entirely until the caller actually needs it, so
 * opening the What-If panel is what triggers those requests, not just
 * having the app open.
 */
export function useFloodSimulationFrame(scenario: FloodScenario = DEFAULT_SCENARIO, enabled = true) {
  const activeZoneId = useZoneStore((s) => s.activeZone.id);
  const timeIndex = useSimulationStore((s) => s.timeIndex);
  const [frame, setFrame] = useState<FloodSimulationFrame | null>(null);

  const tMin: FloodTimestepMinutes = FLOOD_TIMESTEPS_MIN[Math.min(timeIndex, FLOOD_TIMESTEPS_MIN.length - 1)];

  useEffect(() => {
    if (!enabled) {
      setFrame(null);
      return;
    }
    let cancelled = false;
    realAdapter.getFloodSimulationFrame(activeZoneId, tMin, scenario).then((fc) => {
      if (!cancelled) setFrame(fc);
    });
    return () => {
      cancelled = true;
    };
  }, [activeZoneId, tMin, scenario, enabled]);

  return { frame, tMin, scenario };
}

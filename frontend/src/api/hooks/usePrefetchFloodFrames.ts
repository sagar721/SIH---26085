import { useEffect } from 'react';
import { realAdapter } from '../adapters/RealDataAdapter';
import { FLOOD_TIMESTEPS_MIN } from '../../types/floodSimulation';
import type { FloodScenario } from '../../types/floodSimulation';

/**
 * Performance fix (Phase 9 audit): fetches all 7 T+0..180 flood-simulation
 * frames for the active zone/scenario up front, as soon as a zone is
 * entered, instead of one-at-a-time as the user scrubs/plays the timeline.
 * RealDataAdapter's loadStaticGeoJSON already caches by URL, so by the time
 * playback starts every frame is already resolved in memory — playback
 * makes zero network requests. Each frame is ~150-200KB; fetching all 7
 * up front (instead of on-demand) is a deliberate trade of a slightly
 * larger zone-entry payload for a stutter-free T+0->T+180 animation.
 */
export function usePrefetchFloodFrames(zoneId: string, scenario: FloodScenario) {
  useEffect(() => {
    FLOOD_TIMESTEPS_MIN.forEach((tMin) => {
      realAdapter.getFloodSimulationFrame(zoneId, tMin, scenario);
    });
  }, [zoneId, scenario]);
}

import { FLOOD_TIMESTEPS_MIN } from '../types/floodSimulation';

/**
 * Resamples a real hourly (or any-interval) rainfall timestamp series down
 * to exactly the 7 canonical T+0/30/60/90/120/150/180-minute offsets from
 * the series' first reading (nearest-real-reading lookup — the same
 * approach data/scripts/flood_propagation_engine.py's
 * load_observed_rainfall_mm_hr() uses server-side). Every returned
 * timestamp is a REAL ISO reading taken from the input series — none are
 * invented — this only changes which of the real readings the app's single
 * timeline points at, so the timeline is always the PS-required cadence
 * regardless of how many rows the acquired rainfall window contains.
 */
export function resampleToCanonicalTimesteps(timestampsUtc: string[]): string[] {
  if (timestampsUtc.length === 0) return [];
  const startMs = new Date(timestampsUtc[0]).getTime();
  return FLOOD_TIMESTEPS_MIN.map((offsetMin) => {
    const targetMs = startMs + offsetMin * 60_000;
    let best = timestampsUtc[0];
    let bestDelta = Infinity;
    for (const ts of timestampsUtc) {
      const delta = Math.abs(new Date(ts).getTime() - targetMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = ts;
      }
    }
    return best;
  });
}

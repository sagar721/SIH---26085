import { useEffect, useRef, useState } from 'react';
import { rainfallStatusService, type RainfallRefreshStatus } from '../services/RainfallStatusService';
import { rainfallService } from '../services/RainfallDataService';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useDataHealthStore } from '../../stores/useDataHealthStore';
import { useRainfallStatusStore } from '../../stores/useRainfallStatusStore';
import { resampleToCanonicalTimesteps } from '../../lib/timeline';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // GSMaP is hourly; no need to poll faster
const HEALTH_KEY = 'Rainfall auto-refresh feed';

/** Drives the "automatic rainfall refresh" UI contract: polls
 * rainfall_refresh_status.json (written by refresh_rainfall.py), exposes
 * Last Updated / Source / Timestamp / Data Age for display, and — when the
 * feed has advanced to a newer hour than what's currently loaded — reloads
 * the rainfall CSV and extends the timeline without discarding whatever
 * time the user has scrubbed to. If the feed is unavailable, this reports
 * into the existing data-health banner (never crashes, never hides it). */
export function useRainfallRefreshStatus() {
  const [status, setStatus] = useState<RainfallRefreshStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastKnownTimestamp = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const result = await rainfallStatusService.fetchStatus();
      if (cancelled) return;

      if (!result) {
        // No status file at all (automation not deployed / not yet run) is
        // not itself an error worth alarming an operator about — only a
        // reported "warning" status is.
        return;
      }

      setStatus(result);
      useRainfallStatusStore.getState().setStatus(result);

      if (result.status === 'warning') {
        useDataHealthStore.getState().reportFailure(HEALTH_KEY, result.message || 'Rainfall feed degraded.');
      } else {
        useDataHealthStore.getState().reportSuccess(HEALTH_KEY);
      }

      const newTimestamp = result.latest_data_timestamp_utc;
      if (newTimestamp && newTimestamp !== lastKnownTimestamp.current) {
        const wasFirstCheck = lastKnownTimestamp.current === null;
        lastKnownTimestamp.current = newTimestamp;
        if (wasFirstCheck) return; // nothing to reload against on the very first poll

        const simState = useSimulationStore.getState();
        const wasAtLatest = simState.timeIndex === Math.max(0, simState.availableTimestamps.length - 1);

        const rows = await rainfallService.refresh();
        if (cancelled || rows.length === 0) return;
        // Keep the app's one timeline at exactly the 7 canonical T+0..180min
        // steps (see lib/timeline.ts) — a refresh must not silently widen it
        // back out to the full raw series.
        const timestamps = resampleToCanonicalTimesteps(rows.map((r) => r.timestamp_utc));
        useSimulationStore.getState().setAvailableTimestamps(timestamps);
        if (wasAtLatest) {
          useSimulationStore.getState().setTimeIndex(timestamps.length - 1);
        }
      }
    };

    poll();
    const statusInterval = setInterval(poll, POLL_INTERVAL_MS);
    const clockInterval = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(statusInterval);
      clearInterval(clockInterval);
    };
  }, []);

  // Live-ticking data age rather than trusting the (only-as-fresh-as-the-
  // last-poll) data_age_hours field verbatim between polls.
  const liveDataAgeHours = status?.latest_data_timestamp_utc
    ? (now - new Date(status.latest_data_timestamp_utc).getTime()) / 3_600_000
    : null;

  return { status, dataAgeHours: liveDataAgeHours };
}

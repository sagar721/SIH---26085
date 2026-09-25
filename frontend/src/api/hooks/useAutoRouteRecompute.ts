import { useEffect, useRef } from 'react';
import { useZoneStore } from '../../stores/useZoneStore';
import { useRoutingStore } from '../../stores/useRoutingStore';
import { useFloodData } from './useFloodData';
import { useFloodSimulationFrame } from './useFloodSimulationFrame';
import { useRainfallAwareRisk } from './useRainfallAwareRisk';
import { computeAndStoreSafeRoutes, resetSafeRouteAutoUpdateTracking } from '../../lib/computeSafeRoute';

/**
 * Keeps an already-calculated safe route current with real conditions at
 * all times — mounted ONCE in CommandCenter.tsx (same pattern as
 * useRainfallRefreshStatus: "single writer, mounted once, regardless of
 * which Decision-Flow tab is open") rather than inside RoutingPanel itself.
 *
 * Before this hook existed, the recompute-on-change effect lived inside
 * RoutingPanel, which only renders while the "Response & Routing" tab is
 * selected. A dispatcher who calculated a route, then switched to the
 * Impact or Situation tab, would keep looking at a route the app never
 * updated again — silently stale exactly when conditions worsen. Moving
 * the same reactive recompute here means it keeps running no matter which
 * tab is on screen, satisfying both:
 *   - automatic recompute as the T+0..180 simulation timeline / Scenario
 *     Mode sliders move (DEMO mode), and
 *   - automatic recompute as real rainfall live-updates arrive and the
 *     LIVE-mode timeline auto-advances to the newest reading
 *     (useRainfallRefreshStatus -> useSimulationStore.setAvailableTimestamps).
 */
export function useAutoRouteRecompute(): void {
  const activeZoneId = useZoneStore((s) => s.activeZone.id);
  const { floodFeatures } = useFloodData();
  const { frame: floodSimFrame, tMin: floodSimTMin, scenario: floodSimScenario } = useFloodSimulationFrame();
  const { roadsRisk, infraRisk, effectiveRainfallMmHr } = useRainfallAwareRisk();

  const prevZoneId = useRef(activeZoneId);
  useEffect(() => {
    if (prevZoneId.current === activeZoneId) return;
    prevZoneId.current = activeZoneId;
    // A different zone's road graph shares no nodes with the previous one —
    // any origin/destination picked in the old zone is meaningless here.
    resetSafeRouteAutoUpdateTracking();
    const store = useRoutingStore.getState();
    store.setOrigin(null);
    store.setDestination(null);
    store.clearRoutes();
  }, [activeZoneId]);

  const recomputeKey = `${activeZoneId}|${effectiveRainfallMmHr.toFixed(1)}|${floodFeatures?.features.length ?? 0}|${floodSimTMin}|${floodSimScenario}`;
  const prevKey = useRef(recomputeKey);

  useEffect(() => {
    if (prevKey.current === recomputeKey) return;
    prevKey.current = recomputeKey;

    const { origin, destination } = useRoutingStore.getState();
    if (!origin || !destination || !roadsRisk) return;

    void computeAndStoreSafeRoutes({
      zoneId: activeZoneId,
      origin,
      destination,
      roadsRisk,
      floodSimFeatures: floodSimFrame?.features ?? null,
      legacyFloodFeatures: floodFeatures?.features ?? [],
      infraRisk,
      effectiveRainfallMmHr,
      isAutoUpdate: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recomputeKey]);
}

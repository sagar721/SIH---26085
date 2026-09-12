import { useEffect, useState } from 'react';
import { useZoneStore } from '../../stores/useZoneStore';
import { realAdapter } from '../adapters/RealDataAdapter';
import type { WhatIfComparison } from '../../types/floodSimulation';

/** Loads the Phase 4 baseline-vs-intervention comparison summary for the active zone. */
export function useWhatIfComparison() {
  const activeZoneId = useZoneStore((s) => s.activeZone.id);
  const [comparison, setComparison] = useState<WhatIfComparison | null>(null);

  useEffect(() => {
    let cancelled = false;
    realAdapter.getWhatIfComparison(activeZoneId).then((c) => {
      if (!cancelled) setComparison(c);
    });
    return () => {
      cancelled = true;
    };
  }, [activeZoneId]);

  return comparison;
}

import { useEffect, useState } from 'react';
import { useZoneStore } from '../../stores/useZoneStore';
import { realAdapter } from '../adapters/RealDataAdapter';
import type { DrainageGraphEdgesFC, DrainageGraphNodesFC } from '../../types/floodSimulation';

/** Loads the zone's directed drainage graph (Phase 2 output) once per zone. */
export function useDrainageGraph() {
  const activeZoneId = useZoneStore((s) => s.activeZone.id);
  const [nodes, setNodes] = useState<DrainageGraphNodesFC | null>(null);
  const [edges, setEdges] = useState<DrainageGraphEdgesFC | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      realAdapter.getDrainageGraphNodes(activeZoneId),
      realAdapter.getDrainageGraphEdges(activeZoneId),
    ]).then(([n, e]) => {
      if (!cancelled) {
        setNodes(n);
        setEdges(e);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeZoneId]);

  return { nodes, edges };
}

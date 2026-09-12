import React from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { useZoneStore } from '../../stores/useZoneStore';
import { SituationBriefPanel } from './SituationBriefPanel';
import { ImpactPanel } from './ImpactPanel';
import { SimulationPanel } from './SimulationPanel';
import { RoutingPanel } from '../routing/RoutingPanel';

export const RightRail: React.FC = () => {
  const decisionFlowTab = useUIStore((s) => s.decisionFlowTab);
  const viewMode = useUIStore((s) => s.viewMode);
  const { activeZone } = useZoneStore();

  return (
    <aside className="w-96 shrink-0 border-l border-border bg-card h-full flex flex-col">
      {viewMode === 'overview' && (
        <div className="px-4 py-2 text-[10.5px] text-muted-foreground bg-muted/50 border-b border-border shrink-0">
          Detail below is for <b className="text-foreground">{activeZone.name}</b> — pick another pilot zone from the left rail to explore it instead.
        </div>
      )}
      <div className="flex-1 min-h-0">
      {decisionFlowTab === 'situation' && <SituationBriefPanel />}
      {decisionFlowTab === 'impact' && <ImpactPanel />}
      {decisionFlowTab === 'response' && (
        <div className="p-4 h-full overflow-y-auto">
          <RoutingPanel />
        </div>
      )}
      {decisionFlowTab === 'simulation' && <SimulationPanel />}
      </div>
    </aside>
  );
};

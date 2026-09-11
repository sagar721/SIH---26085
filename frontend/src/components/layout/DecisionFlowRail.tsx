import React from 'react';
import { Radar, Waves, Route, SlidersHorizontal, BookOpen, Database, ListChecks, Globe, BarChart3 } from 'lucide-react';
import { useZoneStore } from '../../stores/useZoneStore';
import { useUIStore, type DecisionFlowTab } from '../../stores/useUIStore';
import { useFloodData } from '../../api/hooks/useFloodData';
import { PILOT_ZONES, MUMBAI_OVERVIEW } from '../../types';

const TABS: { id: DecisionFlowTab; label: string; icon: React.ElementType }[] = [
  { id: 'situation', label: 'Situation', icon: Radar },
  { id: 'impact', label: 'Impact', icon: Waves },
  { id: 'response', label: 'Response & Routing', icon: Route },
  { id: 'simulation', label: 'Simulation', icon: SlidersHorizontal },
];

export const DecisionFlowRail: React.FC = () => {
  const { activeZone, setActiveZoneId } = useZoneStore();
  const { viewMode, setViewMode, decisionFlowTab, setDecisionFlowTab, setActiveModal } = useUIStore();
  const { infraFeatures } = useFloodData();
  const impactCount = (infraFeatures?.features ?? []).filter((f) => f.properties?.status !== 'SAFE').length;

  return (
    <aside className="w-56 shrink-0 border-r border-border bg-card overflow-y-auto flex flex-col p-3">
      <div className="flex flex-col gap-1 mb-4 pb-4 border-b border-border">
        <button
          onClick={() => setViewMode('overview')}
          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
            viewMode === 'overview' ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          <Globe className="w-3.5 h-3.5" /> {MUMBAI_OVERVIEW.name}
        </button>
        {Object.values(PILOT_ZONES).map((zone) => (
          <button
            key={zone.id}
            onClick={() => { setActiveZoneId(zone.id); setViewMode('zone'); }}
            className={`text-left px-2.5 py-2 rounded-lg text-xs font-medium transition-colors truncate ${
              viewMode === 'zone' && activeZone.id === zone.id ? 'bg-primary text-primary-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {zone.name}
          </button>
        ))}
      </div>

      <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground px-2.5 pb-2">Decision Flow</div>
      <div className="flex flex-col gap-0.5 mb-4">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const on = decisionFlowTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setDecisionFlowTab(tab.id)}
              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                on ? 'bg-cyan/10 text-foreground font-semibold' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Icon className="w-4 h-4 opacity-75 shrink-0" />
              <span className="truncate">{tab.label}</span>
              {tab.id === 'impact' && impactCount > 0 && (
                <span className="ml-auto font-mono text-[10px] bg-red/10 text-red px-1.5 py-0.5 rounded-full font-semibold">{impactCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="h-px bg-border mx-2.5 mb-3" />

      <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground px-2.5 pb-2">Reference</div>
      <div className="flex flex-col gap-0.5">
        <button onClick={() => setActiveModal('analytics')} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-muted transition-colors">
          <BarChart3 className="w-4 h-4 opacity-75 shrink-0" /> Analytics
        </button>
        <button onClick={() => setActiveModal('methodology')} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-muted transition-colors">
          <BookOpen className="w-4 h-4 opacity-75 shrink-0" /> Methodology &amp; Evidence
        </button>
        <button onClick={() => setActiveModal('provenance')} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-muted transition-colors">
          <Database className="w-4 h-4 opacity-75 shrink-0" /> Data Provenance
        </button>
        <button onClick={() => setActiveModal('validation')} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-muted transition-colors">
          <ListChecks className="w-4 h-4 opacity-75 shrink-0" /> Validation Log
        </button>
      </div>
    </aside>
  );
};

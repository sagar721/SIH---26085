import React from 'react';
import { SlidersHorizontal, Info } from 'lucide-react';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { WhatIfPanel } from '../simulation/WhatIfPanel';

// The "Simulation" Decision-Flow tab — the editable Scenario Mode controls
// live here; the bottom dock (BottomDock.tsx) shows the resulting summary
// and timeline scrubber everywhere else so they stay visible without the
// sliders themselves needing to be always on screen. See
// FLOODWATCH_V3_DESIGN_SPEC.md §4.6.
export const SimulationPanel: React.FC = () => {
  const { scenarioMultiplier, setScenarioMultiplier, drainageBlockage, setDrainageBlockage } = useSimulationStore();

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <SlidersHorizontal className="w-4 h-4 text-primary" />
        Scenario Mode
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded bg-cyan/10 text-cyan border border-cyan/20">SIMULATED</span>
      </div>

      <div className="rounded-xl border border-border bg-background p-4 flex flex-col gap-5">
        <div>
          <div className="flex justify-between items-end mb-2">
            <label htmlFor="scenario-rainfall" className="text-[10px] text-muted-foreground uppercase tracking-wider">Rainfall Multiplier</label>
            <span className="font-mono text-sm font-bold text-foreground">{scenarioMultiplier.toFixed(1)}x</span>
          </div>
          <input
            id="scenario-rainfall"
            type="range" min="0.5" max="3.0" step="0.1"
            value={scenarioMultiplier}
            onChange={(e) => setScenarioMultiplier(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-primary"
          />
        </div>
        <div>
          <div className="flex justify-between items-end mb-2">
            <label htmlFor="scenario-drainage" className="text-[10px] text-muted-foreground uppercase tracking-wider">Drainage Blockage</label>
            <span className="font-mono text-sm font-bold text-red">{drainageBlockage}%</span>
          </div>
          <input
            id="scenario-drainage"
            type="range" min="0" max="100" step="5"
            value={drainageBlockage}
            onChange={(e) => setDrainageBlockage(parseInt(e.target.value))}
            className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-red"
          />
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-3.5 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          At 1.0x / 0%, every panel in this app runs on real GSMaP rainfall and a dry drainage assumption. Moving either
          slider switches the flood-depth, risk-score, and routing engines to a SIMULATED design-storm scenario — the
          Situation Strip, KPI strip, map layers, and Response &amp; Routing tab all update automatically. This is the
          same underlying scenario engine used everywhere else in the app, just given its own dedicated tab instead of
          a permanently-visible sidebar card.
        </p>
      </div>

      <WhatIfPanel />
    </div>
  );
};

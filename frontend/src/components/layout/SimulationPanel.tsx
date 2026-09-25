import React from 'react';
import { SlidersHorizontal, Info, Radio, Zap } from 'lucide-react';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { WhatIfPanel } from '../simulation/WhatIfPanel';
import { DataStatusBadge } from '../common/DataStatusBadge';
import { DEMO_PRESETS } from '../../lib/demoEngine';

// Extreme-event presets are just canned (rainfall multiplier, drainage
// blockage) pairs applied through the SAME setters the sliders below use —
// no separate data path, no new screen. Multipliers stay within the
// sliders' existing 0.5x-3.0x range so every downstream consumer (risk
// model, routing, map layers) sees an ordinary Scenario-Mode value. Defined
// once in lib/demoEngine.ts — including each preset's timeline "shape" —
// so the engine that actually computes flood depth and this panel's preset
// list can never drift apart.

// The "Simulation" Decision-Flow tab — the editable Scenario Mode controls
// live here; the bottom dock (BottomDock.tsx) shows the resulting summary
// and timeline scrubber everywhere else so they stay visible without the
// sliders themselves needing to be always on screen. See
// PROJECT_MASTER_DOCUMENTATION.md §4/§9 for the Live/Demo mode separation.
//
// This tab is the ONE surface for manual scenario controls in the whole
// app — LIVE vs DEMO does not add a second "simulation" screen, it swaps
// what this same tab renders: a locked, real-data explainer in LIVE, the
// existing sliders/presets/what-if tools in DEMO.
export const SimulationPanel: React.FC = () => {
  const { mode, setMode, scenarioMultiplier, setScenarioMultiplier, drainageBlockage, setDrainageBlockage } = useSimulationStore();

  if (mode === 'live') {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-4 gap-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          Scenario Mode
          <DataStatusBadge status="OBSERVED" className="ml-auto" />
        </div>

        <div className="rounded-xl border border-border bg-background p-5 flex flex-col items-center text-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Radio className="w-5 h-5 text-primary" />
          </div>
          <div className="text-sm font-semibold text-foreground">Live Mode is active</div>
          <p className="text-[11px] text-muted-foreground leading-relaxed max-w-[280px]">
            Every panel is running on real observed rainfall and the derived nowcast, updating automatically. Manual
            rainfall, scenario, and drainage-blockage controls — including extreme-event presets and the What-If
            drainage comparison — are disabled while Live Mode is active, so nothing on screen can silently diverge
            from real conditions.
          </p>
          <button
            onClick={() => setMode('demo')}
            className="mt-1 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-muted text-foreground hover:bg-muted/70 transition-colors inline-flex items-center gap-1.5"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> Switch to Demo Mode
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-5">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <SlidersHorizontal className="w-4 h-4 text-primary" />
        Scenario Simulation (Hypothetical)
        <DataStatusBadge status="SYNTHETIC" className="ml-auto" />
      </div>
      <p className="text-[11px] text-muted-foreground -mt-3 leading-relaxed">
        Demo Mode shows what FloodCast will look like fully operational — every value below is a self-contained,
        illustrative simulation, never real observed data.
      </p>

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

      <div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
          <Zap className="w-3 h-3" /> Extreme Event Presets
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {DEMO_PRESETS.map((preset) => {
            const active = Math.abs(scenarioMultiplier - preset.multiplier) < 1e-9 && drainageBlockage === preset.blockage;
            return (
              <button
                key={preset.id}
                onClick={() => {
                  setScenarioMultiplier(preset.multiplier);
                  setDrainageBlockage(preset.blockage);
                }}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  active ? 'bg-primary/15 border-primary/40' : 'bg-muted/40 border-border/60 hover:bg-muted/60'
                }`}
              >
                <div className={`text-[11px] font-semibold ${active ? 'text-primary' : 'text-foreground'}`}>{preset.label}</div>
                <div className="text-[10px] text-muted-foreground">{preset.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-3.5 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Moving either slider (or picking a preset) switches the flood-depth, risk-score, and routing engines to a
          SIMULATED design-storm scenario — the Situation Strip, KPI strip, map layers, and Response &amp; Routing tab
          all update automatically. Switch back to Live Mode from the top bar at any time to instantly return every
          panel to real observed rainfall — nothing here persists into Live Mode.
        </p>
      </div>

      <WhatIfPanel />
    </div>
  );
};

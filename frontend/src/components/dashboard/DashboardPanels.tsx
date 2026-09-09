import React from 'react';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { Droplets, SlidersHorizontal } from 'lucide-react';
import { DataStatusBadge } from '../common/DataStatusBadge';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useZoneStore } from '../../stores/useZoneStore';
import { RoutingPanel } from '../routing/RoutingPanel';

export const DashboardPanels: React.FC = () => {
  const { 
    scenarioMultiplier, 
    setScenarioMultiplier,
    drainageBlockage,
    setDrainageBlockage
  } = useSimulationStore();

  const { activeZone } = useZoneStore();
  const { riskSummary } = useFloodData();
  const zoneName = activeZone.name;

  return (
    <div className="flex flex-col gap-6">
      {/* Rainfall / Zone Panel */}
      <div className="bg-card text-card-foreground p-4 rounded-xl border border-border shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan">
            <Droplets size={16} />
            <h2>CURRENT ZONE RAINFALL</h2>
          </div>
          <DataStatusBadge status="OBSERVED" />
        </div>
        
        <div className="mb-4">
          <p className="text-xs text-muted-foreground uppercase">{zoneName}</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] text-muted-foreground uppercase mb-1">Intensity</div>
            <div className="font-mono text-2xl font-bold flex items-end gap-1">
              {(riskSummary ? riskSummary.peakRainfallMmHr / scenarioMultiplier : 0).toFixed(1)} <span className="text-sm font-sans font-normal text-muted-foreground mb-1">mm/hr</span>
            </div>
          </div>
        </div>
      </div>

      {/* Scenario Mode Panel */}
      <div className="bg-card text-card-foreground p-4 rounded-xl border border-border shadow-2xl border-l-4 border-l-primary">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <SlidersHorizontal size={16} />
            <h2>SCENARIO MODE</h2>
          </div>
          <DataStatusBadge status="SIMULATED" />
        </div>

        <div className="flex flex-col gap-5">
          {/* Rainfall Multiplier Slider */}
          <div>
            <div className="flex justify-between items-end mb-2">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Rainfall Multiplier</label>
              <span className="font-mono text-sm font-bold text-cyan">{scenarioMultiplier.toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3.0"
              step="0.1"
              value={scenarioMultiplier}
              onChange={(e) => setScenarioMultiplier(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-cyan"
            />
          </div>

          {/* Drainage Blockage Slider */}
          <div>
            <div className="flex justify-between items-end mb-2">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Drainage Blockage</label>
              <span className="font-mono text-sm font-bold text-red">{drainageBlockage}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={drainageBlockage}
              onChange={(e) => setDrainageBlockage(parseInt(e.target.value))}
              className="w-full h-1.5 bg-border rounded-lg appearance-none cursor-pointer accent-red"
            />
          </div>
        </div>
      </div>

      {/* Routing Panel */}
      <RoutingPanel />

      {/* System Status */}
      <div className="bg-card/50 text-card-foreground p-3 rounded-xl border border-border shadow-lg flex items-center gap-3">
        <div className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"></span>
          <span className="relative inline-flex rounded-full h-3 w-3 bg-green"></span>
        </div>
        <div className="text-xs font-mono">
          <span className="text-muted-foreground">ENGINE:</span> <span className="text-green">ONLINE</span>
        </div>
      </div>
    </div>
  );
};

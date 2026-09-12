import React from 'react';
import { GitCompareArrows, Droplets, Route, Building2, Clock, Info } from 'lucide-react';
import { DataStatusBadge } from '../common/DataStatusBadge';
import { useWhatIfComparison } from '../../api/hooks/useWhatIfComparison';
import { useWhatIfStore, type WhatIfView } from '../../stores/useWhatIfStore';
import { useLayerStore } from '../../stores/useLayerStore';

// Phase 7 — Baseline vs. drainage-intervention what-if comparison, reading
// Phase 4's precomputed output (data/scripts/build_whatif_scenarios.py) as-is.
// Both scenarios share the SAME SIMULATED design-storm rainfall; only the
// ESTIMATED drainage-capacity multiplier differs (0.7x "today's condition"
// vs 1.3x "hypothetical intervention"). This is a demonstration comparison,
// never a planned or funded MCGM project — see the scenario_type disclaimer
// rendered directly from the data below.
export const WhatIfPanel: React.FC = () => {
  const comparison = useWhatIfComparison();
  const { view, setView } = useWhatIfStore();

  if (!comparison) {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-[11px] text-muted-foreground">
        Loading what-if scenario data…
      </div>
    );
  }
  if (comparison.status !== 'COMPLETE') {
    return (
      <div className="rounded-xl border border-border bg-background p-4 text-[11px] text-muted-foreground">
        What-if comparison unavailable for this zone ({comparison.status}).
      </div>
    );
  }

  const { baseline, intervention } = comparison.comparison;
  const delta = comparison.delta_baseline_minus_intervention;

  const VIEW_OPTIONS: Array<{ id: WhatIfView; label: string }> = [
    { id: 'off', label: 'Off (normal flood layer)' },
    { id: 'baseline', label: 'Baseline' },
    { id: 'intervention', label: 'Intervention' },
    { id: 'difference', label: 'Difference' },
  ];

  return (
    <div className="rounded-xl border border-border bg-background p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <GitCompareArrows className="w-4 h-4 text-primary" />
        What-If: Drainage Intervention
        <DataStatusBadge status="SIMULATED" className="ml-auto" />
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 flex items-start gap-2">
        <Info className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
        <p className="text-[10px] text-amber-800 leading-relaxed">{comparison.scenario_type}</p>
      </div>

      <div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1.5">Show on map</div>
        <div className="grid grid-cols-2 gap-1.5">
          {VIEW_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => {
                setView(opt.id);
                // Make sure the flood-simulation map layer is actually
                // visible once the user picks a what-if view to look at.
                if (opt.id !== 'off') useLayerStore.getState().setLayer('floodSimulation', true);
              }}
              className={`px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${
                view === opt.id ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted/40 border-border/60 text-muted-foreground hover:bg-muted/60'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
        <div />
        <div className="font-semibold text-foreground uppercase tracking-wide">Baseline (0.7x)</div>
        <div className="font-semibold text-primary uppercase tracking-wide">Intervention (1.3x)</div>

        <StatRow icon={Droplets} label="Max depth" a={`${(baseline.max_depth_m * 100).toFixed(0)}cm`} b={`${(intervention.max_depth_m * 100).toFixed(0)}cm`} />
        <StatRow icon={Droplets} label="Flooded area" a={`${(baseline.peak_flooded_area_m2_estimate / 1000).toFixed(1)}k m²`} b={`${(intervention.peak_flooded_area_m2_estimate / 1000).toFixed(1)}k m²`} />
        <StatRow icon={Route} label="Roads affected" a={String(baseline.affected_road_count)} b={String(intervention.affected_road_count)} />
        <StatRow icon={Building2} label="Infra affected" a={String(baseline.affected_infrastructure_count)} b={String(intervention.affected_infrastructure_count)} />
        <StatRow
          icon={Clock} label="Flood onset"
          a={baseline.flood_onset_minutes !== null ? `T+${baseline.flood_onset_minutes}min` : 'none'}
          b={intervention.flood_onset_minutes !== null ? `T+${intervention.flood_onset_minutes}min` : 'none'}
        />
      </div>

      <div className="rounded-lg bg-muted/40 border border-border/60 p-3 text-[10px] text-muted-foreground leading-relaxed">
        Intervention reduces max depth by <b className="text-foreground">{(delta.max_depth_m_reduction * 100).toFixed(0)}cm</b>,
        flooded area by <b className="text-foreground">{(delta.flooded_area_m2_reduction / 1000).toFixed(1)}k m²</b>, and
        affected roads by <b className="text-foreground">{delta.affected_roads_reduction}</b> in this SIMULATED comparison
        (peak of the design-storm run — see flood_propagation_engine.py). Proximity threshold for "affected":{' '}
        {comparison.proximity_threshold_m}m from a flooded drainage-graph node.
      </div>
    </div>
  );
};

const StatRow: React.FC<{ icon: React.ElementType; label: string; a: string; b: string }> = ({ icon: Icon, label, a, b }) => (
  <>
    <div className="flex items-center gap-1 text-muted-foreground text-left">
      <Icon className="w-3 h-3 shrink-0" /> {label}
    </div>
    <div className="font-mono font-semibold text-foreground">{a}</div>
    <div className="font-mono font-semibold text-primary">{b}</div>
  </>
);

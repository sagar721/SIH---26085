import React from 'react';
import { Activity, Route, Building2, Download, SlidersHorizontal, Map, Hospital, School, Shield, Flame } from 'lucide-react';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useZoneStore } from '../../stores/useZoneStore';
import { BRIMSTOWAD_DESIGN_INTENSITY_MM_HR } from '../../lib/riskModel';
import { downloadCSV, downloadGeoJSON, featureCollectionToCSVRows } from '../../lib/exportUtils';

const AMENITY_ICON: Record<string, React.ElementType> = {
  hospital: Hospital, school: School, police: Shield, fire_station: Flame,
};

// Right-rail "Impact" tab — deliberately does NOT repeat Peak Rainfall / Max
// Depth / Roads Blocked / Critical Assets, since those already live in the
// always-visible KPI strip (see KpiStrip.tsx). This tab goes deeper: the
// rainfall-aware impact model's actual breakdown, and the full affected-
// asset list rather than a top-N preview.
export const ImpactPanel: React.FC = () => {
  const { infraFeatures } = useFloodData();
  const { effectiveRainfallMmHr, scenarioActive, scenarioMultiplier, realRainfallMmHr, roadImpact, infraExposure, zoneSeverity, roadsRisk, infraRisk } = useRainfallAwareRisk();
  const { activeZone } = useZoneStore();
  const affectedAssets = (infraFeatures?.features ?? []).filter((f) => f.properties?.status !== 'SAFE');

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-5">
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" /> Rainfall-Aware Impact
          </h3>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan/10 text-cyan border border-cyan/20">MODELLED</span>
        </div>
        <div className="flex items-end gap-2 mb-3">
          <span className={`text-xl font-bold ${
            zoneSeverity.label === 'SEVERE' ? 'text-red' : zoneSeverity.label === 'HIGH' ? 'text-amber' :
            zoneSeverity.label === 'MODERATE' ? 'text-amber' : 'text-green'
          }`}>{zoneSeverity.label}</span>
          <span className="text-xs text-muted-foreground mb-0.5">zone severity ({zoneSeverity.score.toFixed(2)})</span>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="p-2.5 rounded-lg bg-muted/50 border border-border/60">
            <p className="text-[9px] text-muted-foreground uppercase flex items-center gap-1"><Route className="w-2.5 h-2.5" />Road Impact</p>
            <p className="font-mono text-foreground">{roadImpact.highRiskCount}<span className="text-muted-foreground">/{roadImpact.count} high-risk</span></p>
          </div>
          <div className="p-2.5 rounded-lg bg-muted/50 border border-border/60">
            <p className="text-[9px] text-muted-foreground uppercase flex items-center gap-1"><Building2 className="w-2.5 h-2.5" />Infra Exposure</p>
            <p className="font-mono text-foreground">{infraExposure.highRiskCount}<span className="text-muted-foreground">/{infraExposure.count} high-risk</span></p>
          </div>
        </div>
        {scenarioActive && (
          <p className="text-[10px] text-amber mt-2.5 flex items-center gap-1">
            <SlidersHorizontal className="w-2.5 h-2.5 shrink-0" />
            Scenario Mode active ({scenarioMultiplier.toFixed(1)}x design storm) — driving this model with a
            SIMULATED {effectiveRainfallMmHr.toFixed(1)}mm/h, not the real ({realRainfallMmHr.toFixed(1)}mm/h) reading.
          </p>
        )}
        <p className="text-[10px] text-muted-foreground mt-2.5 leading-relaxed">
          Real susceptibility (DEM/landcover/waterways) × {scenarioActive ? 'SIMULATED scenario' : 'real'} rainfall
          ({effectiveRainfallMmHr.toFixed(1)}mm/h, normalized against MCGM's official {BRIMSTOWAD_DESIGN_INTENSITY_MM_HR}mm/h design intensity).
          Not validated against observed flooding.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider">Affected Infrastructure</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">REAL LOC. + SIMULATED STATUS</span>
        </div>
        {affectedAssets.length === 0 ? (
          <div className="rounded-xl border border-border bg-background p-6 text-center flex flex-col items-center">
            <Map className="w-6 h-6 text-border mb-2" />
            <p className="text-xs text-muted-foreground">No critical infrastructure currently at risk.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {affectedAssets.map((f, i) => {
              const p = f.properties ?? {};
              const Icon = AMENITY_ICON[p.amenity as string] ?? Map;
              const isCritical = p.status === 'CRITICAL';
              return (
                <div key={`${p.name}-${i}`} className="p-3 rounded-lg bg-background border border-border flex items-center gap-3">
                  <Icon className={`w-4 h-4 shrink-0 ${isCritical ? 'text-red' : 'text-amber'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{p.name as string}</p>
                    <p className="text-[10px] text-muted-foreground">{p.depthMeters as string}m simulated depth</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase shrink-0 ${isCritical ? 'text-red' : 'text-amber'}`}>{p.status as string}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-background p-3">
        <h3 className="text-[10px] text-muted-foreground uppercase mb-2 tracking-wider">Export raw data</h3>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => roadsRisk && downloadGeoJSON(`${activeZone.id}_roads_risk`, roadsRisk)}
            disabled={!roadsRisk}
            className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-medium bg-muted hover:bg-border text-foreground border border-border disabled:opacity-40 transition-colors"
          >
            <Download className="w-3 h-3" /> Roads GeoJSON
          </button>
          <button
            onClick={() => infraRisk && downloadCSV(`${activeZone.id}_infrastructure_risk`, featureCollectionToCSVRows(infraRisk))}
            disabled={!infraRisk}
            className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-medium bg-muted hover:bg-border text-foreground border border-border disabled:opacity-40 transition-colors"
          >
            <Download className="w-3 h-3" /> Infra CSV
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">For a shareable formatted brief, use "Brief NDRF &amp; MCGM" above.</p>
      </div>
    </div>
  );
};

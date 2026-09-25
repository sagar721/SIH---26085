import React from 'react';
import { useLayerStore } from '../../stores/useLayerStore';
import { useUIStore } from '../../stores/useUIStore';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useWhatIfStore } from '../../stores/useWhatIfStore';
import { FLOOD_DEPTH_LEGEND, RAINFALL_LEGEND, DRAINAGE_STATUS_COLOR, INFRA_STATUS_COLOR, INFRA_STATUS_LABELS } from '../../lib/colorRamps';

const DRAINAGE_STATUS_LABELS: Array<{ key: keyof typeof DRAINAGE_STATUS_COLOR; label: string }> = [
  { key: 'normal', label: 'Normal' },
  { key: 'approaching_capacity', label: 'Approaching capacity' },
  { key: 'surcharge', label: 'Surcharge' },
];

// Step 5D's required "visible legend" for the flood-depth ramp, plus the
// rainfall-intensity bins (Step 5G) and drainage-graph status (Step 5H) —
// only shown for whichever of those layers is currently toggled on, so it
// never becomes a wall of unrelated legend entries.
export const MapLegend: React.FC = () => {
  const visibility = useLayerStore((s) => s.visibility);
  const viewMode = useUIStore((s) => s.viewMode);
  const timeIndex = useSimulationStore((s) => s.timeIndex);
  const mode = useSimulationStore((s) => s.mode);
  const whatIfView = useWhatIfStore((s) => s.view);

  if (viewMode !== 'zone') return null;
  const showFlood = visibility.floodSimulation;
  const showRainfall = visibility.rainfall;
  const showDrainage = visibility.drainageGraph;
  const showInfra = visibility.infrastructure;
  if (!showFlood && !showRainfall && !showDrainage && !showInfra) return null;

  return (
    <div className="absolute bottom-4 left-4 z-10 bg-card/95 backdrop-blur-sm border border-border rounded-lg shadow-lg p-3 text-[11px] max-w-[220px] space-y-3">
      {showFlood && (
        <div>
          <div className="font-semibold text-foreground mb-1">
            {whatIfView === 'off' && <>Flood depth &middot; T+{timeIndex * 30}min <span className="text-muted-foreground font-normal">(SIMULATED)</span></>}
            {whatIfView === 'baseline' && <>What-if: BASELINE depth &middot; T+{timeIndex * 30}min</>}
            {whatIfView === 'intervention' && <>What-if: INTERVENTION depth &middot; T+{timeIndex * 30}min</>}
            {whatIfView === 'difference' && <>What-if: depth REDUCED by intervention &middot; T+{timeIndex * 30}min</>}
          </div>
          <div className="space-y-0.5">
            {FLOOD_DEPTH_LEGEND.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {showInfra && (
        <div>
          <div className="font-semibold text-foreground mb-1">
            Critical infrastructure <span className="text-muted-foreground font-normal">(status SIMULATED)</span>
          </div>
          <div className="space-y-0.5">
            {INFRA_STATUS_LABELS.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ backgroundColor: INFRA_STATUS_COLOR[s.key] }} />
                <span className="text-muted-foreground">{s.label} &middot; {s.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {showRainfall && (
        <div>
          <div className="font-semibold text-foreground mb-1">
            Rainfall rate <span className="text-muted-foreground font-normal">{mode === 'demo' ? '(SIMULATED, hypothetical)' : '(REAL, observed)'}</span>
          </div>
          <div className="space-y-0.5">
            {RAINFALL_LEGEND.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm inline-block shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {showDrainage && (
        <div>
          <div className="font-semibold text-foreground mb-1">
            Drainage graph <span className="text-muted-foreground font-normal">(INFERRED / ESTIMATED)</span>
          </div>
          <div className="space-y-0.5">
            {DRAINAGE_STATUS_LABELS.map((s) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full inline-block shrink-0" style={{ backgroundColor: DRAINAGE_STATUS_COLOR[s.key] }} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            ))}
          </div>
          <div className="text-[9px] text-muted-foreground mt-1 leading-tight">
            DEM-derived surface network — never the official MCGM underground pipe network.
          </div>
        </div>
      )}
    </div>
  );
};

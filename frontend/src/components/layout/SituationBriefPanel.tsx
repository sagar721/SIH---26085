import React from 'react';
import { AlertTriangle, Radio, Hospital, School, Shield, Flame, Map } from 'lucide-react';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useZoneStore } from '../../stores/useZoneStore';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { generateSituationBrief, generateRecommendedAction } from '../../lib/situationBrief';
import { computeCapacityMargin } from '../../lib/riskModel';

const AMENITY_ICON: Record<string, React.ElementType> = {
  hospital: Hospital, school: School, police: Shield, fire_station: Flame,
};

const SEVERITY_STYLE: Record<string, string> = {
  Moderate: 'bg-amber/10 border-amber/25 text-amber',
  High: 'bg-amber/15 border-amber/35 text-amber',
  Severe: 'bg-red/10 border-red/30 text-red',
};

export const SituationBriefPanel: React.FC = () => {
  const { riskSummary, infraFeatures, roadsFeatures } = useFloodData();
  const { realRainfallMmHr, effectiveRainfallMmHr, scenarioActive, zoneSeverity, roadImpact, infraExposure } = useRainfallAwareRisk();
  const { activeZone } = useZoneStore();
  const { drainageBlockage } = useSimulationStore();

  const affectedAssets = (infraFeatures?.features ?? []).filter((f) => f.properties?.status !== 'SAFE');
  const affectedRoads = (roadsFeatures?.features ?? []).filter((f) => f.properties?.affected);
  const affectedRoadNames = [...new Set(affectedRoads.map((f) => f.properties?.name).filter(Boolean))] as string[];
  const affectedAssetNames = [...new Set(affectedAssets.map((f) => f.properties?.name).filter(Boolean))] as string[];
  const topRisk = affectedAssets
    .slice()
    .sort((a, b) => parseFloat(String(b.properties?.depthMeters ?? 0)) - parseFloat(String(a.properties?.depthMeters ?? 0)))
    .slice(0, 4);

  const input = {
    zoneName: activeZone.name.split('–')[0],
    rainfallDataAvailable: riskSummary?.rainfallDataAvailable ?? false,
    realRainfallMmHr, effectiveRainfallMmHr, scenarioActive,
    drainageBlockagePct: drainageBlockage,
    capacityMargin: computeCapacityMargin(effectiveRainfallMmHr, drainageBlockage),
    etaMinutes: null,
    zoneSeverity, roadImpact, infraExposure,
    affectedRoadNames, affectedAssetNames,
  };
  const brief = generateSituationBrief(input);
  const action = generateRecommendedAction(input);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4">
      <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Situation Brief · Auto-generated
      </div>
      <h3 className="font-serif text-base font-semibold text-foreground mb-2">What we're seeing right now</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{brief.briefParagraph}</p>
      <p className="text-[10px] text-muted-foreground/80 mt-2 italic">Confidence {brief.confidence} — {brief.confidenceReason}</p>

      {action ? (
        <div className={`mt-4 rounded-xl border p-4 ${SEVERITY_STYLE[action.severity]}`}>
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide mb-2">
            <AlertTriangle className="w-3 h-3" /> Recommended Action · {action.severity}
          </div>
          <div className="text-sm font-bold text-foreground leading-snug mb-1.5">{action.title}</div>
          <p className="text-[11.5px] text-muted-foreground leading-relaxed">{action.detail}</p>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-green/25 bg-green/5 p-4 flex items-center gap-2">
          <Radio className="w-4 h-4 text-green shrink-0" />
          <p className="text-xs text-foreground">No emergency action recommended at current conditions.</p>
        </div>
      )}

      <div className="mt-6">
        <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2">Vulnerable Assets · Current Scenario</div>
        {topRisk.length === 0 ? (
          <div className="rounded-xl border border-border bg-background p-6 text-center">
            <Map className="w-6 h-6 text-border mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">No critical infrastructure currently at risk.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {topRisk.map((f, i) => {
              const p = f.properties ?? {};
              const Icon = AMENITY_ICON[p.amenity as string] ?? Map;
              const isCritical = p.status === 'CRITICAL';
              return (
                <div key={`${p.name}-${i}`} className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
                  <Icon className={`w-4 h-4 shrink-0 ${isCritical ? 'text-red' : 'text-amber'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{p.name as string}</p>
                    <p className="text-[10px] text-muted-foreground">{p.depthMeters as string}m simulated depth</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase shrink-0 ${isCritical ? 'text-red' : 'text-amber'}`}>{p.status as string}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

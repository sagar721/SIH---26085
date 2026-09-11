import React from 'react';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useZoneStore } from '../../stores/useZoneStore';
import { useUIStore } from '../../stores/useUIStore';
import { useMumbaiOverviewSummary } from '../../api/hooks/useMumbaiOverviewSummary';
import { zoneAreaKm2, floodPolygonAreaKm2 } from '../../lib/geo';
import { openPrintSummaryReport } from '../../lib/exportUtils';

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: React.ReactNode;
  noteTone?: 'default' | 'critical';
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, unit, note, noteTone = 'default' }) => (
  <div className="px-5 py-4 border-r border-border last:border-r-0 min-w-0">
    <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground mb-2">{label}</div>
    <div className="font-mono text-2xl font-semibold text-foreground flex items-baseline gap-1.5">
      {value}
      {unit && <span className="font-sans text-[13px] font-medium text-muted-foreground">{unit}</span>}
    </div>
    {note && <div className={`text-[11px] mt-1.5 ${noteTone === 'critical' ? 'text-red font-semibold' : 'text-muted-foreground'}`}>{note}</div>}
  </div>
);

const OverviewKpiStrip: React.FC = () => {
  const { setDecisionFlowTab } = useUIStore();
  const rows = useMumbaiOverviewSummary();
  const worstRainfall = rows ? Math.max(0, ...rows.map((r) => r.riskSummary.peakRainfallMmHr)) : 0;
  const totalAffectedRoads = rows?.reduce((a, r) => a + r.affectedRoads, 0) ?? 0;
  const totalRoads = rows?.reduce((a, r) => a + r.totalRoads, 0) ?? 0;
  const totalAffectedAssets = rows?.reduce((a, r) => a + r.affectedAssets, 0) ?? 0;
  const totalAssets = rows?.reduce((a, r) => a + r.totalAssets, 0) ?? 0;

  return (
    <div className="grid bg-card border-b border-border" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr)) auto' }}>
      <KpiCard label="Worst Zone Rainfall" value={rows ? worstRainfall.toFixed(1) : '—'} unit="mm/hr" note="highest of monitored pilot zones" />
      <KpiCard label="Monitored Zones" value={rows?.length ?? '—'} note="with full flood-impact model" />
      <KpiCard label="Roads Blocked" value={totalAffectedRoads} note={`of ${totalRoads.toLocaleString()} segments, city-wide`} />
      <KpiCard
        label="Critical Assets"
        value={<>{totalAffectedAssets}<span className="text-muted-foreground text-lg">/{totalAssets}</span></>}
        note="across monitored zones"
      />
      <KpiCard label="Population Exposed" value={<span className="text-muted-foreground italic text-lg">—</span>} note="Population data not yet integrated" />
      <div className="flex items-center gap-2 px-4">
        <button
          onClick={() => setDecisionFlowTab('simulation')}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-border bg-background hover:bg-muted transition-colors whitespace-nowrap"
        >
          + New scenario
        </button>
      </div>
    </div>
  );
};

export const KpiStrip: React.FC = () => {
  const viewMode = useUIStore((s) => s.viewMode);
  const { riskSummary, floodFeatures, infraFeatures, roadsFeatures } = useFloodData();
  const { setDecisionFlowTab } = useUIStore();
  const { activeZone } = useZoneStore();
  const areaKm2 = zoneAreaKm2(activeZone);

  const affectedAssets = (infraFeatures?.features ?? []).filter((f) => f.properties?.status !== 'SAFE');
  const criticalAssets = affectedAssets.filter((f) => f.properties?.status === 'CRITICAL');
  const affectedRoads = (roadsFeatures?.features ?? []).filter((f) => f.properties?.affected);
  const totalRoads = roadsFeatures?.features.length ?? 0;
  const totalInfra = infraFeatures?.features.length ?? 0;

  const affectedAreaKm2 = floodPolygonAreaKm2(floodFeatures);
  const coveragePct = areaKm2 ? Math.min(100, (affectedAreaKm2 / areaKm2) * 100) : 0;

  if (viewMode === 'overview') return <OverviewKpiStrip />;

  return (
    <div className="grid bg-card border-b border-border" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr)) auto' }}>
      <KpiCard
        label="Rainfall Intensity"
        value={riskSummary && !riskSummary.rainfallDataAvailable ? '—' : (riskSummary?.peakRainfallMmHr ?? 0).toFixed(1)}
        unit="mm/hr"
        note={riskSummary && !riskSummary.rainfallDataAvailable ? 'No reading for this hour' : 'Current zone reading'}
        noteTone={riskSummary && !riskSummary.rainfallDataAvailable ? 'critical' : 'default'}
      />
      <KpiCard
        label="Flood Coverage"
        value={coveragePct.toFixed(0)}
        unit="%"
        note={`${affectedAreaKm2.toFixed(2)} km² of monitored zone`}
      />
      <KpiCard
        label="Roads Blocked"
        value={affectedRoads.length}
        note={`of ${totalRoads.toLocaleString()} segments`}
      />
      <KpiCard
        label="Critical Assets"
        value={<>{affectedAssets.length}<span className="text-muted-foreground text-lg">/{totalInfra}</span></>}
        note={criticalAssets.length > 0 ? `${criticalAssets.length} at CRITICAL status` : 'none at critical status'}
        noteTone={criticalAssets.length > 0 ? 'critical' : 'default'}
      />
      <KpiCard
        label="Population Exposed"
        value={<span className="text-muted-foreground italic text-lg">—</span>}
        note="Population data not yet integrated"
      />
      <div className="flex items-center gap-2 px-4">
        <button
          onClick={() => setDecisionFlowTab('simulation')}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-border bg-background hover:bg-muted transition-colors whitespace-nowrap"
        >
          + New scenario
        </button>
        <button
          onClick={() => openPrintSummaryReport({
            zoneName: activeZone.name,
            generatedAt: new Date().toLocaleString(),
            realRainfallMmHr: riskSummary?.peakRainfallMmHr ?? 0,
            effectiveRainfallMmHr: riskSummary?.peakRainfallMmHr ?? 0,
            scenarioActive: false,
            zoneSeverity: { score: 0, label: riskSummary?.overallRisk ?? 'LOW' },
            roadImpact: { count: totalRoads, meanAdjustedRisk: 0, highRiskCount: affectedRoads.length },
            infraExposure: { count: totalInfra, weightedMeanAdjustedRisk: 0, highRiskCount: affectedAssets.length },
            affectedAreaKm2,
            affectedRoadsCount: affectedRoads.length,
            affectedAssetsCount: affectedAssets.length,
          })}
          className="px-3.5 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
          title="Prepares a shareable, printable brief — does not notify NDRF or MCGM automatically."
        >
          Brief NDRF &amp; MCGM →
        </button>
      </div>
    </div>
  );
};

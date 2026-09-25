import React, { useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useFloodSimulationFrame } from '../../api/hooks/useFloodSimulationFrame';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { usePopulationExposed } from '../../api/hooks/usePopulationExposed';
import { useZoneStore } from '../../stores/useZoneStore';
import { useUIStore, type ActiveModal } from '../../stores/useUIStore';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useMumbaiOverviewSummary } from '../../api/hooks/useMumbaiOverviewSummary';
import { FLOOD_NODE_BASIN_AREA_M2 } from '../../lib/colorRamps';
import { computeCapacityMargin } from '../../lib/riskModel';
import { openPrintSummaryReport } from '../../lib/exportUtils';

interface KpiDetail {
  title: string;
  value: string;
  methodology: string;
  assumptions: string[];
  modalTarget?: ActiveModal;
  modalLabel?: string;
}

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  note?: React.ReactNode;
  noteTone?: 'default' | 'critical';
  detail?: KpiDetail;
  onOpenDetail?: (detail: KpiDetail) => void;
}

// Plain, non-interactive card — Live Mode and the city-wide Overview strip
// use ONLY this, unchanged from before Demo Mode existed. Live Mode's KPI
// strip must stay exactly as it was: 5 cards, no click affordance, no
// Demo-Mode-only concepts (Drainage Capacity/Confidence tiles, detail
// popovers) bleeding into it.
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

// Clickable variant — Demo Mode only (see requirement C: every KPI card
// should open methodology/assumptions detail). Never rendered in Live Mode.
const ClickableKpiCard: React.FC<KpiCardProps> = ({ label, value, unit, note, noteTone = 'default', detail, onOpenDetail }) => (
  <button
    type="button"
    onClick={() => detail && onOpenDetail?.(detail)}
    className="px-5 py-4 border-r border-border last:border-r-0 min-w-0 text-left group cursor-pointer hover:bg-muted/40 transition-colors"
  >
    <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground mb-2 flex items-center gap-1">
      {label}
      <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
    </div>
    <div className="font-mono text-2xl font-semibold text-foreground flex items-baseline gap-1.5">
      {value}
      {unit && <span className="font-sans text-[13px] font-medium text-muted-foreground">{unit}</span>}
    </div>
    {note && <div className={`text-[11px] mt-1.5 ${noteTone === 'critical' ? 'text-red font-semibold' : 'text-muted-foreground'}`}>{note}</div>}
  </button>
);

const KpiDetailModal: React.FC<{ detail: KpiDetail; onClose: () => void }> = ({ detail, onClose }) => {
  const { setActiveModal } = useUIStore();
  return (
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl max-w-md w-full p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground mb-1">{detail.title}</div>
            <div className="font-mono text-2xl font-semibold text-foreground">{detail.value}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="text-[12px] text-foreground leading-relaxed mb-3">{detail.methodology}</div>
        {detail.assumptions.length > 0 && (
          <div className="mb-4">
            <div className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground mb-1.5">Assumptions</div>
            <ul className="text-[11.5px] text-muted-foreground space-y-1 list-disc list-inside">
              {detail.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}
        {detail.modalTarget && (
          <button
            onClick={() => { setActiveModal(detail.modalTarget!); onClose(); }}
            className="w-full px-3.5 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {detail.modalLabel ?? 'View full analysis'} &rarr;
          </button>
        )}
      </div>
    </div>
  );
};

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
      <KpiCard label="Population Exposed" value={<span className="text-muted-foreground italic text-lg">—</span>} note="Switch to a pilot zone in Demo Mode for a modelled estimate" />
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
  const { riskSummary, infraFeatures, roadsFeatures } = useFloodData();
  // Flood Coverage now reads the SAME precomputed flood-simulation frame that
  // drives Roads Blocked/Critical Assets and the map's flood layer — it
  // previously used the old Scenario-Mode mock flood-extent polygons, which
  // run on a different input and could show "0% coverage" in the same
  // instant "Roads Blocked" showed real blocked roads. Bug found during the
  // SIH-readiness audit. In Demo Mode this frame is the self-contained
  // synthetic engine (lib/demoEngine.ts), so it stays reactive without any
  // real data dependency — see useFloodSimulationFrame.ts.
  const { frame: floodSimFrame } = useFloodSimulationFrame();
  const { setDecisionFlowTab } = useUIStore();
  const { activeZone } = useZoneStore();
  const { mode, scenarioMultiplier, drainageBlockage } = useSimulationStore();
  const { effectiveRainfallMmHr, scenarioActive } = useRainfallAwareRisk();
  const { populationExposed, affectedBuildings, totalBuildings } = usePopulationExposed();
  const isDemo = mode === 'demo';

  const [openDetail, setOpenDetail] = useState<KpiDetail | null>(null);

  const affectedAssets = (infraFeatures?.features ?? []).filter((f) => f.properties?.status !== 'SAFE');
  const criticalAssets = affectedAssets.filter((f) => f.properties?.status === 'CRITICAL');
  const affectedRoads = (roadsFeatures?.features ?? []).filter((f) => f.properties?.affected);
  const totalRoads = roadsFeatures?.features.length ?? 0;
  const totalInfra = infraFeatures?.features.length ?? 0;

  const totalNodeCount = floodSimFrame?.features.length ?? 0;
  const floodedNodeCount = (floodSimFrame?.features ?? []).filter((f) => f.properties.depth_m > 0).length;
  // ESTIMATED area, not a true polygon measurement — same node-footprint
  // assumption the Python engine itself uses (see FLOOD_NODE_BASIN_AREA_M2).
  const affectedAreaKm2 = (floodedNodeCount * FLOOD_NODE_BASIN_AREA_M2) / 1_000_000;
  const coveragePct = totalNodeCount ? Math.min(100, (floodedNodeCount / totalNodeCount) * 100) : 0;

  // Rainfall Intensity: Live reads the real per-hour reading (may be
  // unavailable for this hour); Demo always reads the self-contained
  // synthetic design-storm value, so it's never stuck at a real 0mm/hr
  // reading regardless of the slider position.
  const rainfallValue = isDemo ? effectiveRainfallMmHr : (riskSummary?.peakRainfallMmHr ?? 0);
  const rainfallUnavailable = !isDemo && riskSummary && !riskSummary.rainfallDataAvailable;

  const capacityMargin = computeCapacityMargin(effectiveRainfallMmHr, drainageBlockage);

  const rainfallDetail: KpiDetail = isDemo
    ? {
        title: 'Rainfall Intensity',
        value: `${rainfallValue.toFixed(1)} mm/hr`,
        methodology: 'Scenario Simulation (Hypothetical): rainfall multiplier × 50mm/hr — MCGM\'s own published post-BRIMSTOWAD storm-water design intensity. This is never a real reading in Demo Mode, even at the slider\'s default 1.0x position.',
        assumptions: [
          `Current multiplier: ${scenarioMultiplier.toFixed(1)}x design intensity`,
          'Design intensity (1.0x) = 50mm/hr, per MCGM\'s official post-BRIMSTOWAD storm-water statistics',
        ],
        modalTarget: 'methodology',
        modalLabel: 'View methodology',
      }
    : {
        title: 'Rainfall Intensity',
        value: rainfallUnavailable ? 'No reading' : `${rainfallValue.toFixed(1)} mm/hr`,
        methodology: 'The real, OBSERVED GSMaP-derived rainfall intensity for the active zone at the currently-selected hour.',
        assumptions: ['Source: GSMaP satellite rainfall estimate', 'Shows "No reading" when this hour has no matching real observation, never a fabricated value'],
        modalTarget: 'provenance',
        modalLabel: 'View data provenance',
      };

  const floodCoverageDetail: KpiDetail = {
    title: 'Flood Coverage',
    value: `${coveragePct.toFixed(1)}%`,
    methodology: isDemo
      ? 'Percentage of a synthetic grid of sample points across this zone (Demo Mode\'s self-contained spatial model — see lib/demoEngine.ts) currently simulated as flooded (depth > 0).'
      : 'Percentage of the precomputed drainage-graph nodes monitored in this zone currently simulated as flooded (depth > 0) at the active T+0..180 timestep.',
    assumptions: [
      `${floodedNodeCount} of ${totalNodeCount} monitored points currently flooded`,
      `Area estimate assumes ~${FLOOD_NODE_BASIN_AREA_M2}m² of local pooling per flooded node — a rough footprint assumption, not a true polygon measurement`,
    ],
    modalTarget: 'analytics',
    modalLabel: 'View analytics',
  };

  const roadsBlockedDetail: KpiDetail = {
    title: 'Roads Blocked',
    value: `${affectedRoads.length} / ${totalRoads}`,
    methodology: 'Road segments whose simulated flood depth at the nearest sampled point reaches the HIGH or SEVERE severity tier (≥30cm) — the same depth-based classification routing uses to decide which roads to avoid.',
    assumptions: ['Depth sampled at each segment\'s start, midpoint, and end', 'HIGH = 30-50cm (heavily penalized), SEVERE = ≥50cm (excluded from routing entirely)'],
    modalTarget: 'analytics',
    modalLabel: 'View analytics',
  };

  const criticalAssetsDetail: KpiDetail = {
    title: 'Critical Assets',
    value: `${affectedAssets.length} / ${totalInfra}`,
    methodology: 'Critical infrastructure (hospitals, schools, fire/police stations, transit) whose simulated flood depth exceeds 0.1m (AT RISK) or 0.5m (CRITICAL) — the same thresholds shown on the map and its legend.',
    assumptions: [`${criticalAssets.length} currently at CRITICAL status (>0.5m)`, 'Real MCGM/OSM facility locations; flood status is simulated'],
    modalTarget: 'analytics',
    modalLabel: 'View analytics',
  };

  const populationDetail: KpiDetail = {
    title: 'Population Exposed',
    value: isDemo && populationExposed !== null ? populationExposed.toLocaleString() : '—',
    methodology: 'Demo Mode estimate only: real building footprints (OpenStreetMap) whose location falls inside the simulated flood extent, each contributing an assumed occupancy based on its building height (levels × ~8 people/floor, or a 1-floor default).',
    assumptions: [
      isDemo ? `${affectedBuildings.toLocaleString()} of ${totalBuildings.toLocaleString()} building footprints affected` : 'Not computed in Live Mode — no real population/census dataset exists in this project',
      'This is a MODELLED illustrative estimate, never real census or survey data',
    ],
    modalTarget: 'provenance',
    modalLabel: 'View data provenance',
  };

  const drainageCapacityDetail: KpiDetail = {
    title: 'Drainage Capacity Exceeded',
    value: capacityMargin.isExceeding ? `+${capacityMargin.marginPct.toFixed(0)}%` : `-${capacityMargin.marginPct.toFixed(0)}%`,
    methodology: 'How far current rainfall demand exceeds (or falls short of) nominal drainage capacity after accounting for blockage. Demand is rainfall normalized against the 50mm/hr MCGM design intensity; capacity starts at 100% and is reduced by the drainage-blockage percentage (never below 20%, since real drains are rarely fully sealed).',
    assumptions: [
      `Rainfall factor: ${capacityMargin.rainfallFactor.toFixed(2)}x design intensity`,
      `Remaining capacity: ${(capacityMargin.capacity * 100).toFixed(0)}%`,
      capacityMargin.isExceeding ? 'Demand currently exceeds available capacity' : 'Capacity currently has headroom',
    ],
    modalTarget: 'methodology',
    modalLabel: 'View methodology',
  };

  const confidenceLabel = isDemo ? 'Hypothetical' : (riskSummary?.rainfallDataAvailable ?? true) ? 'Medium' : 'Low';
  const confidenceDetail: KpiDetail = {
    title: 'Confidence Indicator',
    value: confidenceLabel,
    methodology: isDemo
      ? 'Demo Mode intentionally trades real-data confidence for a fully-reactive, self-contained illustrative simulation — every value on screen is SYNTHETIC, clearly labeled, and never presented as a forecast.'
      : 'Reflects whether this hour has a real rainfall reading, and that nothing in this system has been validated against observed flooding. Never rises to "High" — no ground-truth flood-extent comparison exists yet (see the Validation Log).',
    assumptions: isDemo
      ? ['Applies to every metric on this strip while Demo Mode is active']
      : [riskSummary?.rainfallDataAvailable ? 'A real rainfall reading exists for this hour' : 'No real rainfall reading for this hour', 'No observed-flood validation exists for this model yet'],
    modalTarget: 'validation',
    modalLabel: 'View validation log',
  };

  if (viewMode === 'overview') return <OverviewKpiStrip />;

  const briefButton = (
    <button
      onClick={() => openPrintSummaryReport({
        zoneName: activeZone.name,
        generatedAt: new Date().toLocaleString(),
        realRainfallMmHr: riskSummary?.peakRainfallMmHr ?? 0,
        effectiveRainfallMmHr: rainfallValue,
        scenarioActive,
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
  );
  const newScenarioButton = (
    <button
      onClick={() => setDecisionFlowTab('simulation')}
      className="px-3.5 py-2 rounded-lg text-xs font-semibold border border-border bg-background hover:bg-muted transition-colors whitespace-nowrap"
    >
      + New scenario
    </button>
  );

  // Live Mode: exactly the original 5-card, non-clickable strip — unchanged
  // from before Demo Mode existed. No Drainage Capacity/Confidence tiles,
  // no click-through detail, nothing Demo-Mode-specific leaks in here.
  if (!isDemo) {
    return (
      <div className="grid bg-card border-b border-border" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr)) auto' }}>
        <KpiCard
          label="Rainfall Intensity"
          value={rainfallUnavailable ? '—' : rainfallValue.toFixed(1)}
          unit="mm/hr"
          note={rainfallUnavailable ? 'No reading for this hour' : 'Current zone reading'}
          noteTone={rainfallUnavailable ? 'critical' : 'default'}
        />
        <KpiCard
          label="Flood Coverage"
          value={coveragePct.toFixed(1)}
          unit="% of monitored nodes"
          note={`~${affectedAreaKm2.toFixed(2)} km² estimated (${floodedNodeCount}/${totalNodeCount} drainage nodes)`}
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
          {newScenarioButton}
          {briefButton}
        </div>
      </div>
    );
  }

  // Demo Mode: the expanded 7-card, clickable strip.
  return (
    <>
      <div className="grid bg-card border-b border-border" style={{ gridTemplateColumns: 'repeat(7, minmax(0,1fr)) auto' }}>
        <ClickableKpiCard
          label="Rainfall Intensity"
          value={rainfallValue.toFixed(1)}
          unit="mm/hr"
          note={scenarioActive ? `${scenarioMultiplier.toFixed(1)}x design storm` : 'Design-storm baseline'}
          detail={rainfallDetail}
          onOpenDetail={setOpenDetail}
        />
        <ClickableKpiCard
          label="Flood Coverage"
          value={coveragePct.toFixed(1)}
          unit="% of monitored nodes"
          note={`~${affectedAreaKm2.toFixed(2)} km² estimated (${floodedNodeCount}/${totalNodeCount} nodes)`}
          detail={floodCoverageDetail}
          onOpenDetail={setOpenDetail}
        />
        <ClickableKpiCard
          label="Roads Blocked"
          value={affectedRoads.length}
          note={`of ${totalRoads.toLocaleString()} segments`}
          detail={roadsBlockedDetail}
          onOpenDetail={setOpenDetail}
        />
        <ClickableKpiCard
          label="Critical Assets"
          value={<>{affectedAssets.length}<span className="text-muted-foreground text-lg">/{totalInfra}</span></>}
          note={criticalAssets.length > 0 ? `${criticalAssets.length} at CRITICAL status` : 'none at critical status'}
          noteTone={criticalAssets.length > 0 ? 'critical' : 'default'}
          detail={criticalAssetsDetail}
          onOpenDetail={setOpenDetail}
        />
        <ClickableKpiCard
          label="Population Exposed"
          value={populationExposed !== null ? populationExposed.toLocaleString() : <span className="text-muted-foreground italic text-lg">—</span>}
          note={`${affectedBuildings.toLocaleString()} buildings affected (MODELLED)`}
          detail={populationDetail}
          onOpenDetail={setOpenDetail}
        />
        <ClickableKpiCard
          label="Drainage Capacity"
          value={capacityMargin.isExceeding ? `+${capacityMargin.marginPct.toFixed(0)}` : `-${capacityMargin.marginPct.toFixed(0)}`}
          unit="%"
          note={capacityMargin.isExceeding ? 'exceeding capacity' : 'within capacity'}
          noteTone={capacityMargin.isExceeding ? 'critical' : 'default'}
          detail={drainageCapacityDetail}
          onOpenDetail={setOpenDetail}
        />
        <ClickableKpiCard
          label="Confidence"
          value={confidenceLabel}
          note="Scenario Simulation"
          detail={confidenceDetail}
          onOpenDetail={setOpenDetail}
        />
        <div className="flex items-center gap-2 px-4">
          {newScenarioButton}
          {briefButton}
        </div>
      </div>
      {openDetail && <KpiDetailModal detail={openDetail} onClose={() => setOpenDetail(null)} />}
    </>
  );
};

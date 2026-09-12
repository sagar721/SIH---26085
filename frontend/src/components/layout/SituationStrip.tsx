import React from 'react';
import { useZoneStore } from '../../stores/useZoneStore';
import { useUIStore } from '../../stores/useUIStore';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useMumbaiOverviewSummary } from '../../api/hooks/useMumbaiOverviewSummary';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { rainfallService } from '../../api/services/RainfallDataService';
import { computeCapacityMargin, estimateMinutesToCapacityThreshold, type RainfallTrendPoint } from '../../lib/riskModel';
import { generateSituationHeadline } from '../../lib/situationBrief';

const OverviewSituationStrip: React.FC = () => {
  const rows = useMumbaiOverviewSummary();
  const worst = rows?.slice().sort((a, b) => b.riskSummary.peakRainfallMmHr - a.riskSummary.peakRainfallMmHr)[0];
  const anyElevated = rows?.some((r) => r.riskSummary.overallRisk !== 'LOW');

  return (
    <div className="bg-card/60 border-b border-border px-6 py-4">
      <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
        City-wide Situation · Nowcast
      </div>
      <h1 className="font-serif text-2xl font-semibold text-foreground leading-snug max-w-4xl text-balance">
        {!rows
          ? 'Loading city-wide summary…'
          : anyElevated
          ? `${worst?.zoneName.split('–')[0]} is currently the most elevated of ${rows.length} monitored pilot zones.`
          : `All ${rows.length} monitored pilot zones are currently at LOW risk.`}
      </h1>
      <p className="text-xs text-muted-foreground mt-2">
        Coverage today: {rows?.length ?? 0} of Greater Mumbai's wards carry the full flood model — select a pilot zone for a real-time read.
      </p>
    </div>
  );
};

// The serif "what's happening right now" headline — the single most-read
// line on the whole screen. Every number in it traces back to a real
// computed field; see FLOODWATCH_V3_DESIGN_SPEC.md §4.1-4.2 for why the
// "exceeds capacity in ~N min" phrasing only appears when a genuine rising
// trend actually supports it, and falls back to an honest capacity-margin
// statement otherwise.
export const SituationStrip: React.FC = () => {
  const viewMode = useUIStore((s) => s.viewMode);
  const { activeZone } = useZoneStore();
  const { riskSummary } = useFloodData();
  const { effectiveRainfallMmHr, scenarioActive } = useRainfallAwareRisk();
  const { drainageBlockage, timeIndex, availableTimestamps } = useSimulationStore();

  const rainfallDataAvailable = riskSummary?.rainfallDataAvailable ?? false;
  const capacityMargin = computeCapacityMargin(effectiveRainfallMmHr, drainageBlockage);

  const zoneData = rainfallService.getDataForZone(activeZone.id);
  const trend: RainfallTrendPoint[] = zoneData
    .slice(Math.max(0, timeIndex - 5), timeIndex + 1)
    .map((d, i, arr) => ({ rainfallMmHr: scenarioActive ? effectiveRainfallMmHr : d.rainfall_mm, minutesFromNow: (i - (arr.length - 1)) * 60 }));
  const etaMinutes = scenarioActive ? null : estimateMinutesToCapacityThreshold(trend, drainageBlockage);

  const headline = generateSituationHeadline({
    zoneName: activeZone.name.split('–')[0],
    rainfallDataAvailable,
    effectiveRainfallMmHr,
    capacityMargin,
    etaMinutes,
  });

  const confidence = !rainfallDataAvailable ? 'Low' : 'Medium';
  const availableCount = availableTimestamps.length;

  if (viewMode === 'overview') return <OverviewSituationStrip />;

  return (
    <div className="bg-card/60 border-b border-border px-6 py-4">
      <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-2">
        Current Situation · Nowcast
      </div>
      <h1 className="font-serif text-2xl font-semibold text-foreground leading-snug max-w-4xl text-balance">
        {headline}
      </h1>
      <p className="text-xs text-muted-foreground mt-2">
        Confidence <span className="font-semibold text-foreground">{confidence}</span> · GSMaP + DEM-derived flow · not validated against observed flood
        {availableCount > 0 && trend.length < 3 && ' · trend line too short at this point on the timeline for a threshold estimate'}
      </p>
    </div>
  );
};

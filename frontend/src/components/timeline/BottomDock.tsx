import React, { useEffect, useMemo } from 'react';
import { Play, Pause } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useZoneStore } from '../../stores/useZoneStore';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { rainfallService } from '../../api/services/RainfallDataService';
import { computeZoneFloodSeverity, getEffectiveRainfallMmHr } from '../../lib/riskModel';

// Unifies what used to be two separate always-visible surfaces (Scenario
// Mode sliders + the floating Timeline overlay) into one dock: a real
// summary of the active scenario, a real zone-severity sparkline, and the
// existing scrubber/playback controls. The sliders themselves moved to the
// Simulation Decision-Flow tab (SimulationPanel.tsx) — see
// FLOODWATCH_V3_DESIGN_SPEC.md §4.6.
export const BottomDock: React.FC = () => {
  const {
    timeIndex, availableTimestamps, setTimeIndex, isPlaying, togglePlayback,
    playbackSpeed, setPlaybackSpeed, scenarioMultiplier, drainageBlockage,
  } = useSimulationStore();
  const { activeZone } = useZoneStore();
  const { roadsRisk, infraRisk } = useRainfallAwareRisk();

  const currentTimestamp = availableTimestamps[timeIndex];

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && availableTimestamps.length > 0) {
      interval = setInterval(() => {
        setTimeIndex(timeIndex >= availableTimestamps.length - 1 ? 0 : timeIndex + 1);
      }, 1000 / playbackSpeed);
    }
    return () => clearInterval(interval);
  }, [isPlaying, timeIndex, availableTimestamps, setTimeIndex, playbackSpeed]);

  const zoneData = useMemo(() => rainfallService.getDataForZone(activeZone.id), [activeZone.id]);

  // Real zone-severity sparkline: computeZoneFloodSeverity is a pure
  // function over already-loaded roadsRisk/infraRisk, evaluated at each
  // real per-hour rainfall reading around the current timeline position —
  // not a new model, just the existing one charted inline for the first
  // time.
  const sparkline = useMemo(() => {
    if (!roadsRisk && !infraRisk) return [];
    const window = 7;
    const start = Math.max(0, timeIndex - Math.floor(window / 2));
    return zoneData.slice(start, start + window).map((d, i) => {
      const rainfall = getEffectiveRainfallMmHr(d.rainfall_mm, scenarioMultiplier);
      const severity = computeZoneFloodSeverity(roadsRisk, infraRisk, rainfall);
      return { score: severity.score, isCurrent: start + i === timeIndex };
    });
  }, [zoneData, timeIndex, roadsRisk, infraRisk, scenarioMultiplier]);

  if (!availableTimestamps || availableTimestamps.length === 0) {
    return (
      <div className="border-t border-border bg-card px-6 py-4 flex items-center justify-center h-16">
        <p className="text-xs text-muted-foreground animate-pulse">Loading timeline data…</p>
      </div>
    );
  }

  const parsedTime = parseISO(currentTimestamp);
  const scenarioActive = Math.abs(scenarioMultiplier - 1.0) > 1e-9 || drainageBlockage > 0;

  return (
    <div className="border-t border-border bg-card px-6 py-3.5 flex items-center gap-6 flex-wrap">
      <div className="min-w-[210px]">
        <div className="text-[10px] font-bold tracking-widest uppercase text-muted-foreground mb-1">Active Scenario</div>
        <div className="text-[13px] font-semibold text-foreground">
          {scenarioActive ? `${scenarioMultiplier.toFixed(1)}x design-storm rainfall` : 'Real observed rainfall'}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          Drainage blockage {drainageBlockage}% · {format(parsedTime, 'HH:mm, MMM dd')}
        </div>
      </div>

      <div className="flex-1 min-w-[260px]">
        <div className="flex items-end gap-[3px] h-6 mb-1.5">
          {sparkline.map((s, i) => (
            <div
              key={i}
              className={`flex-1 rounded-t-sm ${s.isCurrent ? 'bg-primary' : 'bg-cyan/25'}`}
              style={{ height: `${Math.max(8, s.score * 100)}%` }}
              title={`Zone severity ${s.score.toFixed(2)}`}
            />
          ))}
        </div>
        <div className="relative h-2 bg-muted rounded-full">
          <div className="absolute inset-y-0 left-0 bg-primary rounded-full" style={{ width: `${(timeIndex / Math.max(1, availableTimestamps.length - 1)) * 100}%` }} />
          <input
            type="range" min="0" max={availableTimestamps.length - 1} value={timeIndex}
            onChange={(e) => setTimeIndex(parseInt(e.target.value))}
            className="absolute inset-0 w-full opacity-0 cursor-pointer"
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-1.5">
          <span>{format(parseISO(availableTimestamps[0]), 'HH:mm')}</span>
          <span className="font-semibold text-foreground">{format(parsedTime, 'HH:mm')} (now)</span>
          <span>{format(parseISO(availableTimestamps[availableTimestamps.length - 1]), 'HH:mm')}</span>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={togglePlayback}
          className="w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <div className="flex items-center gap-0.5 bg-muted p-0.5 rounded-lg">
          {[1, 2, 5].map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`px-2 py-1 rounded text-[11px] font-mono font-medium transition-colors ${playbackSpeed === speed ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-background'}`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

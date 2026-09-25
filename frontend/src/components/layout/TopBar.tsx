import React, { useEffect, useState } from 'react';
import { CloudRain, History, Radio, SlidersHorizontal } from 'lucide-react';
import { SystemStatus } from './SystemStatus';
import { useUIStore } from '../../stores/useUIStore';
import { useZoneStore } from '../../stores/useZoneStore';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useRainfallStatusStore } from '../../stores/useRainfallStatusStore';
import { rainfallService } from '../../api/services/RainfallDataService';
import { zoneAreaKm2 } from '../../lib/geo';

// Stage mapping is a direct, undramatized read of the existing zone
// severity label — never a separately-invented number. See
// FLOODCAST_V3_DESIGN_SPEC.md §2.3.
const STAGE_META: Record<string, { stage: number; ok: boolean }> = {
  LOW: { stage: 0, ok: true },
  MODERATE: { stage: 1, ok: false },
  HIGH: { stage: 2, ok: false },
  SEVERE: { stage: 3, ok: false },
};

export const TopBar: React.FC = () => {
  const { appMode, setAppMode, viewMode } = useUIStore();
  const { mode, setMode } = useSimulationStore();
  const { activeZone } = useZoneStore();
  const { zoneSeverity } = useRainfallAwareRisk();
  const rainfallStatus = useRainfallStatusStore((s) => s.status);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    rainfallService.loadData().then(() => {
      const latest = rainfallService.getLatestTimestamp();
      if (latest) setSnapshotDate(new Date(latest).toISOString().slice(0, 10));
    });
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const stageMeta = STAGE_META[zoneSeverity.label] ?? STAGE_META.LOW;
  const stagePillText = viewMode === 'zone'
    ? stageMeta.ok
      ? `Stage ${stageMeta.stage} · Nominal — ${activeZone.name.split('–')[0]} zone`
      : `Stage ${stageMeta.stage} · ${zoneSeverity.label.charAt(0)}${zoneSeverity.label.slice(1).toLowerCase()} — ${activeZone.name.split('–')[0]} corridor at risk`
    : 'Monitoring Greater Mumbai — 2 of 2 pilot zones online';

  const areaKm2 = zoneAreaKm2(activeZone);

  // §7: this is one slot with two mutually-exclusive honest states, never
  // blended. "Nowcast" only appears while the automatic rainfall-refresh
  // pipeline (RAINFALL_AUTOMATION_ARCHITECTURE.md) is actually live and
  // healthy; otherwise the real state — a fixed historical snapshot — is
  // shown exactly as before, unchanged by anything in this redesign.
  const isLiveFeed = rainfallStatus?.status === 'ok'
    && rainfallStatus.data_age_hours !== null
    && rainfallStatus.data_age_hours < 2;

  return (
    <div className="min-h-14 border-b border-border bg-background/95 backdrop-blur z-50 flex items-center gap-4 px-6 py-2 flex-wrap">
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <CloudRain className="w-4.5 h-4.5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-wide text-foreground leading-tight">FLOODCAST</h1>
          <p className="text-[9.5px] text-muted-foreground tracking-wider uppercase leading-tight">Urban Flood Intelligence</p>
        </div>
      </div>

      <div className={`hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
        stageMeta.ok ? 'bg-green/10 text-green border-green/25' : 'bg-amber/10 text-amber border-amber/25'
      }`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stageMeta.ok ? 'bg-green' : 'bg-amber'}`} />
        {stagePillText}
      </div>

      {viewMode === 'zone' && (
        <div className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-card border border-border">
          <span className="text-muted-foreground">Pilot Zone</span>
          <span className="font-semibold text-foreground">{activeZone.name.split('–').slice(0, 2).join('–')}</span>
          {areaKm2 !== null && <span className="text-muted-foreground">· {areaKm2.toFixed(1)} km²</span>}
        </div>
      )}

      <div className="flex-1" />

      <div
        className="flex items-center bg-muted rounded-full p-0.5 shrink-0"
        title={
          mode === 'live'
            ? 'Live Mode: real observed rainfall and derived nowcast only, auto-updating. Manual controls are disabled.'
            : 'Demo Mode — Scenario Simulation (Hypothetical): a self-contained, illustrative simulation for exploration and presentation, never real observed data.'
        }
      >
        <button
          onClick={() => setMode('live')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            mode === 'live' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Radio className="w-3 h-3" /> Live
        </button>
        <button
          onClick={() => setMode('demo')}
          className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            mode === 'demo' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <SlidersHorizontal className="w-3 h-3" /> Demo
        </button>
      </div>

      <div className="hidden lg:block h-6 w-px bg-border shrink-0" />

      <div className="flex items-center bg-muted rounded-full p-0.5 shrink-0">
        <button
          onClick={() => setAppMode('command')}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            appMode === 'command' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Command
        </button>
        <button
          onClick={() => setAppMode('citizen')}
          className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            appMode === 'citizen' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Citizen View
        </button>
      </div>

      <div className="hidden lg:block text-right shrink-0">
        <div className="text-xs font-mono font-semibold text-foreground">
          {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · {now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </div>
        {isLiveFeed ? (
          <div className="flex items-center justify-end gap-1 text-[10px] font-bold text-green uppercase tracking-wide">
            <Radio className="w-2.5 h-2.5" /> Nowcast T+0 · Refresh 5min
          </div>
        ) : (
          <div className="flex items-center justify-end gap-1 text-[10px] font-bold text-amber uppercase tracking-wide" title="This dashboard runs on a fixed historical dataset, not a live feed. Do not treat any reading here as real-time current conditions.">
            <History className="w-2.5 h-2.5" /> Snapshot{snapshotDate ? ` — ${snapshotDate}` : ''} · Not Live
          </div>
        )}
      </div>

      <div className="hidden lg:block h-6 w-px bg-border shrink-0" />
      <SystemStatus />
    </div>
  );
};

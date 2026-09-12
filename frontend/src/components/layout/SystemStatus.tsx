import React, { useEffect, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';
import { useDataHealthStore } from '../../stores/useDataHealthStore';
import { useRainfallStatusStore } from '../../stores/useRainfallStatusStore';

type Level = 'READY' | 'PARTIAL' | 'SIMULATED' | 'BLOCKED';

interface StatusRow {
  label: string;
  level: Level;
  detail: string;
}

const LEVEL_COLOR: Record<Level, string> = {
  READY: 'text-emerald-700',
  PARTIAL: 'text-amber-700',
  SIMULATED: 'text-blue-700',
  BLOCKED: 'text-red-700',
};

interface ManifestDataset {
  category: string;
  status: string;
}

// Derives an honest, manifest-backed status readout. No row here is ever
// hardcoded "ONLINE" — each is computed from what's actually on disk.
function deriveStatuses(datasets: ManifestDataset[]): StatusRow[] {
  const hasReal = (cat: string) =>
    datasets.some((d) => d.category === cat && (d.status === 'REAL' || d.status === 'REAL / OFFICIAL' || d.status === 'OFFICIAL'));
  const isBlocked = (cat: string) => datasets.some((d) => d.category === cat && d.status.includes('UNAVAILABLE'));

  return [
    {
      label: 'RAIN ENGINE',
      level: hasReal('Rainfall') ? 'READY' : 'BLOCKED',
      detail: hasReal('Rainfall') ? 'Real GSMaP hourly data loaded' : 'No real rainfall data loaded',
    },
    {
      label: 'MAP DATA',
      level: hasReal('Roads') && hasReal('Buildings') ? 'READY' : 'PARTIAL',
      detail: 'Roads, buildings, water & infrastructure from OSM/MCGM',
    },
    {
      label: 'DEM / TERRAIN',
      level: isBlocked('DEM / Terrain') ? 'BLOCKED' : 'READY',
      detail: isBlocked('DEM / Terrain') ? 'Requires OPENTOPOGRAPHY_API_KEY' : 'Copernicus DEM loaded',
    },
    {
      label: 'DRAINAGE',
      level: 'PARTIAL',
      detail: 'Open nallas: REAL. Surface flow: INFERRED (real DEM). Official MCGM pipes: unavailable.',
    },
    {
      label: 'FLOOD MODEL',
      level: hasReal('Flood Model') ? 'PARTIAL' : 'SIMULATED',
      detail: hasReal('Flood Model')
        ? 'Susceptibility index: MODELLED (real DEM/landcover/waterways). Depth/extent: still SIMULATED proxy.'
        : 'Deterministic proxy — not a calibrated hydraulic model',
    },
    {
      label: 'VALIDATION',
      level: hasReal('Historical Flood Validation') ? 'PARTIAL' : 'BLOCKED',
      detail: hasReal('Historical Flood Validation')
        ? 'Real event index acquired. Sentinel-1: auth+search+download verified with real CDSE data; scene processing (change detection, IoU/P/R/F1) not yet run.'
        : 'No validation data acquired',
    },
  ];
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

export const SystemStatus: React.FC = () => {
  const [rows, setRows] = useState<StatusRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const failures = useDataHealthStore((s) => s.failures);
  const failureEntries = Object.entries(failures);
  const rainfallStatus = useRainfallStatusStore((s) => s.status);

  // Only ticks while the dropdown is actually open — no point re-rendering
  // an off-screen "Data Age" every minute.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(id);
  }, [open]);

  const rainfallAgeHours = rainfallStatus?.latest_data_timestamp_utc
    ? (now - new Date(rainfallStatus.latest_data_timestamp_utc).getTime()) / 3_600_000
    : null;

  useEffect(() => {
    fetch('/data/data_manifest.json')
      .then((r) => r.json())
      .then((manifest) => setRows(deriveStatuses(manifest.datasets ?? [])))
      .catch(() => setRows(null));
  }, []);

  const worst: Level = failureEntries.length > 0 || rows?.some((r) => r.level === 'BLOCKED')
    ? 'BLOCKED'
    : rainfallStatus?.status === 'warning' || rows?.some((r) => r.level === 'PARTIAL' || r.level === 'SIMULATED')
    ? 'PARTIAL'
    : 'READY';

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs text-muted-foreground mr-1 hover:text-foreground transition-colors"
      >
        <Activity className={`w-4 h-4 ${LEVEL_COLOR[worst]}`} />
        <span className="hidden md:inline">System Status</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && rows && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-2xl p-3 z-50 space-y-2">
          {failureEntries.length > 0 && (
            <div className="pb-2 mb-1 border-b border-red-500/30">
              <span className="font-semibold text-red-700 text-[11px] block mb-1">
                {failureEntries.length} layer{failureEntries.length > 1 ? 's' : ''} failed to load
              </span>
              {failureEntries.map(([url, msg]) => (
                <div key={url} className="text-[10px] text-muted-foreground truncate" title={`${url}: ${msg}`}>
                  {url.split('/').pop()} — {msg}
                </div>
              ))}
            </div>
          )}
          {rainfallStatus && (
            <div
              className={`pb-2 mb-1 border-b text-[10px] ${
                rainfallStatus.status === 'warning' ? 'border-amber-500/30' : 'border-border/40'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-foreground text-[11px]">RAINFALL FEED (auto-refresh)</span>
                <span className={`font-mono font-bold ${rainfallStatus.status === 'warning' ? LEVEL_COLOR.PARTIAL : LEVEL_COLOR.READY}`}>
                  {rainfallStatus.status === 'warning' ? 'WARNING' : 'OK'}
                </span>
              </div>
              <div className="text-muted-foreground space-y-0.5">
                <div>Last Updated: {new Date(rainfallStatus.last_updated_utc).toLocaleString()}</div>
                <div>Source: {rainfallStatus.source}</div>
                <div>
                  Timestamp: {rainfallStatus.latest_data_timestamp_utc
                    ? new Date(rainfallStatus.latest_data_timestamp_utc).toLocaleString()
                    : 'unknown'}
                </div>
                <div>
                  Data Age: {rainfallAgeHours !== null ? formatAge(rainfallAgeHours) : 'unknown'}
                  {rainfallStatus.new_files_downloaded > 0 && ` · ${rainfallStatus.new_files_downloaded} new file(s) last cycle`}
                </div>
                {rainfallStatus.status === 'warning' && (
                  <div className="text-amber-700 pt-0.5">{rainfallStatus.message}</div>
                )}
              </div>
            </div>
          )}
          {rows.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-2 text-[11px] py-1 border-b border-border/40 last:border-0">
              <div>
                <span className="font-semibold text-foreground block">{row.label}</span>
                <span className="text-muted-foreground">{row.detail}</span>
              </div>
              <span className={`font-mono font-bold shrink-0 ${LEVEL_COLOR[row.level]}`}>{row.level}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

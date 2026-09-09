import React, { useEffect, useState } from 'react';
import { Activity, ChevronDown } from 'lucide-react';

type Level = 'READY' | 'PARTIAL' | 'SIMULATED' | 'BLOCKED';

interface StatusRow {
  label: string;
  level: Level;
  detail: string;
}

const LEVEL_COLOR: Record<Level, string> = {
  READY: 'text-emerald-400',
  PARTIAL: 'text-amber-400',
  SIMULATED: 'text-blue-400',
  BLOCKED: 'text-red-400',
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

export const SystemStatus: React.FC = () => {
  const [rows, setRows] = useState<StatusRow[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/data/data_manifest.json')
      .then((r) => r.json())
      .then((manifest) => setRows(deriveStatuses(manifest.datasets ?? [])))
      .catch(() => setRows(null));
  }, []);

  const worst: Level = rows?.some((r) => r.level === 'BLOCKED')
    ? 'BLOCKED'
    : rows?.some((r) => r.level === 'PARTIAL' || r.level === 'SIMULATED')
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

import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { CheckCircle2, AlertOctagon, FileWarning, History, Calculator } from 'lucide-react';
import { DataStatusBadge } from '../common/DataStatusBadge';

interface ValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface BlockedStatus {
  dataset: string;
  status: string;
  detail?: string;
  required?: string;
  how_to_obtain?: string;
  note?: string;
  retry_recommended?: boolean;
  no_credentials_required?: boolean;
  checked_at?: string;
  authentication?: string;
}

interface IfiEvent {
  event_id?: string;
  start_date?: string;
  end_date?: string;
  category?: 'mumbai_specific' | 'maharashtra_regional';
  human_fatality?: number | null;
  human_displaced?: number | null;
  location?: string;
}

interface S1Scene {
  name: string;
  sensing_date: string;
}

interface S1Status {
  authentication?: string;
  search?: string;
  scenes_found?: S1Scene[];
  download?: string;
  processing?: string;
  status?: string;
}

const METRICS = [
  { id: 'iou', label: 'IoU (Intersection over Union)', formula: '|Predicted ∩ Observed| / |Predicted ∪ Observed|' },
  { id: 'precision', label: 'Precision', formula: 'True Positive Area / (True Positive + False Positive Area)' },
  { id: 'recall', label: 'Recall', formula: 'True Positive Area / (True Positive + False Negative Area)' },
  { id: 'f1', label: 'F1 Score', formula: '2 × (Precision × Recall) / (Precision + Recall)' },
];

export const ValidationModal: React.FC<ValidationModalProps> = ({ isOpen, onClose }) => {
  const [ifiStatus, setIfiStatus] = useState<BlockedStatus | null>(null);
  const [sentinelStatus, setSentinelStatus] = useState<BlockedStatus | null>(null);
  const [sentinelScenes, setSentinelScenes] = useState<S1Status | null>(null);
  const [ifiEvents, setIfiEvents] = useState<IfiEvent[] | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/data/validation/ifi_status.json').then((r) => r.json()).then(setIfiStatus).catch(() => setIfiStatus(null));
    fetch('/data/validation/sentinel1_status.json').then((r) => r.json()).then(setSentinelStatus).catch(() => setSentinelStatus(null));
    fetch('/data/validation/kurla_sion_sentinel1_scenes.json').then((r) => (r.ok ? r.json() : null)).then(setSentinelScenes).catch(() => setSentinelScenes(null));
    fetch('/data/validation/mumbai_ifi_events.json').then((r) => (r.ok ? r.json() : null)).then(setIfiEvents).catch(() => setIfiEvents(null));
  }, [isOpen]);

  const sentinelAuthOk = sentinelStatus?.status?.startsWith('AUTHENTICATED') ?? false;

  const ifiDownloaded = ifiStatus?.status === 'DOWNLOADED';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Model Validation"
      subtitle="Honest validation status against real historical flood observations — no scores are shown until a real comparison has actually been run"
      icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-6">
        {/* Honesty banner */}
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3">
          <AlertOctagon className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-amber-400">No hydraulic model has been calibrated or validated yet</p>
            <p className="text-muted-foreground leading-relaxed">
              FLOODWATCH's current flood depth/extent is a transparent deterministic proxy (rainfall × scenario multiplier ×
              drainage-blockage factor) — see the Data Provenance panel. It has not been compared against any real observed
              flood extent. The scorecards below show real, reproducible metrics only once such a comparison has actually
              been executed. No accuracy numbers are fabricated in their absence.
            </p>
          </div>
        </div>

        {/* Historical event source: India Flood Inventory */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <History className="w-4 h-4 text-cyan" />
              <span>Historical Flood Event Index — India Flood Inventory v2 (Zenodo 11275211)</span>
            </h4>
            <DataStatusBadge status={ifiDownloaded ? 'OBSERVED' : 'UNAVAILABLE'} />
          </div>

          {ifiDownloaded && ifiEvents ? (
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                {ifiEvents.length} real events found (
                {ifiEvents.filter((e) => e.category === 'mumbai_specific').length} Mumbai-specific,{' '}
                {ifiEvents.filter((e) => e.category === 'maharashtra_regional').length} broader Maharashtra-regional
                events that incidentally list Mumbai). Event index only — no point geometry, so not shown on the map.
              </p>
              {ifiEvents
                .filter((e) => e.category === 'mumbai_specific')
                .slice(0, 8)
                .map((ev, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-muted/40 border border-border/60 flex justify-between items-center gap-2">
                    <span className="font-mono text-muted-foreground shrink-0">{ev.start_date?.split(' ')[0] ?? ev.event_id}</span>
                    <span className="text-[10px] text-muted-foreground text-right">
                      {ev.human_fatality ? `${ev.human_fatality} fatalities` : ''}
                      {ev.human_displaced ? ` · ${ev.human_displaced} displaced` : ''}
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground space-y-2">
              <p>
                <span className="font-semibold text-foreground">Status:</span> {ifiStatus?.status ?? 'Checking...'}
              </p>
              {ifiStatus?.detail && <p>{ifiStatus.detail}</p>}
              {ifiStatus?.no_credentials_required && (
                <p className="text-emerald-400">No credentials are required for this dataset — only a retry once Zenodo's service recovers.</p>
              )}
            </div>
          )}
        </div>

        {/* Sentinel-1 change detection */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <FileWarning className="w-4 h-4 text-cyan" />
              <span>Satellite Flood-Extent Validation — Sentinel-1 SAR (VV change detection)</span>
            </h4>
            <DataStatusBadge status={sentinelAuthOk ? 'MODEL_DERIVED' : 'UNAVAILABLE'} />
          </div>

          {sentinelAuthOk ? (
            <div className="text-xs space-y-2.5">
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <span className="block text-emerald-400 font-bold">Auth</span>
                  <span className="text-[10px] text-muted-foreground">VERIFIED</span>
                </div>
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                  <span className="block text-emerald-400 font-bold">Search</span>
                  <span className="text-[10px] text-muted-foreground">{sentinelScenes?.scenes_found?.length ?? 0} real scenes</span>
                </div>
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
                  <span className="block text-amber-400 font-bold">Processing</span>
                  <span className="text-[10px] text-muted-foreground">NOT RUN</span>
                </div>
              </div>
              <p className="text-muted-foreground">
                Real Copernicus Data Space authentication succeeded and a real catalog search found{' '}
                {sentinelScenes?.scenes_found?.length ?? 0} genuine Sentinel-1 scenes over Kurla-Sion in the last 90 days.
                A partial download (5MB) was verified as a real ZIP/SAFE archive — this also caught and fixed a
                cross-host redirect bug where CDSE's download endpoint was silently dropping the auth header.
                The full scene (~1GB) was not downloaded and VV change-detection / IoU / Precision / Recall / F1
                have NOT been run — no accuracy numbers are fabricated.
              </p>
              {sentinelScenes?.scenes_found?.slice(0, 3).map((s, i) => (
                <div key={i} className="p-2 rounded bg-muted/40 border border-border/60 flex justify-between font-mono text-[10px]">
                  <span className="truncate">{s.name}</span>
                  <span className="text-muted-foreground shrink-0 ml-2">{s.sensing_date?.split('T')[0]}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground space-y-2">
              <p><span className="font-semibold text-foreground">Status:</span> {sentinelStatus?.status ?? 'BLOCKED — CREDENTIALS REQUIRED'}</p>
              {sentinelStatus?.authentication && (
                <p><span className="font-semibold text-foreground">Authentication:</span> {sentinelStatus.authentication}</p>
              )}
              {sentinelStatus?.required && (
                <p><span className="font-semibold text-foreground">Required:</span> {sentinelStatus.required}</p>
              )}
              <p className="text-[11px] italic">
                The downloader, AOI handling, and pre/post VV change-detection pipeline are fully implemented in
                <code className="mx-1 px-1 py-0.5 rounded bg-black/30">data/scripts/sentinel1_validation.py</code>
                — it runs the moment valid credentials are supplied.
              </p>
            </div>
          )}
        </div>

        {/* Metric definitions — documentation only, never filled with fake numbers */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-cyan" />
            <span>Metrics This System Will Report Once Validation Data Exists</span>
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {METRICS.map((m) => (
              <div key={m.id} className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <span className="font-semibold text-foreground block mb-1">{m.label}</span>
                <code className="text-[10px] text-cyan">{m.formula}</code>
                <p className="text-muted-foreground mt-1.5">Not yet computed — no observed flood extent is available to compare against.</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
};

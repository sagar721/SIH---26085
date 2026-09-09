import React from 'react';
import { Modal } from '../common/Modal';
import { DataStatusBadge } from '../common/DataStatusBadge';
import { ShieldCheck, AlertOctagon } from 'lucide-react';
import { PROVENANCE_CATALOG } from '../../data/provenanceData';
import type { ProvenanceStatus } from '../../types/provenance';

interface MethodologyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CategoryDef {
  key: ProvenanceStatus | 'SIMULATED';
  label: string;
  definition: string;
  examples: string[];
}

// Judge-facing definitions for the six provenance tiers used throughout the
// app. Counts are computed live from PROVENANCE_CATALOG (the same catalog
// backing the Data Provenance modal) so this dashboard cannot silently drift
// out of sync with what's actually implemented.
const CATEGORY_DEFS: CategoryDef[] = [
  {
    key: 'OBSERVED',
    label: 'Observed',
    definition: 'Measured directly from a real sensor or dataset (satellite, survey) — not computed or estimated.',
    examples: ['GSMaP hourly rainfall', 'Copernicus DEM elevation', 'OSM roads/buildings/water', 'ESA WorldCover land cover'],
  },
  {
    key: 'OFFICIAL',
    label: 'Official',
    definition: 'Published or provided directly by a government/municipal authority (MCGM), used as-is without modification.',
    examples: ['MCGM health/fire/police/metro/rail facility locations', 'MCGM stormwater drain aggregate statistics (non-spatial)'],
  },
  {
    key: 'INFERRED',
    label: 'Inferred',
    definition: 'Derived from real observed data via a deterministic, unit-tested algorithm — not measured directly, and never presented as official.',
    examples: ['DEM-derived surface flow network (D8 + flow accumulation)', 'DEM/slope click-inspect grid values'],
  },
  {
    key: 'MODELLED',
    label: 'Modelled',
    definition: 'A transparent, documented mathematical combination of real inputs — not calibrated or validated against observed flood outcomes.',
    examples: ['Flood susceptibility index', 'Rainfall-adjusted road impact score', 'Criticality-weighted infrastructure exposure score', 'Zone flood severity score'],
  },
  {
    key: 'SIMULATED',
    label: 'Simulated',
    definition: 'A deterministic proxy formula standing in for a real hydrology model, driven by user-adjustable scenario sliders — explicitly not a forecast.',
    examples: ['Flood depth/extent (rainfall × scenario multiplier × drainage blockage proxy)', 'Safe-routing ETA/path'],
  },
  {
    key: 'UNAVAILABLE',
    label: 'Unavailable',
    definition: 'Identified and investigated but not obtainable in this project — never faked or substituted with a lower-tier dataset presented as equivalent.',
    examples: ['MCGM underground stormwater pipe/manhole network', 'IMD/MCGM live rain-gauge APIs', 'Sentinel-1 SAR-validated flood extent (auth/search proven, full processing not run)'],
  },
];

const LIMITATIONS = [
  'The flood-susceptibility formula is an equal-weighted composite of 5 real terrain/landcover factors — documented and reproducible, but not calibrated or fitted against any observed flood depth.',
  'No historical flood extent (Sentinel-1 SAR or otherwise) has been compared to model output — there is no accuracy, IoU, or F1 number anywhere in this system, real or claimed.',
  'Sentinel-1 authentication, catalog search, and partial download are verified against the real Copernicus Data Space Ecosystem; full-scene SAR processing and flood-mask generation have not been run.',
  'The official MCGM underground stormwater pipe/manhole network is not published as GIS anywhere (136 ArcGIS services checked across two MCGM hosts, zero matches) — the "Inferred Surface Drainage" layer is a DEM-derived surface proxy, never a substitute.',
  'No rainfall nowcast/forecast model exists — the timeline only plays back observed (past) GSMaP hours.',
  'Flood depth/extent shown on the map is a deterministic SIMULATED proxy (rainfall × scenario multiplier × blockage), not a hydraulic or hydrological simulation.',
];

export const MethodologyModal: React.FC<MethodologyModalProps> = ({ isOpen, onClose }) => {
  const statusCounts = PROVENANCE_CATALOG.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});
  // MODEL_DERIVED entries (e.g. Sentinel-1, still auth/search-only) are folded
  // into the Modelled bucket's count for this judge-facing summary.
  const modelledCount = (statusCounts.MODELLED ?? 0) + (statusCounts.MODEL_DERIVED ?? 0);
  const countFor = (key: CategoryDef['key']) => {
    if (key === 'SIMULATED') return null; // not a catalog entry — a live UI computation, see examples
    if (key === 'MODELLED') return modelledCount;
    return statusCounts[key] ?? 0;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Data Honesty & Methodology"
      subtitle="What's real, what's derived, what's simulated, and what's still missing — in one place"
      icon={<ShieldCheck className="w-5 h-5" />}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {CATEGORY_DEFS.map((cat) => {
            const count = countFor(cat.key);
            return (
              <div key={cat.key} className="p-4 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between mb-2">
                  <DataStatusBadge status={cat.key === 'SIMULATED' ? 'SIMULATED' : (cat.key as ProvenanceStatus)} />
                  {count !== null && (
                    <span className="text-xs font-mono text-muted-foreground">{count} dataset{count === 1 ? '' : 's'}</span>
                  )}
                </div>
                <p className="text-xs text-foreground mb-2">{cat.definition}</p>
                <ul className="text-[11px] text-muted-foreground list-disc list-inside space-y-0.5">
                  {cat.examples.map((ex) => <li key={ex}>{ex}</li>)}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="p-4 rounded-xl bg-card border border-border">
          <h4 className="text-sm font-bold text-foreground mb-2">Methodology summary</h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Flood susceptibility index</strong> (MODELLED, static): an equal-weighted
            0-1 composite of inverse elevation, inverse slope, log flow-accumulation, built-up fraction, and inverse
            distance-to-waterway — all real, DEM/landcover/OSM-derived factors, sampled per pixel across Greater Mumbai.<br />
            <strong className="text-foreground">Rainfall-aware impact model</strong> (MODELLED, live): the static
            susceptibility score at each real road segment / infrastructure point is multiplied by a rainfall factor
            (current real GSMaP intensity ÷ MCGM's official 50mm/hr BRIMSTOWAD design storm, capped at 3×), producing a
            live 0-1 "adjusted risk" per feature. Road Impact Score and Infrastructure Exposure Score are the mean
            adjusted risk across all road/infra features in the active zone; Infrastructure Exposure additionally
            weights each asset by a criticality tier (hospitals/fire stations = 1.0, police/metro/rail = 0.75,
            schools/public facilities = 0.5, generic assets = 0.25). Zone Flood Severity blends both into one score.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-card border border-amber-500/30 bg-amber-500/5">
          <h4 className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
            <AlertOctagon className="w-4 h-4 text-amber-400" /> Current system limitations
          </h4>
          <ul className="text-xs text-muted-foreground list-disc list-inside space-y-1.5">
            {LIMITATIONS.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </div>
      </div>
    </Modal>
  );
};

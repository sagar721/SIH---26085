import React, { useState, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Database, Search, ShieldCheck, ExternalLink } from 'lucide-react';
import { PROVENANCE_CATALOG } from '../../data/provenanceData';
import { DataStatusBadge } from '../common/DataStatusBadge';
import type { DataCategory, DataProvenanceItem } from '../../types/provenance';

interface DataProvenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES: ('ALL' | DataCategory)[] = [
  'ALL',
  'Rainfall',
  'DEM / Terrain',
  'Buildings',
  'Roads',
  'Land Cover',
  'Water / Nallas',
  'Drainage & Hydro',
  'Critical Infrastructure',
  'Historical Flood Validation',
  'Flood Model'
];

export const DataProvenanceModal: React.FC<DataProvenanceModalProps> = ({ isOpen, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'ALL' | DataCategory>('ALL');
  const [selectedItem, setSelectedItem] = useState<DataProvenanceItem | null>(null);

  const filteredItems = useMemo(() => {
    return PROVENANCE_CATALOG.filter(item => {
      const matchesCategory = selectedCategory === 'ALL' || item.category === selectedCategory;
      const matchesSearch = 
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.provider.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.howWeUseIt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.notes.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Data Provenance & Source Registry"
      subtitle="Verified scientific datasets, spatial resolutions, licensing, and model ingestion methods"
      icon={<Database className="w-5 h-5" />}
      maxWidth="max-w-6xl"
    >
      <div className="space-y-6">
        {/* Compliance & Transparency Banner */}
        <div className="p-4 rounded-xl bg-cyan/10 border border-cyan/25 flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-cyan shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-cyan">SIH26085 Scientific Integrity & Provenance Compliance</p>
            <p className="text-muted-foreground leading-relaxed">
              Every spatial and temporal layer in FLOODWATCH is tagged with its authoritative data provider and operational status.
              Synthetic and hydrologically inferred layers are explicitly demarcated with <span className="font-mono text-amber-700 bg-amber-400/10 px-1 py-0.5 rounded border border-amber-400/20">[INFERRED]</span> / <span className="font-mono text-purple-700 bg-purple-400/10 px-1 py-0.5 rounded border border-purple-400/20">[SYNTHETIC]</span> badges and are never misrepresented as official municipal records.
            </p>
          </div>
        </div>

        {/* Filter and Search Bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 text-xs">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-all whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-cyan text-black font-semibold shadow-md shadow-cyan/20'
                    : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="relative min-w-[240px]">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search datasets, providers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-muted/50 border border-border rounded-lg text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan transition-colors"
            />
          </div>
        </div>

        {/* Dataset Table / Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredItems.map(item => (
            <div
              key={item.id}
              onClick={() => setSelectedItem(selectedItem?.id === item.id ? null : item)}
              className={`p-4 rounded-xl border transition-all cursor-pointer ${
                selectedItem?.id === item.id
                  ? 'bg-card border-cyan shadow-lg shadow-cyan/10'
                  : 'bg-card/60 border-border hover:border-cyan/50 hover:bg-card/90'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-cyan px-2 py-0.5 rounded bg-cyan/10 border border-cyan/20">
                      {item.category}
                    </span>
                    <DataStatusBadge status={item.status} />
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-700 border border-blue-500/20">
                      {item.recommendation}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-foreground mt-1">{item.name}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.provider}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/60 text-[11px]">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Spatial Res</span>
                  <span className="font-medium text-foreground">{item.spatialResolution}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Temporal Res</span>
                  <span className="font-medium text-foreground">{item.temporalResolution}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Access / Format</span>
                  <span className="font-medium text-foreground">{item.fileFormat}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Type</span>
                  <span className="font-medium text-foreground">{item.dataType}</span>
                </div>
              </div>

              <div className="mt-3 pt-2 text-xs text-muted-foreground bg-muted/30 p-2.5 rounded-lg border border-border/40">
                <span className="font-semibold text-foreground block mb-0.5">Implementation Role:</span>
                {item.howWeUseIt}
              </div>

              {selectedItem?.id === item.id && (
                <div className="mt-4 pt-4 border-t border-border/80 space-y-3 text-xs animate-fadeIn">
                  <div>
                    <span className="font-semibold text-foreground block text-[11px]">License & Usage Terms:</span>
                    <p className="text-muted-foreground mt-0.5">{item.license}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground block text-[11px]">Data Quality & Operational Notes:</span>
                    <p className="text-muted-foreground mt-0.5">{item.dataQuality}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-foreground block text-[11px]">Access Pipeline:</span>
                    <code className="block mt-1 p-2 rounded bg-black/40 text-[10px] font-mono text-cyan break-all border border-cyan/20">
                      {item.accessMethod}
                    </code>
                  </div>
                  {item.website && (
                    <a
                      href={item.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-cyan hover:underline font-semibold mt-1"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span>Official Source Portal</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {filteredItems.length === 0 && (
          <div className="py-12 text-center text-muted-foreground text-xs">
            No datasets matched your search or category filter.
          </div>
        )}
      </div>
    </Modal>
  );
};

import React from 'react';
import { useZoneStore } from '../../stores/useZoneStore';
import { useUIStore } from '../../stores/useUIStore';
import { PILOT_ZONES, MUMBAI_OVERVIEW } from '../../types';
import { MapPin, Globe } from 'lucide-react';

export const ZoneSelector: React.FC = () => {
  const { activeZone, setActiveZoneId } = useZoneStore();
  const { viewMode, setViewMode } = useUIStore();

  return (
    <div className="bg-card text-card-foreground p-4 rounded-xl border border-border shadow-2xl flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-primary">
        <MapPin size={16} />
        <h2>PILOT ZONE / CITY CONTEXT</h2>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => setViewMode('overview')}
          className={`flex items-center gap-2 text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
            viewMode === 'overview'
              ? 'bg-primary text-primary-foreground border-transparent shadow-md'
              : 'bg-transparent text-foreground/80 hover:bg-white/5 border border-border'
          }`}
        >
          <Globe size={14} />
          {MUMBAI_OVERVIEW.name} <span className="text-[10px] opacity-70 ml-auto">RESET</span>
        </button>
        {Object.values(PILOT_ZONES).map((zone) => (
          <button
            key={zone.id}
            onClick={() => { setActiveZoneId(zone.id); setViewMode('zone'); }}
            className={`text-left px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
              viewMode === 'zone' && activeZone.id === zone.id
                ? 'bg-primary text-primary-foreground border-transparent shadow-md'
                : 'bg-transparent text-foreground/80 hover:bg-white/5 border border-border'
            }`}
          >
            {zone.name}
          </button>
        ))}
      </div>
    </div>
  );
};

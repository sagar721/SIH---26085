import React from 'react';
import { Settings, Database, BarChart3, CloudRain, CheckCircle2, ShieldCheck } from 'lucide-react';
import { DataStatusBadge } from '../common/DataStatusBadge';
import { SystemStatus } from './SystemStatus';
import { useUIStore } from '../../stores/useUIStore';

export const TopBar: React.FC = () => {
  const { setActiveModal } = useUIStore();

  return (
    <div className="h-14 border-b border-border bg-background/95 backdrop-blur z-50 flex items-center justify-between px-6">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-cyan/20 flex items-center justify-center border border-cyan/30">
            <CloudRain className="w-5 h-5 text-cyan" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-widest text-foreground">FLOODWATCH</h1>
            <p className="text-[10px] text-muted-foreground tracking-wider uppercase">Urban Flood Nowcasting</p>
          </div>
        </div>
        
        <div className="h-6 w-px bg-border mx-2" />
        
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">MUMBAI</span>
          <DataStatusBadge status="OBSERVED" />
          <DataStatusBadge status="INFERRED" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Analytics Action */}
        <button
          onClick={() => setActiveModal('analytics')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground bg-muted/60 hover:bg-muted hover:text-cyan transition-all border border-border/80 hover:border-cyan/40"
        >
          <BarChart3 className="w-4 h-4 text-cyan" />
          <span>Analytics</span>
        </button>

        {/* Provenance Action */}
        <button
          onClick={() => setActiveModal('provenance')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground bg-muted/60 hover:bg-muted hover:text-cyan transition-all border border-border/80 hover:border-cyan/40"
        >
          <Database className="w-4 h-4 text-cyan" />
          <span>Data Provenance</span>
        </button>

        {/* Validation Action */}
        <button
          onClick={() => setActiveModal('validation')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground bg-muted/60 hover:bg-muted hover:text-emerald-400 transition-all border border-border/80 hover:border-emerald-500/40"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Validation</span>
        </button>

        {/* Methodology / Data Honesty Action */}
        <button
          onClick={() => setActiveModal('methodology')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-foreground bg-muted/60 hover:bg-muted hover:text-amber-400 transition-all border border-border/80 hover:border-amber-500/40"
        >
          <ShieldCheck className="w-4 h-4 text-amber-400" />
          <span>Methodology</span>
        </button>

        <div className="h-5 w-px bg-border mx-1" />

        <SystemStatus />

        {/* Settings button */}
        <button
          onClick={() => setActiveModal('settings')}
          className="p-2 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground border border-border/60 transition-colors"
          title="System Settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

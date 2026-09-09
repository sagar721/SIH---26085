import React from 'react';
import { Modal } from '../common/Modal';
import { Settings, Sliders, Gauge } from 'lucide-react';
import { useSimulationStore } from '../../stores/useSimulationStore';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { playbackSpeed, setPlaybackSpeed } = useSimulationStore();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="System Preferences & Configuration"
      subtitle="Hydrological solver parameters, display thresholds, and telemetry adapters"
      icon={<Settings className="w-5 h-5" />}
      maxWidth="max-w-3xl"
    >
      <div className="space-y-6">
        <p className="text-xs text-muted-foreground -mt-2">
          Map layer visibility has moved to the Layers control on the map itself (top-right).
        </p>

        {/* Simulation Execution Speed */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Gauge className="w-4 h-4 text-cyan" />
            <span>Simulation Playback Frame Rate</span>
          </h4>

          <div className="flex items-center gap-2 text-xs">
            {[0.5, 1, 2, 5].map((s) => (
              <button
                key={s}
                onClick={() => setPlaybackSpeed(s)}
                className={`flex-1 py-2 rounded-lg font-bold transition-all ${
                  playbackSpeed === s
                    ? 'bg-cyan text-black shadow-md shadow-cyan/20'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                }`}
              >
                {s}x Speed
              </button>
            ))}
          </div>
        </div>

        {/* Evacuation Routing Thresholds */}
        <div className="p-4 rounded-xl bg-card border border-border">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Sliders className="w-4 h-4 text-cyan" />
            <span>Emergency Impassability Depth Cutoff</span>
          </h4>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
              <span className="text-muted-foreground block text-[10px] uppercase">Passenger Vehicles / Sedans</span>
              <span className="text-sm font-bold font-mono text-amber-400 block mt-1">0.30 m (300 mm)</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">Air intake submergence threshold</p>
            </div>

            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
              <span className="text-muted-foreground block text-[10px] uppercase">Heavy Rescue / NDRF Trucks</span>
              <span className="text-sm font-bold font-mono text-cyan block mt-1">0.60 m (600 mm)</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">High-chassis emergency vehicle limit</p>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};

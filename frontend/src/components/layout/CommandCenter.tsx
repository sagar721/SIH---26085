import React, { useEffect } from 'react';
import { MapContainer } from '../map/MapContainer';
import { ZoneSelector } from '../map/ZoneSelector';
import { SimulationTimeline } from '../timeline/SimulationTimeline';
import { DashboardPanels } from '../dashboard/DashboardPanels';
import { TopBar } from './TopBar';
import { RightPanel } from './RightPanel';
import { rainfallService } from '../../api/services/RainfallDataService';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useUIStore } from '../../stores/useUIStore';
import { AnalyticsModal } from '../analytics/AnalyticsModal';
import { DataProvenanceModal } from '../provenance/DataProvenanceModal';
import { ValidationModal } from '../validation/ValidationModal';
import { SettingsModal } from '../settings/SettingsModal';
import { MethodologyModal } from '../methodology/MethodologyModal';

export const CommandCenter: React.FC = () => {
  const { setAvailableTimestamps } = useSimulationStore();
  const { activeModal, closeModal } = useUIStore();

  useEffect(() => {
    rainfallService.loadData().then((data) => {
      if (data && data.length > 0) {
        setAvailableTimestamps(data.map(d => d.timestamp_utc));
      }
    });
  }, [setAvailableTimestamps]);

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-background text-foreground">
      <TopBar />
      
      <div className="flex-1 flex relative overflow-hidden">
        {/* LEFT SIDEBAR - Controls & Data */}
        <div className="w-96 z-10 h-full bg-background/90 backdrop-blur-xl border-r border-border flex flex-col p-4 shadow-2xl relative overflow-y-auto">
          <div className="flex-1 flex flex-col gap-6">
            <ZoneSelector />
            <DashboardPanels />
          </div>
        </div>

        {/* MAIN CONTENT - Map & Timeline */}
        <div className="flex-1 relative flex flex-col">
          {/* MAP */}
          <div className="flex-1 relative">
            <MapContainer />
          </div>

          {/* BOTTOM TIMELINE OVERLAY */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-full max-w-3xl px-4 z-20">
            <SimulationTimeline />
          </div>
        </div>

        {/* RIGHT INTELLIGENCE PANEL */}
        <RightPanel />
      </div>

      {/* MODALS */}
      <AnalyticsModal
        isOpen={activeModal === 'analytics'}
        onClose={closeModal}
      />
      <DataProvenanceModal
        isOpen={activeModal === 'provenance'}
        onClose={closeModal}
      />
      <ValidationModal
        isOpen={activeModal === 'validation'}
        onClose={closeModal}
      />
      <SettingsModal
        isOpen={activeModal === 'settings'}
        onClose={closeModal}
      />
      <MethodologyModal
        isOpen={activeModal === 'methodology'}
        onClose={closeModal}
      />
    </div>
  );
};

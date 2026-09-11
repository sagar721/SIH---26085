import React, { useEffect, useRef, Suspense, lazy } from 'react';
import { MapContainer } from '../map/MapContainer';
import { TopBar } from './TopBar';
import { SituationStrip } from './SituationStrip';
import { KpiStrip } from './KpiStrip';
import { DecisionFlowRail } from './DecisionFlowRail';
import { RightRail } from './RightRail';
import { BottomDock } from '../timeline/BottomDock';
import { CitizenView } from '../citizen/CitizenView';
import { rainfallService } from '../../api/services/RainfallDataService';
import { useRainfallRefreshStatus } from '../../api/hooks/useRainfallRefreshStatus';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useUIStore } from '../../stores/useUIStore';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { SystemHealthBanner } from '../common/SystemHealthBanner';

// Lazy-loaded: none of these are needed for the initial paint, and splitting
// them out of the main bundle materially cuts first-load parse time on
// low-end devices / slow networks (disaster-readiness audit item 2.4).
const AnalyticsModal = lazy(() => import('../analytics/AnalyticsModal').then((m) => ({ default: m.AnalyticsModal })));
const DataProvenanceModal = lazy(() => import('../provenance/DataProvenanceModal').then((m) => ({ default: m.DataProvenanceModal })));
const ValidationModal = lazy(() => import('../validation/ValidationModal').then((m) => ({ default: m.ValidationModal })));
const MethodologyModal = lazy(() => import('../methodology/MethodologyModal').then((m) => ({ default: m.MethodologyModal })));

// Defers a lazy modal's chunk fetch until it's actually opened once, but
// keeps it mounted (isOpen toggling normally) after that — unmounting on
// every close would skip the exit animation and, worse, could leave a
// backdrop/escape-key listener in an inconsistent state across remounts.
function useEverOpened(isActive: boolean): boolean {
  const everRef = useRef(false);
  if (isActive) everRef.current = true;
  return everRef.current;
}

export const CommandCenter: React.FC = () => {
  const { setAvailableTimestamps } = useSimulationStore();
  const { activeModal, closeModal, appMode } = useUIStore();

  const analyticsEverOpened = useEverOpened(activeModal === 'analytics');
  const provenanceEverOpened = useEverOpened(activeModal === 'provenance');
  const validationEverOpened = useEverOpened(activeModal === 'validation');
  const methodologyEverOpened = useEverOpened(activeModal === 'methodology');

  useEffect(() => {
    rainfallService.loadData().then((data) => {
      if (data && data.length > 0) {
        setAvailableTimestamps(data.map(d => d.timestamp_utc));
      }
    });
  }, [setAvailableTimestamps]);

  // Polls for automatic rainfall refreshes and extends the timeline / feeds
  // the data-health banner when the feed advances or degrades. Mounted once
  // here so it's live regardless of which panel is open.
  useRainfallRefreshStatus();

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-background text-foreground">
      <ErrorBoundary label="System Health Banner">
        <SystemHealthBanner />
      </ErrorBoundary>
      <TopBar />

      {appMode === 'citizen' ? (
        <ErrorBoundary label="Citizen View">
          <CitizenView />
        </ErrorBoundary>
      ) : (
        <>
          <ErrorBoundary label="Situation Strip">
            <SituationStrip />
          </ErrorBoundary>
          <ErrorBoundary label="KPI Strip">
            <KpiStrip />
          </ErrorBoundary>

          <div className="flex-1 flex relative overflow-hidden">
            <ErrorBoundary label="Decision Flow Rail">
              <DecisionFlowRail />
            </ErrorBoundary>

            <div className="flex-1 relative">
              <ErrorBoundary label="Map">
                <MapContainer />
              </ErrorBoundary>
            </div>

            <ErrorBoundary label="Right Rail">
              <RightRail />
            </ErrorBoundary>
          </div>

          <ErrorBoundary label="Bottom Dock">
            <BottomDock />
          </ErrorBoundary>
        </>
      )}

      {/* MODALS — each lazy chunk is only fetched the first time it's opened,
          then stays mounted (isOpen toggles normally) so close/escape and
          exit animations behave exactly as before code-splitting. */}
      <ErrorBoundary label="Analytics">
        <Suspense fallback={null}>
          {analyticsEverOpened && <AnalyticsModal isOpen={activeModal === 'analytics'} onClose={closeModal} />}
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="Data Provenance">
        <Suspense fallback={null}>
          {provenanceEverOpened && <DataProvenanceModal isOpen={activeModal === 'provenance'} onClose={closeModal} />}
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="Validation">
        <Suspense fallback={null}>
          {validationEverOpened && <ValidationModal isOpen={activeModal === 'validation'} onClose={closeModal} />}
        </Suspense>
      </ErrorBoundary>
      <ErrorBoundary label="Methodology">
        <Suspense fallback={null}>
          {methodologyEverOpened && <MethodologyModal isOpen={activeModal === 'methodology'} onClose={closeModal} />}
        </Suspense>
      </ErrorBoundary>
    </div>
  );
};

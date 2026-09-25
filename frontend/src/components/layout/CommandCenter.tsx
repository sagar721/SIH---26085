import React, { useEffect, useRef, Suspense, lazy } from 'react';
import { X } from 'lucide-react';
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
import { useAutoRouteRecompute } from '../../api/hooks/useAutoRouteRecompute';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useUIStore } from '../../stores/useUIStore';
import { ErrorBoundary } from '../common/ErrorBoundary';
import { SystemHealthBanner } from '../common/SystemHealthBanner';
import { resampleToCanonicalTimesteps } from '../../lib/timeline';

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
  const { activeModal, closeModal, appMode, isMapFullscreen, isFullscreenDrawerOpen, setMapFullscreen, setFullscreenDrawerOpen } = useUIStore();

  const analyticsEverOpened = useEverOpened(activeModal === 'analytics');
  const provenanceEverOpened = useEverOpened(activeModal === 'provenance');
  const validationEverOpened = useEverOpened(activeModal === 'validation');
  const methodologyEverOpened = useEverOpened(activeModal === 'methodology');

  // Escape exits Fullscreen Map Mode even when the browser's native
  // Fullscreen API isn't engaged (FullscreenToggle.tsx already handles the
  // native-fullscreen case via the `fullscreenchange` event) — e.g. iOS
  // Safari, where requestFullscreen() on an arbitrary element doesn't
  // exist, so the app's own CSS-driven fullscreen layout is all there is.
  useEffect(() => {
    if (!isMapFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMapFullscreen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMapFullscreen, setMapFullscreen]);

  useEffect(() => {
    rainfallService.loadData().then((data) => {
      if (data && data.length > 0) {
        setAvailableTimestamps(resampleToCanonicalTimesteps(data.map(d => d.timestamp_utc)));
      }
    });
  }, [setAvailableTimestamps]);

  // Polls for automatic rainfall refreshes and extends the timeline / feeds
  // the data-health banner when the feed advances or degrades. Mounted once
  // here so it's live regardless of which panel is open.
  useRainfallRefreshStatus();

  // Keeps any already-calculated safe route current with the simulation
  // timeline, Scenario Mode sliders, and live rainfall refreshes — mounted
  // once here (not inside RoutingPanel) so it keeps recomputing even while
  // the Response & Routing tab isn't the one on screen. See
  // useAutoRouteRecompute.ts and PROJECT_MASTER_DOCUMENTATION.md §4.
  useAutoRouteRecompute();

  return (
    <div className="w-screen h-screen overflow-hidden flex flex-col bg-background text-foreground">
      {!isMapFullscreen && (
        <>
          <ErrorBoundary label="System Health Banner">
            <SystemHealthBanner />
          </ErrorBoundary>
          <TopBar />
        </>
      )}

      {appMode === 'citizen' ? (
        <ErrorBoundary label="Citizen View">
          <CitizenView />
        </ErrorBoundary>
      ) : (
        <>
          {!isMapFullscreen && (
            <>
              <ErrorBoundary label="Situation Strip">
                <SituationStrip />
              </ErrorBoundary>
              <ErrorBoundary label="KPI Strip">
                <KpiStrip />
              </ErrorBoundary>
            </>
          )}

          {/*
            Fullscreen Map Mode: the map expands
            to fill the viewport, but DecisionFlowRail, RightRail (which
            hosts Routing and Simulation controls), and BottomDock stay
            MOUNTED — never removed from the tree — and simply become
            fixed-position overlays instead of flex siblings. This is a
            pure CSS repositioning, not a second copy of any screen: the
            exact same components, same stores, same in-progress state
            (a calculated route, an open scenario slider, an active
            Decision Flow tab) survive the transition in both directions.
          */}
          <div className={isMapFullscreen ? 'flex-1 relative overflow-hidden' : 'flex-1 flex relative overflow-hidden'}>
            <div className={isMapFullscreen ? 'fixed inset-0 z-40' : 'flex-1 relative'}>
              <ErrorBoundary label="Map">
                <MapContainer />
              </ErrorBoundary>
            </div>

            {/*
              Decision Flow Rail + Right Rail as ONE drawer group in
              fullscreen, not two independently-positioned overlays. Two
              separate `left-0`/`right-0` fixed panels (224px + 384px) would
              overlap — and the later-painted one would silently swallow
              clicks meant for the other — on any viewport under ~608px,
              i.e. every phone. Keeping them as normal flex/flow children of
              one sliding container means they can never overlap each
              other: side-by-side when there's room (sm and up), stacked
              top-to-bottom on a narrow phone screen instead.
            */}
            <div className={isMapFullscreen
              ? `fixed inset-y-0 left-0 z-50 flex flex-col sm:flex-row max-h-full transition-transform duration-200 ${isFullscreenDrawerOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'}`
              : 'contents'
            }>
              {/* The FullscreenToggle's own "Decision Flow" button (drawn on
                  the map, top-left) is what OPENS this drawer — but once
                  open, the drawer's own bg-card panel sits directly on top
                  of that same corner and covers it. This close button lives
                  inside the drawer itself so there's always a visible way
                  to dismiss it again, on any screen size. */}
              {isMapFullscreen && (
                <button
                  onClick={() => setFullscreenDrawerOpen(false)}
                  className="absolute top-2 right-2 z-10 w-7 h-7 rounded-full bg-muted hover:bg-muted/70 flex items-center justify-center text-foreground shadow"
                  title="Close panel"
                  aria-label="Close Decision Flow panel"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <div className={isMapFullscreen ? 'flex-1 min-h-0 sm:flex-none overflow-y-auto' : 'contents'}>
                <ErrorBoundary label="Decision Flow Rail">
                  <DecisionFlowRail />
                </ErrorBoundary>
              </div>
              <div className={isMapFullscreen ? 'flex-1 min-h-0 sm:flex-none overflow-y-auto' : 'contents'}>
                <ErrorBoundary label="Right Rail">
                  <RightRail />
                </ErrorBoundary>
              </div>
            </div>
          </div>

          <div className={isMapFullscreen ? 'fixed bottom-0 inset-x-0 z-50' : 'contents'}>
            <ErrorBoundary label="Bottom Dock">
              <BottomDock />
            </ErrorBoundary>
          </div>
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

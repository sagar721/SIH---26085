import { create } from 'zustand';

export type ActiveModal = 'none' | 'analytics' | 'provenance' | 'validation' | 'methodology';

export type ViewMode = 'overview' | 'zone';

// V3 IA (FLOODCAST_V3_DESIGN_SPEC.md §2.2 / §2.1): Command vs Citizen is an
// orthogonal render mode, not a separate app — both read the same stores.
// Decision Flow tab selects which of Situation/Impact/Response/Simulation
// the right-hand content area shows in Command mode.
export type AppMode = 'command' | 'citizen';
export type DecisionFlowTab = 'situation' | 'impact' | 'response' | 'simulation';

interface UIState {
  activeModal: ActiveModal;
  setActiveModal: (modal: ActiveModal) => void;
  closeModal: () => void;
  provenanceSearch: string;
  setProvenanceSearch: (query: string) => void;
  selectedProvenanceCategory: string;
  setSelectedProvenanceCategory: (category: string) => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  decisionFlowTab: DecisionFlowTab;
  setDecisionFlowTab: (tab: DecisionFlowTab) => void;
  /** Fullscreen Map Mode: the map expands to
   * fill the viewport. Every existing panel (Decision Flow Rail, Right
   * Rail incl. Routing/Simulation, Bottom Dock) stays mounted and reachable
   * as an overlay — nothing is torn down, so no state or control is lost. */
  isMapFullscreen: boolean;
  setMapFullscreen: (v: boolean) => void;
  /** Whether the overlay Decision Flow drawer (left+right rails) is
   * currently slid into view while in fullscreen. Irrelevant outside
   * fullscreen, where those rails are always statically visible instead. */
  isFullscreenDrawerOpen: boolean;
  setFullscreenDrawerOpen: (v: boolean) => void;
  toggleFullscreenDrawer: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  activeModal: 'none',
  setActiveModal: (modal) => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: 'none' }),
  provenanceSearch: '',
  setProvenanceSearch: (query) => set({ provenanceSearch: query }),
  selectedProvenanceCategory: 'ALL',
  setSelectedProvenanceCategory: (category) => set({ selectedProvenanceCategory: category }),
  viewMode: 'overview',
  setViewMode: (mode) => set({ viewMode: mode }),
  appMode: 'command',
  setAppMode: (mode) => set({ appMode: mode }),
  decisionFlowTab: 'situation',
  setDecisionFlowTab: (tab) => set({ decisionFlowTab: tab }),
  isMapFullscreen: false,
  // Leaving fullscreen always closes the drawer too, so the next time
  // fullscreen is entered it starts from the same clean, map-first state.
  setMapFullscreen: (v) => set(v ? { isMapFullscreen: true } : { isMapFullscreen: false, isFullscreenDrawerOpen: false }),
  isFullscreenDrawerOpen: false,
  setFullscreenDrawerOpen: (v) => set({ isFullscreenDrawerOpen: v }),
  toggleFullscreenDrawer: () => set((s) => ({ isFullscreenDrawerOpen: !s.isFullscreenDrawerOpen })),
}));

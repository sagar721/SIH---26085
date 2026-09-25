import { create } from 'zustand';
import { useWhatIfStore } from './useWhatIfStore';

// Strict LIVE / DEMO separation (see PROJECT_MASTER_DOCUMENTATION.md §9).
// This is the ONE place that enforces it: every manual-control setter below is gated on
// `mode` here, so every consumer of this store (KPI strip, situation strip,
// impact panel, routing, map flood/rainfall layers, analytics, citizen view
// — all of which already read timeIndex/scenarioMultiplier/drainageBlockage
// from this single store) automatically stays consistent with the active
// mode without needing its own mode check.
export type OperationMode = 'live' | 'demo';

interface SimulationState {
  /** LIVE = real observed rainfall + derived nowcast, auto-updating, no manual controls.
   *  DEMO = manual rainfall/scenario/blockage controls and extreme-event presets. */
  mode: OperationMode;

  // `availableTimestamps` holds exactly 7 REAL ISO timestamps — the nearest
  // real rainfall reading at each of the canonical T+0/30/60/90/120/150/180
  // minute offsets from the series start (populated by CommandCenter.tsx;
  // see FLOOD_TIMESTEPS_MIN in types/floodSimulation.ts for the offsets
  // themselves). `timeIndex` (0-6) is this app's one single timeline
  // position — it drives real rainfall lookups, the existing Scenario-Mode
  // flood/road/infra calculations, AND (Phase 5) the precomputed
  // drainage-graph flood-simulation frames, all from the same index, so
  // there is exactly one notion of "now" in the simulation. In LIVE mode
  // this index is pinned to the newest available real reading at all times.
  timeIndex: number;
  availableTimestamps: string[];
  isPlaying: boolean;
  playbackSpeed: number; // 1x, 2x, etc.
  scenarioMultiplier: number;
  drainageBlockage: number;

  setMode: (mode: OperationMode) => void;
  setTimeIndex: (index: number) => void;
  setAvailableTimestamps: (timestamps: string[]) => void;
  togglePlayback: () => void;
  setPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setScenarioMultiplier: (val: number) => void;
  setDrainageBlockage: (val: number) => void;
  /** Back to T+0 and paused — used by the BottomDock Reset control and on pilot-zone switch. DEMO only. */
  resetTimeline: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  mode: 'live',
  timeIndex: 0,
  availableTimestamps: [],
  isPlaying: false,
  playbackSpeed: 1,
  scenarioMultiplier: 1.0,
  drainageBlockage: 0,

  setMode: (mode) => {
    if (mode === get().mode) return;
    if (mode === 'live') {
      // Entering LIVE snaps back to real conditions everywhere in one step:
      // baseline rainfall (1.0x), no artificial blockage, playback stopped,
      // timeline pinned to the newest real reading, and any DEMO-only
      // What-If map overlay switched off so the flood layer can't keep
      // showing a hypothetical baseline/intervention comparison under a
      // "Live" label.
      const latest = Math.max(0, get().availableTimestamps.length - 1);
      useWhatIfStore.getState().setView('off');
      set({ mode, scenarioMultiplier: 1.0, drainageBlockage: 0, isPlaying: false, timeIndex: latest });
    } else {
      set({ mode });
    }
  },

  setTimeIndex: (index) => {
    // No manual scrubbing in LIVE mode — the timeline only moves when a new
    // real reading actually arrives (see setAvailableTimestamps below).
    if (get().mode === 'live') return;
    const max = Math.max(0, get().availableTimestamps.length - 1);
    set({ timeIndex: Math.max(0, Math.min(max, index)) });
  },
  setAvailableTimestamps: (timestamps) => {
    // LIVE mode's "automatic updates" contract: whenever the real rainfall
    // series extends (a new hourly reading lands), the timeline follows it
    // immediately. DEMO mode leaves whatever timestep the user is examining
    // untouched, matching prior behavior.
    const nextIndex = get().mode === 'live' ? Math.max(0, timestamps.length - 1) : get().timeIndex;
    set({ availableTimestamps: timestamps, timeIndex: nextIndex });
  },
  togglePlayback: () => {
    if (get().mode === 'live') return;
    set((state) => ({ isPlaying: !state.isPlaying }));
  },
  setPlaying: (playing) => {
    if (get().mode === 'live') return;
    set({ isPlaying: playing });
  },
  setPlaybackSpeed: (speed) => {
    if (get().mode === 'live') return;
    set({ playbackSpeed: speed });
  },
  setScenarioMultiplier: (val) => {
    if (get().mode === 'live') return;
    set({ scenarioMultiplier: val });
  },
  setDrainageBlockage: (val) => {
    if (get().mode === 'live') return;
    set({ drainageBlockage: val });
  },
  resetTimeline: () => {
    if (get().mode === 'live') return;
    set({ timeIndex: 0, isPlaying: false });
  },
}));

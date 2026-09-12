import { create } from 'zustand';

interface SimulationState {
  // `availableTimestamps` holds exactly 7 REAL ISO timestamps — the nearest
  // real rainfall reading at each of the canonical T+0/30/60/90/120/150/180
  // minute offsets from the series start (populated by CommandCenter.tsx;
  // see FLOOD_TIMESTEPS_MIN in types/floodSimulation.ts for the offsets
  // themselves). `timeIndex` (0-6) is this app's one single timeline
  // position — it drives real rainfall lookups, the existing Scenario-Mode
  // flood/road/infra calculations, AND (Phase 5) the precomputed
  // drainage-graph flood-simulation frames, all from the same index, so
  // there is exactly one notion of "now" in the simulation.
  timeIndex: number;
  availableTimestamps: string[];
  isPlaying: boolean;
  playbackSpeed: number; // 1x, 2x, etc.
  scenarioMultiplier: number;
  drainageBlockage: number;

  setTimeIndex: (index: number) => void;
  setAvailableTimestamps: (timestamps: string[]) => void;
  togglePlayback: () => void;
  setPlaying: (playing: boolean) => void;
  setPlaybackSpeed: (speed: number) => void;
  setScenarioMultiplier: (val: number) => void;
  setDrainageBlockage: (val: number) => void;
  /** Back to T+0 and paused — used by the BottomDock Reset control and on pilot-zone switch. */
  resetTimeline: () => void;
}

export const useSimulationStore = create<SimulationState>((set, get) => ({
  timeIndex: 0,
  availableTimestamps: [],
  isPlaying: false,
  playbackSpeed: 1,
  scenarioMultiplier: 1.0,
  drainageBlockage: 0,

  setTimeIndex: (index) => {
    const max = Math.max(0, get().availableTimestamps.length - 1);
    set({ timeIndex: Math.max(0, Math.min(max, index)) });
  },
  setAvailableTimestamps: (timestamps) => set({ availableTimestamps: timestamps }),
  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setPlaying: (playing) => set({ isPlaying: playing }),
  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),
  setScenarioMultiplier: (val) => set({ scenarioMultiplier: val }),
  setDrainageBlockage: (val) => set({ drainageBlockage: val }),
  resetTimeline: () => set({ timeIndex: 0, isPlaying: false }),
}));

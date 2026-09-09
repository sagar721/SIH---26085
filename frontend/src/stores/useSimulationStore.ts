import { create } from 'zustand';

interface SimulationState {
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
}));

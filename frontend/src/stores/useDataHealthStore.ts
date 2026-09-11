import { create } from 'zustand';

// Tracks real fetch failures for named data layers (populated by the
// adapters, never simulated) so the UI can show an honest "this layer
// failed to load" indicator instead of a silently-empty map layer —
// mitigates audit item 1.4 (missing infrastructure data fails silently).
interface DataHealthState {
  failures: Record<string, string>; // layer label -> error message
  reportFailure: (layer: string, message: string) => void;
  reportSuccess: (layer: string) => void;
}

export const useDataHealthStore = create<DataHealthState>((set) => ({
  failures: {},
  reportFailure: (layer, message) =>
    set((state) => ({ failures: { ...state.failures, [layer]: message } })),
  reportSuccess: (layer) =>
    set((state) => {
      if (!(layer in state.failures)) return state;
      const next = { ...state.failures };
      delete next[layer];
      return { failures: next };
    }),
}));

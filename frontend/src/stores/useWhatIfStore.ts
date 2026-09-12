import { create } from 'zustand';

// Phase 7 — which SIMULATED what-if variant (Phase 4 output) the map's flood
// layer currently shows. 'off' = the normal Phase 3 flood-simulation layer
// (design_storm/observed), unaffected by anything in this store.
export type WhatIfView = 'off' | 'baseline' | 'intervention' | 'difference';

interface WhatIfState {
  view: WhatIfView;
  setView: (v: WhatIfView) => void;
}

export const useWhatIfStore = create<WhatIfState>((set) => ({
  view: 'off',
  setView: (v) => set({ view: v }),
}));

import { create } from 'zustand';
import { PILOT_ZONES } from '../types';
import type { PilotZone } from '../types';

interface ZoneState {
  activeZone: PilotZone;
  setActiveZoneId: (zoneId: string) => void;
}

export const useZoneStore = create<ZoneState>((set) => ({
  activeZone: PILOT_ZONES.kurla_sion,
  setActiveZoneId: (zoneId) => {
    const zone = PILOT_ZONES[zoneId];
    if (zone) {
      set({ activeZone: zone });
    }
  },
}));

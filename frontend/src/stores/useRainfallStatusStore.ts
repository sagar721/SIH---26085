import { create } from 'zustand';
import type { RainfallRefreshStatus } from '../api/services/RainfallStatusService';

// Holds the latest polled rainfall_refresh_status.json so multiple
// components (SystemStatus display, anything else that wants it) can read
// it without each mounting its own poller — useRainfallRefreshStatus is the
// single writer, mounted once in CommandCenter.
interface RainfallStatusState {
  status: RainfallRefreshStatus | null;
  setStatus: (status: RainfallRefreshStatus) => void;
}

export const useRainfallStatusStore = create<RainfallStatusState>((set) => ({
  status: null,
  setStatus: (status) => set({ status }),
}));

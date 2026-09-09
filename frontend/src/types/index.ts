export type DataConfidence = 'OBSERVED' | 'AUTHORITATIVE' | 'INFERRED' | 'SIMULATED' | 'SYNTHETIC' | 'MOCK';

export interface DataProvenance {
  source: string;
  confidence: DataConfidence;
  lastUpdated?: string;
  description?: string;
}

export interface PilotZone {
  id: string;
  name: string;
  center: [number, number]; // [longitude, latitude]
  zoom: number;
  bbox?: [number, number, number, number];
}

export const PILOT_ZONES: Record<string, PilotZone> = {
  kurla_sion: {
    id: 'kurla_sion',
    name: 'Kurla–Sion–Chunabhatti',
    center: [72.8777, 19.0760],
    zoom: 13,
    bbox: [72.8527, 19.0510, 72.9027, 19.1010] // [west, south, east, north] — matches the real data acquisition bbox
  },
  hindmata_dadar: {
    id: 'hindmata_dadar',
    name: 'Hindmata–Dadar–Parel',
    center: [72.8426, 19.0163],
    zoom: 14,
    bbox: [72.8226, 18.9963, 72.8626, 19.0363]
  }
};

// Camera target for the city-wide context view. Not a pilot zone: no
// per-zone data (rainfall/flood/infra) is fetched for this — it only
// controls where the map flies to. See useUIStore.viewMode.
export const MUMBAI_OVERVIEW = {
  name: 'Mumbai Overview',
  center: [72.88, 19.08] as [number, number],
  zoom: 10.3,
};

export interface SimulationState {
  timeOffsetMinutes: number; // 0 to 180
  isPlaying: boolean;
  playbackSpeed: number; // e.g. 1x, 5x
}

export interface RainfallData {
  intensityMmPerHour: number;
  cumulativeMm: number;
  provenance: DataProvenance;
}

export interface FloodData {
  maxDepthMeters: number;
  floodedAreaSqMeters: number;
  provenance: DataProvenance;
}

import { create } from 'zustand';

export interface LayerDef {
  id: string;
  label: string;
  available: boolean; // whether real (or inferred/simulated) data actually exists for this layer
  unavailableReason?: string;
}

const LAYER_DEFS: LayerDef[] = [
  { id: 'boundary', label: 'Mumbai Boundary', available: true },
  { id: 'cityRoads', label: 'Major Roads (City)', available: true },
  { id: 'roads', label: 'Pilot Zone Roads', available: true },
  { id: 'buildings', label: 'Buildings', available: true },
  { id: 'water', label: 'Water / Nallas', available: true },
  { id: 'landcover', label: 'Land Cover', available: true },
  { id: 'infrastructure', label: 'Critical Infrastructure', available: true },
  { id: 'rainfall', label: 'Rainfall', available: true },
  { id: 'dem', label: 'DEM / Elevation', available: true },
  { id: 'slope', label: 'Slope', available: true },
  { id: 'inferredFlow', label: 'Inferred Surface Drainage (flow accumulation)', available: true },
  { id: 'officialDrainage', label: 'Official Drainage (MCGM)', available: false, unavailableReason: 'Not published by MCGM — requires formal SWD request/RTI' },
  { id: 'flood', label: 'Flood Extent (Simulated)', available: true },
  { id: 'floodSusceptibility', label: 'Flood Susceptibility (Modelled)', available: true },
  { id: 'historicalFloods', label: 'Historical Floods', available: false, unavailableReason: '182 real Mumbai events acquired (India Flood Inventory) but have no point geometry to map — see Validation panel for the list' },
  { id: 'validation', label: 'Validation Overlay', available: false, unavailableReason: 'No Sentinel-1 credentials configured' },
];

type LayerVisibility = Record<string, boolean>;

interface LayerState {
  defs: LayerDef[];
  visibility: LayerVisibility;
  toggleLayer: (id: string) => void;
  setLayer: (id: string, visible: boolean) => void;
  isVisible: (id: string) => boolean;
}

export const useLayerStore = create<LayerState>((set, get) => ({
  defs: LAYER_DEFS,
  visibility: Object.fromEntries(LAYER_DEFS.map((l) => [l.id, l.available])),
  toggleLayer: (id) =>
    set((state) => ({ visibility: { ...state.visibility, [id]: !state.visibility[id] } })),
  setLayer: (id, visible) =>
    set((state) => ({ visibility: { ...state.visibility, [id]: visible } })),
  isVisible: (id) => get().visibility[id] ?? false,
}));

import { create } from 'zustand';

export interface LayerDef {
  id: string;
  label: string;
  available: boolean; // whether real (or inferred/simulated) data actually exists for this layer
  unavailableReason?: string;
  defaultVisible?: boolean; // defaults to `available` when omitted
}

const LAYER_DEFS: LayerDef[] = [
  { id: 'boundary', label: 'Mumbai Boundary', available: true },
  { id: 'cityRoads', label: 'Major Roads (City)', available: true },
  { id: 'roads', label: 'Pilot Zone Roads', available: true },
  { id: 'buildings', label: 'Buildings', available: true },
  { id: 'water', label: 'Water / Nallas', available: true },
  { id: 'landcover', label: 'Land Cover', available: true, defaultVisible: false },
  { id: 'infrastructure', label: 'Critical Infrastructure', available: true },
  { id: 'rainfall', label: 'Rainfall', available: true },
  // Full-bleed, semi-transparent raster overlays — genuinely useful, but
  // three of them stacked on top of the vector layers by default visually
  // wash out roads/buildings under an orange/brown haze (confirmed live:
  // the map's whole point — real roads, buildings, infrastructure being
  // immediately legible — was undermined by these being on-by-default).
  // Still fully available and one click away in the Layers panel.
  { id: 'dem', label: 'DEM / Elevation', available: true, defaultVisible: false },
  { id: 'slope', label: 'Slope', available: true, defaultVisible: false },
  { id: 'inferredFlow', label: 'Inferred Surface Drainage (flow accumulation)', available: true },
  { id: 'officialDrainage', label: 'Official Drainage (MCGM)', available: false, unavailableReason: 'Not published by MCGM — requires formal SWD request/RTI' },
  { id: 'flood', label: 'Flood Extent (Simulated)', available: true },
  { id: 'floodSusceptibility', label: 'Flood Susceptibility (Modelled)', available: true, defaultVisible: false },
];
// Historical Floods and a Validation overlay were removed from this list —
// neither ever had a corresponding map layer (no point geometry / no
// Sentinel-1 credentials), so they were permanently-disabled rows a user
// could never actually toggle. That disclosure already lives properly, with
// full context, in the Methodology modal's "Unavailable" category and the
// Validation panel — duplicating it here as dead checkboxes only cluttered
// the one control meant to be a quick, fully-functional layer picker.

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
  visibility: Object.fromEntries(LAYER_DEFS.map((l) => [l.id, l.defaultVisible ?? l.available])),
  toggleLayer: (id) =>
    set((state) => ({ visibility: { ...state.visibility, [id]: !state.visibility[id] } })),
  setLayer: (id, visible) =>
    set((state) => ({ visibility: { ...state.visibility, [id]: visible } })),
  isVisible: (id) => get().visibility[id] ?? false,
}));

// Types for the precomputed flood-simulation frames (data/scripts/
// flood_propagation_engine.py) and the directed drainage graph
// (data/scripts/build_drainage_graph.py) — Phase 1-4 backend outputs,
// served as static files under /data/flood_model/propagation/ and
// /data/drainage/graph/. See those scripts' docstrings for the full
// methodology and provenance reasoning; this file only types the shapes.

/** Canonical simulation timeline — exactly T+0..T+180 in 30-minute steps. */
export const FLOOD_TIMESTEPS_MIN = [0, 30, 60, 90, 120, 150, 180] as const;
export type FloodTimestepMinutes = (typeof FLOOD_TIMESTEPS_MIN)[number];

/**
 * "observed" = REAL GSMaP rainfall for the acquired window (0mm/hr — a
 * genuine dry period). "design_storm" = SIMULATED scenario storm peaking at
 * MCGM's real published BRIMSTOWAD design intensity. "whatif_baseline" /
 * "whatif_intervention" (Phase 4/7) are the same design storm run twice with
 * different ESTIMATED drainage-capacity multipliers — see
 * build_whatif_scenarios.py — SIMULATED hypotheticals, never planned MCGM
 * projects. Never mix these in one display without labelling which is
 * active — see flood_propagation_engine.py.
 */
export type FloodScenario = 'observed' | 'design_storm' | 'whatif_baseline' | 'whatif_intervention';

export type FloodFrameProvenance = 'SIMULATED';

export interface FloodFrameNodeProperties {
  node_id: number;
  t_min: FloodTimestepMinutes;
  depth_m: number;
  depth_category: '0-15cm' | '15-30cm' | '30-50cm' | '50-100cm' | '>100cm';
  landcover_class: number;
  runoff_coeff: number;
  runoff_coeff_provenance: string;
  inflow_m3s: number;
  capacity_m3s: number;
  surcharge_m3s: number;
  is_sink: boolean;
  role: string;
  provenance: FloodFrameProvenance;
  rainfall_scenario: FloodScenario;
}

/** One T+N minute frame for one zone/scenario — a GeoJSON FeatureCollection of drainage-graph nodes carrying that timestep's depth. */
export interface FloodSimulationFrame {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: FloodFrameNodeProperties;
  }>;
}

export interface FloodSimulationFrameSummary {
  t_min: FloodTimestepMinutes;
  file: string;
  rainfall_mm_hr: number;
  max_depth_m: number;
  flooded_node_count: number;
  depth_bin_counts: Record<string, number>;
}

export interface FloodSimulationSummary {
  zone_id: string;
  status: 'COMPLETE' | 'BLOCKED';
  scenario: FloodScenario;
  rainfall_provenance: string;
  capacity_multiplier: number;
  node_count: number;
  flood_onset_minutes: FloodTimestepMinutes | null;
  max_depth_m_overall: number;
  frames: FloodSimulationFrameSummary[];
  model: string;
  generated_at: string;
}

// --- Drainage graph (Phase 2) ---

export interface DrainageGraphNodeProperties {
  node_id: number;
  elevation_m: number;
  elevation_provenance: string;
  in_degree: number;
  out_degree: number;
  is_headwater: boolean;
  is_sink: boolean;
  role: string;
  capacity_m3s: number;
  capacity_provenance: 'ESTIMATED';
  capacity_method: string;
}

export interface DrainageGraphEdgeProperties {
  edge_id: number;
  from_node: number;
  to_node: number;
  direction_provenance: string;
  flow_accumulation_cells: number;
  flow_accumulation_provenance: 'INFERRED';
  length_m: number;
  capacity_m3s: number;
  capacity_provenance: 'ESTIMATED';
}

export interface DrainageGraphNodesFC {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: DrainageGraphNodeProperties }>;
}

export interface DrainageGraphEdgesFC {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; geometry: { type: 'LineString'; coordinates: [number, number][] }; properties: DrainageGraphEdgeProperties }>;
}

// --- Terrain-RGB (Phase 1) ---

// --- What-if scenario comparison (Phase 4/7) ---

export interface WhatIfAffectedRoad {
  osm_id: number | null;
  name: string | null;
  highway: string | null;
  distance_to_flooded_node_m: number;
}

export interface WhatIfAffectedInfrastructure {
  name: string | null;
  type: string | null;
  distance_to_flooded_node_m: number;
}

export interface WhatIfScenarioResult {
  capacity_multiplier: number;
  max_depth_m: number;
  flood_onset_minutes: FloodTimestepMinutes | null;
  peak_flooded_node_count: number;
  peak_flooded_area_m2_estimate: number;
  affected_road_count: number;
  affected_roads_sample: WhatIfAffectedRoad[];
  affected_infrastructure_count: number;
  affected_infrastructure: WhatIfAffectedInfrastructure[];
}

export interface WhatIfComparison {
  zone_id: string;
  status: 'COMPLETE' | 'NO_DATA';
  scenario_type: string;
  rainfall_scenario: string;
  proximity_threshold_m: number;
  flood_impact_depth_threshold_m: number;
  comparison: {
    baseline: WhatIfScenarioResult;
    intervention: WhatIfScenarioResult;
  };
  delta_baseline_minus_intervention: {
    max_depth_m_reduction: number;
    flooded_area_m2_reduction: number;
    affected_roads_reduction: number;
    affected_infrastructure_reduction: number;
    onset_delay_minutes: number | null;
  };
  generated_at: string;
}

export interface TerrainRgbManifest {
  zone_id: string;
  bounds_wgs84: { west: number; south: number; east: number; north: number };
  tile_url_template: string;
  encoding: 'mapbox';
  tile_size: number;
  zoom_levels: number[];
  total_tiles: number;
  provenance: 'DERIVED';
  source: string;
  precision_note: string;
  fallback_used: boolean;
}

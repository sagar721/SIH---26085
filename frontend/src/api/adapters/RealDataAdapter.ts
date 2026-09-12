import type { FloodDataAdapter, TimePoint, FloodRiskSummary } from '../interfaces/FloodDataAdapter';
import type { Feature, FeatureCollection } from 'geojson';
import { rainfallService } from '../services/RainfallDataService';
import { mockAdapter } from './MockAdapter';
import { findContainingFloodZone, filterByBBox } from '../../lib/geo';
import { PILOT_ZONES } from '../../types';
import { useDataHealthStore } from '../../stores/useDataHealthStore';
import type {
  DrainageGraphEdgesFC, DrainageGraphNodesFC, FloodScenario, FloodSimulationFrame,
  FloodSimulationSummary, FloodTimestepMinutes, TerrainRgbManifest, WhatIfComparison,
} from '../../types/floodSimulation';

const MCGM_INFRA_LAYERS = [
  '/data/infrastructure/mcgm_health_facilities.geojson',
  '/data/infrastructure/mcgm_fire_stations.geojson',
  '/data/infrastructure/mcgm_police_stations.geojson',
  '/data/infrastructure/mcgm_metro_stations.geojson',
  '/data/infrastructure/mcgm_suburban_railway_stations.geojson',
];

// Real OSM/MCGM GeoJSON files acquired via data/scripts/download_*.py and
// copied into public/data/ by data/scripts/prepare_frontend_data.py.
// Cached per zone so each pilot zone's roads/infra are only fetched once.
const geojsonCache = new Map<string, Promise<FeatureCollection>>();

function loadStaticGeoJSON(url: string): Promise<FeatureCollection> {
  if (!geojsonCache.has(url)) {
    geojsonCache.set(
      url,
      fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => {
          useDataHealthStore.getState().reportSuccess(url);
          return data;
        })
        .catch((err) => {
          console.error(`Failed to load ${url}`, err);
          useDataHealthStore.getState().reportFailure(url, err instanceof Error ? err.message : String(err));
          geojsonCache.delete(url); // allow a retry on next call rather than caching the failure forever
          return { type: 'FeatureCollection', features: [] } as FeatureCollection;
        })
    );
  }
  return geojsonCache.get(url)!;
}

export class RealDataAdapter implements FloodDataAdapter {

  private createZonePolygon(zoneId: string, properties: Record<string, unknown>): Feature {
    const zone = PILOT_ZONES[zoneId];
    // Create a rough bbox polygon around the center if bbox not defined
    const d = 0.02; // rough approx for demo
    const [lng, lat] = zone.center;
    const coords = [
      [
        [lng - d, lat - d],
        [lng + d, lat - d],
        [lng + d, lat + d],
        [lng - d, lat + d],
        [lng - d, lat - d]
      ]
    ];

    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: coords },
      properties
    };
  }

  async getRainfallData(zoneId: string, time: TimePoint): Promise<FeatureCollection> {
    const row = await rainfallService.getRowForTime(time.timestamp);
    if (!row) return { type: 'FeatureCollection', features: [] };

    let intensity = 0;
    let accum1h = 0, accum3h = 0;

    if (zoneId === 'kurla_sion') {
      intensity = row.kurla_sion_mean_mm_hr;
      accum1h = row.kurla_sion_accum_1h;
      accum3h = row.kurla_sion_accum_3h;
    } else if (zoneId === 'hindmata_dadar') {
      intensity = row.hindmata_dadar_mean_mm_hr;
      accum1h = row.hindmata_dadar_accum_1h;
      accum3h = row.hindmata_dadar_accum_3h;
    }

    const feature = this.createZonePolygon(zoneId, {
      type: 'rainfall',
      intensity,
      accum1h,
      accum3h,
      provenance: 'OBSERVED'
    });

    return { type: 'FeatureCollection', features: [feature] };
  }

  async getFloodData(_zoneId: string, _time: TimePoint, _scenarioMultiplier = 1.0, _drainageBlockage = 0): Promise<FeatureCollection> {
    // Will be connected to real backend later
    return { type: 'FeatureCollection', features: [] };
  }

  // Real critical-infrastructure locations for a pilot zone: official MCGM
  // ArcGIS layers (hospitals/fire/police/metro/rail) clipped to the zone's
  // bbox, merged with OSM supplemental points (schools, bridges, substations
  // — categories with no confirmed public MCGM layer). Flood-impact status
  // is derived from the simulated flood model, never presented as observed.
  async getInfrastructureData(zoneId: string, time: TimePoint, scenarioMultiplier = 1.0, drainageBlockage = 0): Promise<FeatureCollection> {
    const zone = PILOT_ZONES[zoneId];
    const mcgmLayers = await Promise.all(MCGM_INFRA_LAYERS.map(loadStaticGeoJSON));
    const [osmSupplemental, floodData] = await Promise.all([
      loadStaticGeoJSON(`/data/infrastructure/${zoneId}_osm_supplemental.geojson`),
      mockAdapter.getFloodData(zoneId, time, scenarioMultiplier, drainageBlockage),
    ]);

    const mcgmInZone: Feature[] = zone?.bbox
      ? mcgmLayers.flatMap((fc) => filterByBBox(fc, zone.bbox!).features)
      : [];

    const normalized: Feature[] = [
      ...mcgmInZone.map((f) => ({
        ...f,
        properties: {
          name: f.properties?.Hospital_Name ?? f.properties?.NAME ?? f.properties?.Name ?? 'Unnamed facility',
          amenity: f.properties?.Hospital_Type ? 'hospital' : String(f.properties?.TYPE ?? 'infrastructure').toLowerCase(),
          _source: f.properties?._source,
        },
      })),
      ...osmSupplemental.features.map((f) => ({
        ...f,
        properties: { name: f.properties?.name ?? f.properties?.category, amenity: f.properties?.category, _source: f.properties?._source },
      })),
    ].filter((f) => f.geometry && f.geometry.type === 'Point');

    const features: Feature[] = normalized.map((asset) => {
      const floodZone =
        asset.geometry.type === 'Point'
          ? findContainingFloodZone(asset.geometry.coordinates, floodData.features)
          : null;

      const depthMeters = floodZone?.depthMeters ?? 0;
      const status = depthMeters > 0.5 ? 'CRITICAL' : depthMeters > 0.1 ? 'AT RISK' : 'SAFE';

      return {
        ...asset,
        properties: {
          ...asset.properties,
          type: asset.properties?.amenity,
          osmId: asset.properties?.osmId ?? asset.properties?.osm_id,
          depthMeters: depthMeters.toFixed(2),
          status,
          // Location is real (MCGM official / OpenStreetMap); flood-impact
          // status is derived from the simulated flood-depth model.
          statusProvenance: 'SIMULATED',
        },
      };
    });

    return { type: 'FeatureCollection', features };
  }

  async getRoadsData(zoneId: string, time: TimePoint, scenarioMultiplier = 1.0, drainageBlockage = 0): Promise<FeatureCollection> {
    // Reads the SAME risk-scored file getRoadsRiskData() uses (identical
    // geometry/tags, plus susceptibility_score) rather than a separate,
    // near-duplicate ~1.3-1.5MB roads.geojson — loadStaticGeoJSON's cache is
    // keyed by URL, so requesting the same URL here means only one fetch and
    // one JSON.parse happens no matter how many callers ask for it (perf
    // investigation: this parse was a measurable contributor to the ~8-10s
    // of near-100% main-thread usage on zone entry).
    const [roads, floodData] = await Promise.all([
      loadStaticGeoJSON(`/data/flood_model/${zoneId}_roads_risk.geojson`),
      mockAdapter.getFloodData(zoneId, time, scenarioMultiplier, drainageBlockage),
    ]);

    if (floodData.features.length === 0) {
      // No simulated flooding right now — nothing can be affected.
      return {
        type: 'FeatureCollection',
        features: roads.features.map((f) => ({ ...f, properties: { ...f.properties, affected: false } })),
      };
    }

    const features: Feature[] = roads.features.map((road) => {
      const coords = road.geometry.type === 'LineString' ? road.geometry.coordinates : [];
      const affected = coords.some((c) => findContainingFloodZone(c, floodData.features) !== null);
      return { ...road, properties: { ...road.properties, affected } };
    });

    return { type: 'FeatureCollection', features };
  }

  async getZoneRiskSummary(zoneId: string, time: TimePoint, _scenarioMultiplier = 1.0, _drainageBlockage = 0): Promise<FloodRiskSummary> {
    const row = await rainfallService.getRowForTime(time.timestamp);
    let peak = 0;

    if (row) {
      if (zoneId === 'kurla_sion') peak = row.kurla_sion_max_mm_hr;
      else if (zoneId === 'hindmata_dadar') peak = row.hindmata_dadar_max_mm_hr;
    }

    return { overallRisk: 'LOW', peakRainfallMmHr: peak, maxDepthMeters: 0, rainfallDataAvailable: row !== null };
  }

  // --- City-wide context layers (Mumbai overview) ---

  async getBuildingsData(zoneId: string): Promise<FeatureCollection> {
    return loadStaticGeoJSON(`/data/buildings/${zoneId}_buildings.geojson`);
  }

  async getWaterData(): Promise<FeatureCollection> {
    return loadStaticGeoJSON('/data/water/greater_mumbai_water_waterways.geojson');
  }

  async getBoundaryData(): Promise<FeatureCollection> {
    return loadStaticGeoJSON('/data/boundary/greater_mumbai_admin_boundary.geojson');
  }

  async getCityRoadsData(): Promise<FeatureCollection> {
    return loadStaticGeoJSON('/data/roads/greater_mumbai_major_roads.geojson');
  }

  async getLandcoverInfo(zoneId: string): Promise<{ url: string; bounds: [number, number, number, number] } | null> {
    try {
      const res = await fetch(`/data/landcover/${zoneId}_landcover_bounds.json`);
      const info = await res.json();
      const b = info.bounds_wgs84;
      return { url: `/data/landcover/${info.image}`, bounds: [b.west, b.south, b.east, b.north] };
    } catch (err) {
      console.error(`Failed to load landcover info for ${zoneId}`, err);
      return null;
    }
  }

  // Real Copernicus DEM GLO-30 derivatives (elevation + slope), city-wide.
  async getDemVisualInfo(kind: 'elevation' | 'slope'): Promise<{ url: string; bounds: [number, number, number, number] } | null> {
    try {
      const res = await fetch('/data/dem/mumbai_dem_visual_bounds.json');
      const info = await res.json();
      const b = info.bounds_wgs84;
      const image = kind === 'elevation' ? info.elevation_image : info.slope_image;
      return { url: `/data/dem/${image}`, bounds: [b.west, b.south, b.east, b.north] };
    } catch (err) {
      console.error(`Failed to load DEM visual info (${kind})`, err);
      return null;
    }
  }

  // Real DEM-derived (INFERRED) surface flow network — never the official MCGM network.
  async getInferredDrainageData(): Promise<FeatureCollection> {
    return loadStaticGeoJSON('/data/drainage/mumbai_inferred_surface_flow.geojson');
  }

  // Real road/infrastructure geometry with a real, sampled (MODELLED) susceptibility
  // score attached per feature — see data/scripts/attach_risk_scores.py.
  async getRoadsRiskData(zoneId: string): Promise<FeatureCollection> {
    return loadStaticGeoJSON(`/data/flood_model/${zoneId}_roads_risk.geojson`);
  }

  async getInfrastructureRiskData(zoneId: string): Promise<FeatureCollection> {
    return loadStaticGeoJSON(`/data/flood_model/${zoneId}_infrastructure_risk.geojson`);
  }

  // Coarse click-inspect grids for the raster (image-source) layers — DEM,
  // slope, and susceptibility have no per-pixel query support in MapLibre
  // image sources, so a sampled point grid stands in (see
  // data/scripts/export_raster_query_grid.py). Real GeoTIFF pixel values,
  // never interpolated/invented.
  async getElevationQueryGrid(): Promise<FeatureCollection> {
    return loadStaticGeoJSON('/data/dem/mumbai_elevation_query_grid.geojson');
  }

  async getSlopeQueryGrid(): Promise<FeatureCollection> {
    return loadStaticGeoJSON('/data/dem/mumbai_slope_query_grid.geojson');
  }

  async getSusceptibilityQueryGrid(): Promise<FeatureCollection> {
    return loadStaticGeoJSON('/data/flood_model/mumbai_susceptibility_query_grid.geojson');
  }

  // Real sensitivity sweep over the susceptibility model's equal-weighting
  // assumption — see data/scripts/sensitivity_analysis.py.
  async getSensitivityAnalysis(): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch('/data/flood_model/sensitivity_analysis.json');
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error('Failed to load sensitivity analysis', err);
      return null;
    }
  }

  // DEM+landcover+waterway-derived flood susceptibility index — MODELLED, not observed/validated.
  async getFloodSusceptibilityInfo(): Promise<{ url: string; bounds: [number, number, number, number] } | null> {
    try {
      const res = await fetch('/data/flood_model/flood_susceptibility_metadata.json');
      const info = await res.json();
      const b = info.bounds_wgs84;
      return { url: `/data/flood_model/${info.image}`, bounds: [b.west, b.south, b.east, b.north] };
    } catch (err) {
      console.error('Failed to load flood susceptibility info', err);
      return null;
    }
  }

  // --- Phase 1-4 backend outputs (drainage-graph-based flood propagation) ---

  // One precomputed T+N-minute frame (data/scripts/flood_propagation_engine.py):
  // drainage-graph nodes carrying that timestep's SIMULATED depth. `observed`
  // uses REAL GSMaP rainfall (0mm/hr for the acquired window — genuinely dry);
  // `design_storm` is a SIMULATED scenario storm. Never fabricated client-side —
  // this is the exact static output of the Python engine, fetched as-is.
  async getFloodSimulationFrame(zoneId: string, tMin: FloodTimestepMinutes, scenario: FloodScenario): Promise<FloodSimulationFrame> {
    const file = `${zoneId}_${scenario}_t${String(tMin).padStart(3, '0')}.geojson`;
    return loadStaticGeoJSON(`/data/flood_model/propagation/${file}`) as Promise<FloodSimulationFrame>;
  }

  async getFloodSimulationSummary(zoneId: string, scenario: FloodScenario): Promise<FloodSimulationSummary | null> {
    try {
      const res = await fetch(`/data/flood_model/propagation/${zoneId}_${scenario}_summary.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error(`Failed to load flood simulation summary for ${zoneId}/${scenario}`, err);
      return null;
    }
  }

  // Directed drainage graph (data/scripts/build_drainage_graph.py) — INFERRED
  // flow direction (D8 on a real/DERIVED DEM) + ESTIMATED per-edge/node
  // capacity anchored to MCGM's real published BRIMSTOWAD design intensity.
  // NEVER the official MCGM underground pipe/manhole network.
  async getDrainageGraphNodes(zoneId: string): Promise<DrainageGraphNodesFC> {
    return loadStaticGeoJSON(`/data/drainage/graph/${zoneId}_drainage_graph_nodes.geojson`) as Promise<DrainageGraphNodesFC>;
  }

  async getDrainageGraphEdges(zoneId: string): Promise<DrainageGraphEdgesFC> {
    return loadStaticGeoJSON(`/data/drainage/graph/${zoneId}_drainage_graph_edges.geojson`) as Promise<DrainageGraphEdgesFC>;
  }

  // Terrain-RGB tile manifest (data/scripts/export_terrain_rgb.py) — MapLibre-
  // native raster-dem terrain, DERIVED from the real Copernicus DEM (or, when
  // the full-precision raster is unavailable, re-decoded from the tracked
  // elevation PNG — see dem_source.py; fallback_used flags which happened).
  async getTerrainRgbManifest(zoneId: string): Promise<TerrainRgbManifest | null> {
    try {
      const res = await fetch(`/data/dem/terrain_rgb/${zoneId}/_terrain_rgb_manifest.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error(`Failed to load terrain-RGB manifest for ${zoneId}`, err);
      return null;
    }
  }

  // Phase 4/7 — SIMULATED baseline-vs-drainage-intervention comparison
  // (data/scripts/build_whatif_scenarios.py). A hypothetical scenario
  // comparison for demonstration, never a planned/funded MCGM project.
  async getWhatIfComparison(zoneId: string): Promise<WhatIfComparison | null> {
    try {
      const res = await fetch(`/data/flood_model/whatif/${zoneId}_whatif_comparison.json`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error(`Failed to load what-if comparison for ${zoneId}`, err);
      return null;
    }
  }
}

export const realAdapter = new RealDataAdapter();

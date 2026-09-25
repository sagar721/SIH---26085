import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useZoneStore } from '../../stores/useZoneStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useRoutingStore } from '../../stores/useRoutingStore';
import { useDrainageGraph } from '../../api/hooks/useDrainageGraph';
import { useFloodSimulationFrame } from '../../api/hooks/useFloodSimulationFrame';
import { usePrefetchFloodFrames } from '../../api/hooks/usePrefetchFloodFrames';
import { useWhatIfStore } from '../../stores/useWhatIfStore';
import { realAdapter } from '../../api/adapters/RealDataAdapter';
import { MUMBAI_OVERVIEW } from '../../types';
import { LayerControl } from './LayerControl';
import { MapLegend } from './MapLegend';
import { FullscreenToggle } from './FullscreenToggle';
import { computeRainfallAdjustedRisk, getCriticalityTier, getRoadStatus, ROAD_STATUS_COLOR } from '../../lib/riskModel';
import {
  floodDepthMapLibreStepExpression, rainfallMapLibreStepExpression,
  drainageNodeStatus, DRAINAGE_STATUS_COLOR, INFRA_STATUS_COLOR,
} from '../../lib/colorRamps';
import { useSimulationStore } from '../../stores/useSimulationStore';
import type { Feature, FeatureCollection } from 'geojson';

// Visual (not physical) exaggeration for the 3D flood-depth
// pillars: real simulated depths are 0-1.5m, which would be a few pixels
// tall next to buildings (6m+) and 1.5x-exaggerated terrain. 25x makes a
// 0.3m flood read as a ~7.5m pillar — clearly a stylized visualization aid,
// documented here and in the click popup (which always shows the true depth).
const FLOOD_EXTRUSION_EXAGGERATION = 25;
// Half-width (degrees) of each flood-depth pillar's footprint — small enough
// not to overlap neighboring drainage-graph nodes (~37m spacing, see
// data/scripts/build_drainage_graph.py GRID_SIZE), purely a rendering choice.
const FLOOD_EXTRUSION_HALF_WIDTH_DEG = 0.00008;

function buildFloodExtrusionFeatures(frame: FeatureCollection | null): FeatureCollection {
  if (!frame) return { type: 'FeatureCollection', features: [] };
  const d = FLOOD_EXTRUSION_HALF_WIDTH_DEG;
  return {
    type: 'FeatureCollection',
    features: frame.features
      .filter((f) => f.geometry.type === 'Point' && typeof f.properties?.depth_m === 'number' && f.properties.depth_m > 0)
      .map((f) => {
        const [lng, lat] = (f.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
        return {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
          },
          properties: f.properties,
        } as Feature;
      }),
  };
}

// Satellite/hybrid basemap — replaces the flat CartoDB Positron style
// (previously chosen deliberately for a "trusted instrument" look — see
// FLOODCAST_V3_DESIGN_SPEC.md §4.5/§8 — superseded by an explicit request
// for a Google Earth-style tilted 3D satellite view). Esri World Imagery is
// a public, keyless raster tile service (no API key exists or is needed —
// this project has no Mapbox/Maptiler/Google Maps Platform credential
// configured anywhere in .env.example), commonly used in open-source
// MapLibre/Leaflet apps under Esri's terms with attribution. A second
// keyless Esri layer (place/road labels) sits on top for a "hybrid" read,
// the same combination Google Earth uses (imagery + labels). No Cesium, no
// Google Maps tiles (which require the Google Maps Platform SDK/ToS this
// project doesn't have).
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri, Maxar, Earthstar Geographics, GIS User Community',
    },
    'esri-labels': {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Esri',
    },
  },
  layers: [
    { id: 'satellite-base', type: 'raster', source: 'esri-satellite' },
    { id: 'satellite-labels', type: 'raster', source: 'esri-labels', paint: { 'raster-opacity': 0.85 } },
  ],
};

interface GridPoint { lng: number; lat: number; value: number }

function nearestGridPoint(grid: GridPoint[], lng: number, lat: number, maxDeltaDeg = 0.02): GridPoint | null {
  let best: GridPoint | null = null;
  let bestDist = Infinity;
  for (const p of grid) {
    const d = (p.lng - lng) ** 2 + (p.lat - lat) ** 2;
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best && bestDist <= maxDeltaDeg ** 2 ? best : null;
}

function toGridPoints(fc: FeatureCollection | null, valueKey: string): GridPoint[] {
  if (!fc) return [];
  return fc.features
    .filter((f) => f.geometry.type === 'Point' && typeof f.properties?.[valueKey] === 'number')
    .map((f) => {
      const [lng, lat] = (f.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
      return { lng, lat, value: f.properties![valueKey] as number };
    });
}

// Maps a layer-store id to the actual MapLibre layer id(s) it controls.
const LAYER_TO_MAPLIBRE: Record<string, string[]> = {
  boundary: ['boundary-line'],
  cityRoads: ['city-roads-line'],
  roads: ['roads-line', 'roads-line-casing'],
  // 'buildings' is intentionally NOT mapped here — its own viewMode-aware
  // effect below controls buildings-fill vs. buildings-extrusion visibility
  // (flat in overview, extruded in zone view) so the two effects can't race.
  water: ['water-fill', 'water-line'],
  landcover: ['landcover-raster'],
  infrastructure: ['infra-point'],
  rainfall: ['rainfall-fill'],
  dem: ['dem-raster'],
  slope: ['slope-raster'],
  inferredFlow: ['inferred-drainage-line'],
  flood: ['flood-fill'],
  floodSusceptibility: ['flood-susceptibility-fill'],
  drainageGraph: ['drainage-graph-edges-line', 'drainage-graph-nodes-circle'],
  // 'buildings-extrusion', 'flood-simulation-extrusion' and 3D terrain are
  // intentionally NOT listed here — 'floodSimulation' isn't either, since all
  // are also gated by viewMode/3D-mode, handled in their own effects below
  // (same reasoning as the buildings-fill/buildings-extrusion split).
};

// Memoized: MapContainer takes no props and must not re-render just because
// an unrelated sibling (e.g. a modal) changed state in a shared store —
// confirmed by profiling that such a cascade was blocking the main thread
// for 200ms-1.5s per frame during a modal close (disaster-readiness audit
// item 2.4). It still re-renders normally when ITS OWN subscribed state
// (zone, layers, risk data) actually changes.
export const MapContainer: React.FC = React.memo(() => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const activeZone = useZoneStore((state) => state.activeZone);
  const viewMode = useUIStore((state) => state.viewMode);
  const { rainfallFeatures, floodFeatures, infraFeatures, roadsFeatures } = useFloodData();
  const { roadsRisk, infraRisk, effectiveRainfallMmHr, scenarioActive } = useRainfallAwareRisk();
  const { origin: routeOrigin, destination: routeDestination, routes: computedRoutes, normalRouteComparison, activeMode: routeMode, externalRoute } = useRoutingStore();
  const layerVisibility = useLayerStore((state) => state.visibility);
  // Precomputed drainage-graph flood-propagation frames and the directed
  // drainage graph itself. Independent of the pre-existing Scenario Mode
  // sliders / MockAdapter flood-extent layer above, which are untouched.
  const { nodes: drainageNodesFeatures, edges: drainageEdgesFeatures } = useDrainageGraph();
  const { frame: floodSimFrame, tMin: floodSimTMin, scenario: floodSimScenario } = useFloodSimulationFrame();
  // Performance fix — see usePrefetchFloodFrames.ts: warms the cache for all
  // 7 timesteps as soon as this zone is entered, so Play never blocks on a
  // network fetch mid-animation.
  usePrefetchFloodFrames(activeZone.id, 'design_storm');
  // What-If: baseline/intervention frames are only fetched once the
  // user actually opens the What-If panel and picks a map view (`enabled`
  // below), never unconditionally on every load.
  const whatIfView = useWhatIfStore((s) => s.view);
  const whatIfFetchEnabled = whatIfView !== 'off';
  const { frame: whatIfBaselineFrame } = useFloodSimulationFrame('whatif_baseline', whatIfFetchEnabled);
  const { frame: whatIfInterventionFrame } = useFloodSimulationFrame('whatif_intervention', whatIfFetchEnabled);

  // Which flood-simulation FeatureCollection actually drives the map's flood
  // layer right now — the normal simulation frame, or one of the What-If
  // panel's baseline/intervention/difference views.
  const activeFloodSimFrame = React.useMemo(() => {
    if (whatIfView === 'off') return floodSimFrame;
    if (whatIfView === 'baseline') return whatIfBaselineFrame;
    if (whatIfView === 'intervention') return whatIfInterventionFrame;
    // 'difference': same node geometry, depth_m replaced by how much depth the
    // intervention removes at that node (baseline - intervention, >= 0 since
    // intervention only ever increases capacity) — reuses the same flood-depth
    // color ramp/legend to show "how much flooding this hypothetical fixes".
    if (!whatIfBaselineFrame || !whatIfInterventionFrame) return null;
    const byNode = new Map(whatIfInterventionFrame.features.map((f) => [f.properties.node_id, f.properties.depth_m]));
    return {
      type: 'FeatureCollection' as const,
      features: whatIfBaselineFrame.features.map((f) => {
        const interventionDepth = byNode.get(f.properties.node_id) ?? 0;
        const reduced = Math.max(0, f.properties.depth_m - interventionDepth);
        return { ...f, properties: { ...f.properties, depth_m: reduced } };
      }),
    };
  }, [whatIfView, floodSimFrame, whatIfBaselineFrame, whatIfInterventionFrame]);
  // Same flood data, reshaped into small polygons for the 3D
  // fill-extrusion pillars (MapLibre circle layers can't be extruded).
  const floodExtrusionFeatures = React.useMemo(
    () => buildFloodExtrusionFeatures(activeFloodSimFrame as unknown as FeatureCollection | null),
    [activeFloodSimFrame]
  );
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [buildingsFeatures, setBuildingsFeatures] = useState<FeatureCollection | null>(null);
  const [waterFeatures, setWaterFeatures] = useState<FeatureCollection | null>(null);
  const [boundaryFeatures, setBoundaryFeatures] = useState<FeatureCollection | null>(null);
  const [cityRoadsFeatures, setCityRoadsFeatures] = useState<FeatureCollection | null>(null);
  const [inferredDrainageFeatures, setInferredDrainageFeatures] = useState<FeatureCollection | null>(null);
  const [elevationGrid, setElevationGrid] = useState<GridPoint[]>([]);
  const [slopeGrid, setSlopeGrid] = useState<GridPoint[]>([]);
  const [susceptibilityGrid, setSusceptibilityGrid] = useState<GridPoint[]>([]);
  const effectiveRainfallRef = useRef(effectiveRainfallMmHr);
  effectiveRainfallRef.current = effectiveRainfallMmHr;
  const scenarioActiveRef = useRef(scenarioActive);
  scenarioActiveRef.current = scenarioActive;
  const whatIfViewRef = useRef(whatIfView);
  whatIfViewRef.current = whatIfView;
  const elevationGridRef = useRef<GridPoint[]>([]);
  elevationGridRef.current = elevationGrid;
  const slopeGridRef = useRef<GridPoint[]>([]);
  slopeGridRef.current = slopeGrid;
  const susceptibilityGridRef = useRef<GridPoint[]>([]);
  susceptibilityGridRef.current = susceptibilityGrid;
  const computedRoutesRef = useRef(computedRoutes);
  computedRoutesRef.current = computedRoutes;
  const simulationMode = useSimulationStore((s) => s.mode);
  const demoModeRef = useRef(simulationMode === 'demo');
  demoModeRef.current = simulationMode === 'demo';

  // Infra carrying real susceptibility_score, joined onto the real-geometry
  // infra collection already used for map rendering — joins on rounded
  // coordinates (MCGM assets have no shared id field across the two
  // pipelines, but identical geometry). Roads no longer need this merge:
  // getRoadsData() and getRoadsRiskData() now read the same underlying
  // risk-scored file, so roadsFeatures already carries susceptibility_score
  // (perf investigation: this eliminated a duplicate ~1.4MB fetch/parse and
  // a per-render join over 3000+ features).
  const infraWithRisk = React.useMemo<FeatureCollection | null>(() => {
    if (!infraFeatures) return null;
    const key = (lng: number, lat: number) => `${lng.toFixed(6)},${lat.toFixed(6)}`;
    const byCoord = new Map<string, { score: number; amenity?: string }>();
    (infraRisk?.features ?? []).forEach((f) => {
      if (f.geometry.type !== 'Point') return;
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const score = f.properties?.susceptibility_score;
      if (typeof score === 'number') byCoord.set(key(lng, lat), { score, amenity: f.properties?.amenity as string | undefined });
    });
    return {
      type: 'FeatureCollection',
      features: infraFeatures.features.map((f) => {
        if (f.geometry.type !== 'Point') return f;
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const match = byCoord.get(key(lng, lat));
        return !match ? f : { ...f, properties: { ...f.properties, susceptibility_score: match.score } };
      }),
    };
  }, [infraFeatures, infraRisk]);

  // `roadsFeatures` (from useFloodData) already carries `affected`/
  // `simulatedFloodDepthM`/`floodSeverity` grounded in the REAL precomputed
  // flood-simulation frame (see enrichRoadsWithSimulatedDepth in
  // useFloodData.ts — same source routing uses). This memo only adds
  // the categorical NORMAL/WATCH/FLOODED/HIGH RISK label on top, combining
  // that simulated depth with the existing continuous susceptibility/rainfall
  // risk score (unchanged, still used in the click popup below).
  const roadsWithStatus = React.useMemo<FeatureCollection | null>(() => {
    if (!roadsFeatures) return null;
    return {
      type: 'FeatureCollection',
      features: roadsFeatures.features.map((f) => {
        const susceptibility = f.properties?.susceptibility_score;
        const adjusted = typeof susceptibility === 'number' ? computeRainfallAdjustedRisk(susceptibility, effectiveRainfallMmHr) : 0;
        const status = getRoadStatus(adjusted, Boolean(f.properties?.affected));
        return { ...f, properties: { ...f.properties, roadStatus: status } };
      }),
    };
  }, [roadsFeatures, effectiveRainfallMmHr]);

  // Drainage-graph nodes (static ESTIMATED capacity) augmented with
  // the CURRENT timestep's inflow/surcharge from the precomputed flood-
  // simulation frame — same node ids, so a coordinate-keyed join
  // (both come from the same build_drainage_graph.py output).
  const drainageNodesWithStatus = React.useMemo<FeatureCollection | null>(() => {
    if (!drainageNodesFeatures) return null;
    const byNodeId = new Map<number, { inflow_m3s: number; capacity_m3s: number; surcharge_m3s: number }>();
    (floodSimFrame?.features ?? []).forEach((f) => {
      byNodeId.set(f.properties.node_id, f.properties);
    });
    return {
      type: 'FeatureCollection',
      features: drainageNodesFeatures.features.map((f) => {
        const live = byNodeId.get(f.properties.node_id);
        const status = live
          ? drainageNodeStatus(live.inflow_m3s, live.capacity_m3s)
          : drainageNodeStatus(0, f.properties.capacity_m3s);
        return { ...f, properties: { ...f.properties, status, live_inflow_m3s: live?.inflow_m3s ?? 0, live_surcharge_m3s: live?.surcharge_m3s ?? 0 } };
      }),
    } as unknown as FeatureCollection;
  }, [drainageNodesFeatures, floodSimFrame]);

  useEffect(() => {
    if (map.current) return;

    if (mapContainer.current) {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: SATELLITE_STYLE,
        center: MUMBAI_OVERVIEW.center,
        zoom: MUMBAI_OVERVIEW.zoom,
        pitch: 0,
        maxPitch: 75, // Google Earth-style steep tilt when orbiting a pilot zone
        // Render throttling (perf investigation): skip the ~300ms label/layer
        // crossfade MapLibre normally runs on every style/data change — a
        // continuous rAF-driven animation that adds to steady-state idle
        // cost for no visual benefit in a data-dashboard context.
        fadeDuration: 0,
        // Don't keep re-requesting tiles for freshness — this is a fixed
        // historical dataset (see the Snapshot badge), never live, so there
        // is nothing to refresh.
        refreshExpiredTiles: false,
      });

      // visualizePitch: true adds the tilt indicator alongside the compass,
      // matching Google Earth's orbit control affordance. Drag-to-rotate and
      // two-finger tilt are MapLibre defaults (dragRotate/touchPitch), not
      // something that needs enabling separately.
      map.current.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      // Disaster-readiness audit item 2.3: if the basemap CDN (or the style
      // JSON itself) is unreachable, MapLibre fires 'error' repeatedly and
      // silently renders a blank canvas — surface it honestly instead. Only
      // flagged before the style finishes loading; per-tile errors after
      // that are normal (a missing tile at the edge of a zone) and not a
      // basemap outage.
      let loaded = false;
      map.current.on('error', (e) => {
        if (!loaded) {
          console.error('[MapContainer] MapLibre error before style load', e.error);
          setMapError(e.error?.message ?? 'Map failed to load');
        }
      });

      map.current.on('load', () => {
        loaded = true;
        const m = map.current!;
        const emptyFC: FeatureCollection = { type: 'FeatureCollection', features: [] };

        // Greater Mumbai administrative boundary (REAL — OSM district relations)
        m.addSource('boundary-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'boundary-line', type: 'line', source: 'boundary-source',
          paint: { 'line-color': '#5B6472', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.7 },
        });

        // Water bodies & nallas, city-wide (REAL — OSM waterway/natural=water)
        m.addSource('water-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'water-fill', type: 'fill', source: 'water-source',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#7FA0C4', 'fill-opacity': 0.55 },
        });
        m.addLayer({
          id: 'water-line', type: 'line', source: 'water-source',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': '#3F5D8C', 'line-width': 1.5, 'line-opacity': 0.75 },
        });

        // City-context major roads (REAL — OSM, motorway..secondary). Bright
        // cyan + a touch more width/opacity than the old flat-basemap styling
        // needed — over satellite imagery a muted grey line all but disappears.
        m.addSource('city-roads-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'city-roads-line', type: 'line', source: 'city-roads-source',
          paint: { 'line-color': '#FFD54A', 'line-width': 1.4, 'line-opacity': 0.85 },
        });

        // Building footprints, per pilot zone (REAL — OSM). Flat fill for the
        // lightweight city/overview context; a separate fill-extrusion layer
        // (added below, MapLibre-native — no Cesium) renders the same source
        // in 3D, shown only in pilot-zone view (see the viewMode effect).
        m.addSource('buildings-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'buildings-fill', type: 'fill', source: 'buildings-source',
          paint: { 'fill-color': '#B9AE8D', 'fill-opacity': 0.4, 'fill-outline-color': '#9C9377' },
        });
        // height_m: REAL (OSM height tag) or DERIVED (OSM building:levels x 3m,
        // height_estimated=true — see data/scripts/download_osm.py). Buildings
        // with neither tag (the majority in these zones) get a flat, clearly
        // non-official default (6m, ~2 storeys) purely for a legible 3D
        // silhouette — never presented as a measured or municipal height (see
        // the buildings click popup).
        m.addLayer({
          id: 'buildings-extrusion', type: 'fill-extrusion', source: 'buildings-source',
          layout: { visibility: 'none' },
          paint: {
            // Neutral light grey (not the basemap-matched tan used for the flat
            // fill) — over satellite imagery a generic light building mass
            // reads clearly, the same convention Google Earth/OSM Buildings
            // use for non-photorealistic 3D buildings.
            'fill-extrusion-color': '#E8E4D8',
            // to-number's fallback (6) covers missing, null, and non-numeric height_m alike.
            'fill-extrusion-height': ['to-number', ['get', 'height_m'], 6],
            'fill-extrusion-opacity': 0.8,
          },
        });

        // Pilot-zone detailed road network (REAL — OSM, full attributes). Performance
        // fix: road GEOMETRY (3200+ LineString features) is set into this source only
        // ONCE per zone (see the roadsRisk effect below) — the per-timestep flood
        // status (roadStatus/affected/simulatedFloodDepthM) is applied via MapLibre
        // feature-state (setFeatureState), not by re-sending the whole FeatureCollection
        // through setData() on every T+0..180 tick. setData() forces a full
        // re-tessellation of every road; feature-state is an O(1)-per-feature paint
        // update. This was the dominant cost behind the ~4.8fps measured during
        // T+0->T+180 playback. promoteId lets MapLibre key each
        // feature's state by its real OSM id instead of requiring a synthetic one.
        m.addSource('roads-source', { type: 'geojson', data: emptyFC, promoteId: 'osm_id' });
        // White casing under the road line — over satellite imagery a plain
        // grey "NORMAL" road line has very little contrast against real
        // paved surfaces in the photo; a casing (the same technique already
        // used for route-line-outline below) fixes that for every status color.
        m.addLayer({
          id: 'roads-line-casing', type: 'line', source: 'roads-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': ['case', ['coalesce', ['feature-state', 'affected'], false], 5,
              ['match', ['get', 'highway'],
                'motorway', 4.5, 'trunk', 4.5, 'primary', 4,
                'secondary', 3.5, 'tertiary', 3.2, 3
              ]
            ],
            'line-opacity': 0.55,
          },
        });
        m.addLayer({
          id: 'roads-line', type: 'line', source: 'roads-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['match', ['coalesce', ['feature-state', 'roadStatus'], 'NORMAL'],
              'HIGH RISK', ROAD_STATUS_COLOR['HIGH RISK'],
              'FLOODED', ROAD_STATUS_COLOR['FLOODED'],
              'WATCH', ROAD_STATUS_COLOR['WATCH'],
              ROAD_STATUS_COLOR['NORMAL'],
            ],
            'line-width': ['case', ['coalesce', ['feature-state', 'affected'], false], 3,
              ['match', ['get', 'highway'],
                'motorway', 2.5, 'trunk', 2.5, 'primary', 2,
                'secondary', 1.5, 'tertiary', 1.2, 1
              ]
            ],
            'line-opacity': ['case', ['coalesce', ['feature-state', 'affected'], false], 0.9, 0.65]
          }
        });

        // Inferred surface drainage (INFERRED — real Copernicus DEM, D8 flow accumulation;
        // NEVER the official MCGM underground network — see Data Provenance)
        m.addSource('inferred-drainage-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'inferred-drainage-line', type: 'line', source: 'inferred-drainage-source',
          paint: {
            'line-color': '#5B4E86',
            'line-width': ['interpolate', ['linear'], ['get', 'flow_accumulation_cells'], 50, 0.5, 1600, 3],
            'line-opacity': 0.55,
          },
        });

        // Rainfall Layer (REAL — GSMaP; Step 5G: stepped 0-10/10-25/25-50/50-100/100+ mm/h
        // color bins instead of a plain opacity ramp, via lib/colorRamps.ts)
        m.addSource('rainfall-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'rainfall-fill', type: 'fill', source: 'rainfall-source',
          paint: {
            'fill-color': rainfallMapLibreStepExpression('intensity') as maplibregl.ExpressionSpecification,
            'fill-opacity': ['interpolate', ['linear'], ['get', 'intensity'], 0, 0, 10, 0.35, 100, 0.6]
          }
        });

        // Flood Layer (SIMULATED — existing Scenario-Mode-driven extent, unchanged)
        m.addSource('flood-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'flood-fill', type: 'fill', source: 'flood-source',
          paint: {
            'fill-color': [
              'match', ['get', 'riskLevel'],
              'SEVERE', '#B4392C', 'HIGH', '#B9762E', 'MODERATE', '#C9A227', '#3F5D8C'
            ],
            'fill-opacity': 0.45
          }
        });

        // Flood Simulation Layer (precomputed, drainage-graph-based; SIMULATED) —
        // T+0..180min depth at each drainage-graph node, ironbow-style depth color ramp
        // (see lib/colorRamps.ts). Independent of, and rendered above, the Scenario-Mode
        // flood-fill layer above.
        m.addSource('flood-simulation-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'flood-simulation-circle', type: 'circle', source: 'flood-simulation-source',
          filter: ['>', ['coalesce', ['get', 'depth_m'], 0], 0],
          paint: {
            'circle-color': floodDepthMapLibreStepExpression('depth_m') as maplibregl.ExpressionSpecification,
            'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'depth_m'], 0], 0, 4, 0.15, 7, 0.5, 11, 1.5, 17],
            'circle-opacity': 0.92,
            // Wider, more opaque white halo — needed for the flood layer to
            // stay legible over busy satellite imagery (was tuned for the
            // flat Positron basemap, where markers already had strong contrast).
            'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': 0.9,
          },
        });

        // Genuine 3D flood-depth visualization: small extruded
        // pillars (fill-extrusion) at each flooded node, height proportional
        // to SIMULATED depth with a documented visual exaggeration (actual
        // flood depths are cm-scale and would be imperceptible against city-
        // scale terrain/buildings otherwise — see FLOOD_EXTRUSION_EXAGGERATION
        // and the click popup, which always states the true, non-exaggerated
        // depth). Only shown in 3D pilot-zone view (see the 3D-mode effect
        // below); the flat circle layer above remains the 2D representation.
        m.addSource('flood-simulation-extrusion-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'flood-simulation-extrusion', type: 'fill-extrusion', source: 'flood-simulation-extrusion-source',
          layout: { visibility: 'none' },
          paint: {
            'fill-extrusion-color': floodDepthMapLibreStepExpression('depth_m') as maplibregl.ExpressionSpecification,
            'fill-extrusion-height': ['*', ['coalesce', ['get', 'depth_m'], 0], FLOOD_EXTRUSION_EXAGGERATION],
            'fill-extrusion-opacity': 0.85,
          },
        });

        // Drainage graph (INFERRED flow direction / ESTIMATED capacity;
        // NEVER the official MCGM underground network — see click popups below).
        m.addSource('drainage-graph-edges-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'drainage-graph-edges-line', type: 'line', source: 'drainage-graph-edges-source',
          layout: { visibility: 'none' },
          paint: {
            'line-color': '#5B4E86',
            'line-width': ['interpolate', ['linear'], ['coalesce', ['get', 'capacity_m3s'], 0], 0, 0.5, 1, 2.5],
            'line-opacity': 0.55,
          },
        });
        m.addSource('drainage-graph-nodes-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'drainage-graph-nodes-circle', type: 'circle', source: 'drainage-graph-nodes-source',
          layout: { visibility: 'none' },
          paint: {
            'circle-color': ['match', ['get', 'status'],
              'surcharge', DRAINAGE_STATUS_COLOR.surcharge,
              'approaching_capacity', DRAINAGE_STATUS_COLOR.approaching_capacity,
              DRAINAGE_STATUS_COLOR.normal,
            ],
            'circle-radius': ['match', ['get', 'status'], 'surcharge', 5, 'approaching_capacity', 4, 3],
            'circle-stroke-width': 1, 'circle-stroke-color': '#ffffff',
          },
        });

        // Normal (flood-blind) comparison route — "NORMAL ROUTE vs
        // FLOOD-AWARE SAFE ROUTE". Dashed, drawn beneath the flood-aware
        // route below, so the two are visually distinguishable wherever they diverge.
        m.addSource('route-normal-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'route-normal-line', type: 'line', source: 'route-normal-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#6B7280', 'line-width': 3.5, 'line-opacity': 0.75, 'line-dasharray': [1, 1.5] },
        });

        // Flood-aware safe route (currently active mode: fastest/safest/balanced).
        // Line geometry follows the real road network; color reflects the
        // selected mode. MODELLED — the risk weighting behind the route
        // choice, never an observed/validated path.
        m.addSource('route-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'route-line', type: 'line', source: 'route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['match', ['get', 'mode'], 'safest', '#3D7A5C', 'balanced', '#B9762E', '#1F2A44'],
            'line-width': 5, 'line-opacity': 0.9,
          },
        });
        m.addLayer({
          id: 'route-line-outline', type: 'line', source: 'route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 },
        }, 'route-line');

        // External routing fallback (Priority 3, lib/externalRouting.ts) —
        // only rendered when the local flood-aware graph couldn't connect
        // the pair at all. Dashed amber, visually distinct from both the
        // grey normal route and the blue/green flood-aware route, since this
        // one carries NO flood-awareness at all.
        m.addSource('route-external-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'route-external-line', type: 'line', source: 'route-external-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#C9A227', 'line-width': 4, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] },
        });

        // Origin/destination markers for the active route.
        m.addSource('route-endpoints-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'route-endpoints', type: 'circle', source: 'route-endpoints-source',
          paint: {
            'circle-color': ['match', ['get', 'role'], 'origin', '#3D7A5C', '#B4392C'],
            'circle-radius': 8, 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ffffff',
          },
        });

        // Critical infrastructure (REAL — MCGM official + OSM; status SIMULATED)
        m.addSource('infra-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'infra-point', type: 'circle', source: 'infra-source',
          paint: {
            'circle-color': ['match', ['get', 'status'], 'CRITICAL', INFRA_STATUS_COLOR.CRITICAL, 'AT RISK', INFRA_STATUS_COLOR['AT RISK'], INFRA_STATUS_COLOR.SAFE],
            'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff'
          }
        });

        m.on('click', 'infra-point', (e) => {
          const feature = e.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;
          const p = feature.properties as Record<string, unknown>;
          const { name, type, status, depthMeters, _source } = p as Record<string, string>;
          const susceptibility = typeof p.susceptibility_score === 'number' ? p.susceptibility_score : null;
          const impact = susceptibility !== null ? computeRainfallAdjustedRisk(susceptibility, effectiveRainfallRef.current) : null;
          const tier = getCriticalityTier(type);
          const classificationReason = status === 'CRITICAL'
            ? `CRITICAL — simulated depth (${depthMeters}m) exceeds the 0.5m threshold`
            : status === 'AT RISK'
              ? `AT RISK — simulated depth (${depthMeters}m) exceeds 0.1m but is below the 0.5m CRITICAL threshold`
              : `SAFE — simulated depth (${depthMeters}m) is at or below the 0.1m threshold`;
          popup.current?.remove();
          popup.current = new maplibregl.Popup({ closeButton: true, offset: 12 })
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setHTML(
              `<div style="font: 12px sans-serif; color: #111; max-width:230px">
                <strong>${name}</strong><br/>
                ${type} &middot; criticality: ${tier.replace('_', ' ')}<br/>
                Classification: <strong>${classificationReason}</strong><br/>
                ${susceptibility !== null ? `Susceptibility: ${susceptibility.toFixed(2)} &middot; Exposure (now, weighted): ${impact!.toFixed(2)}<br/>` : ''}
                Rainfall: ${effectiveRainfallRef.current.toFixed(1)} mm/h${scenarioActiveRef.current ? ' (SIMULATED scenario)' : ''}<br/>
                <span style="color:#666; font-size:10px">Location: ${_source ?? 'OpenStreetMap'} &middot; Susceptibility: MODELLED &middot; Flood depth: SIMULATED</span>
              </div>`
            )
            .addTo(m);
        });
        m.on('mouseenter', 'infra-point', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'infra-point', () => { m.getCanvas().style.cursor = ''; });

        const showInspectPopup = (lngLat: maplibregl.LngLat, html: string) => {
          popup.current?.remove();
          popup.current = new maplibregl.Popup({ closeButton: true, offset: 8 })
            .setLngLat(lngLat)
            .setHTML(html)
            .addTo(m);
        };

        // Roads — REAL OSM geometry with a real, DEM-sampled susceptibility
        // score and a live rainfall-adjusted impact score (MODELLED).
        m.on('click', 'roads-line', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          // roadStatus/affected/simulatedFloodDepthM live in feature-state now
          // (performance fix above), not in properties — read from f.state.
          const s = (f.state ?? {}) as Record<string, unknown>;
          const susceptibility = typeof p.susceptibility_score === 'number' ? p.susceptibility_score : null;
          const impact = susceptibility !== null ? computeRainfallAdjustedRisk(susceptibility, effectiveRainfallRef.current) : null;
          const depthM = typeof s.simulatedFloodDepthM === 'number' ? s.simulatedFloodDepthM : 0;
          const roadStatus = (s.roadStatus as string) ?? 'NORMAL';
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.name || 'Unnamed road'}</strong><br/>
              ${p.highway ?? 'road'} &middot; <span style="color:${ROAD_STATUS_COLOR[roadStatus as keyof typeof ROAD_STATUS_COLOR] ?? '#8B8F7F'}">${roadStatus}</span><br/>
              Simulated flood depth (nearest drainage node): ${depthM.toFixed(2)}m<br/>
              ${susceptibility !== null ? `Susceptibility: ${susceptibility.toFixed(2)} &middot; Impact (now): ${impact!.toFixed(2)}<br/>` : ''}
              Rainfall: ${effectiveRainfallRef.current.toFixed(1)} mm/h${scenarioActiveRef.current ? ' (SIMULATED scenario)' : ''}<br/>
              <span style="color:#666; font-size:10px">Geometry: REAL (OSM) &middot; Susceptibility: MODELLED &middot; Flood depth: SIMULATED (drainage-graph propagation engine)</span>
            </div>`);
        });
        m.on('mouseenter', 'roads-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'roads-line', () => { m.getCanvas().style.cursor = ''; });

        // Buildings — REAL OSM footprints. Shared between the flat overview
        // layer (buildings-fill) and the 3D extruded layer (buildings-extrusion,
        // shown instead of buildings-fill whenever a pilot zone is open) — both
        // read the same 'buildings-source', so one handler covers both.
        // Previously only buildings-fill had a click handler: clicking a
        // building in the primary 3D pilot-zone view (the layer actually shown
        // there) silently did nothing — found during the Demo Mode audit.
        const handleBuildingsClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          const hasHeight = p.height_m !== null && p.height_m !== undefined;
          const heightNote = hasHeight
            ? (p.height_estimated ? `Height: ${p.height_m}m (DERIVED — OSM levels &times; 3m)` : `Height: ${p.height_m}m (REAL — OSM height tag)`)
            : 'Height: no OSM tag — 3D view uses a flat 6m default for legibility, NOT an official/measured height';
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.name || p.building || 'Building'}</strong><br/>
              ${p['building:levels'] ? `${p['building:levels']} levels` : ''}<br/>
              ${heightNote}<br/>
              <span style="color:#666; font-size:10px">Provenance: footprint REAL (OSM)</span>
            </div>`);
        };
        m.on('click', 'buildings-fill', handleBuildingsClick);
        m.on('click', 'buildings-extrusion', handleBuildingsClick);
        m.on('mouseenter', 'buildings-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'buildings-fill', () => { m.getCanvas().style.cursor = ''; });
        m.on('mouseenter', 'buildings-extrusion', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'buildings-extrusion', () => { m.getCanvas().style.cursor = ''; });

        // Inferred surface drainage — DEM-derived flow accumulation (INFERRED, never official)
        m.on('click', 'inferred-drainage-line', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>Inferred surface flowpath</strong><br/>
              Flow accumulation: ${p.flow_accumulation_cells ?? 'n/a'} contributing cells<br/>
              <span style="color:#666; font-size:10px">Provenance: INFERRED (Copernicus DEM D8 flow) &middot; never the official MCGM pipe network</span>
            </div>`);
        });
        m.on('mouseenter', 'inferred-drainage-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'inferred-drainage-line', () => { m.getCanvas().style.cursor = ''; });

        // Flood simulation nodes — SIMULATED depth at this timestep, from the
        // precomputed drainage-graph propagation engine.
        const SCENARIO_LABELS: Record<string, string> = {
          observed: 'OBSERVED (real, dry)',
          design_storm: 'SIMULATED design storm',
          whatif_baseline: 'What-if BASELINE (0.7x drainage capacity, SIMULATED)',
          whatif_intervention: 'What-if INTERVENTION (1.3x drainage capacity, SIMULATED)',
        };
        const floodSimClickHandler = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          const scenarioKey = String(p.rainfall_scenario ?? '');
          const is3DPillar = f.layer.id === 'flood-simulation-extrusion';
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:240px">
              <strong>${whatIfViewRef.current === 'difference' ? 'Depth reduced by intervention' : 'Simulated flood depth'}</strong><br/>
              ${Number(p.depth_m).toFixed(2)}m (${p.depth_category}) at T+${p.t_min}min<br/>
              ${is3DPillar ? `<span style="color:#666; font-size:10px">3D pillar height is exaggerated &times;${FLOOD_EXTRUSION_EXAGGERATION} for visibility — the depth above is the true simulated value.</span><br/>` : ''}
              Scenario: ${SCENARIO_LABELS[scenarioKey] ?? scenarioKey}<br/>
              Inflow ${Number(p.inflow_m3s).toFixed(3)} m&sup3;/s vs. capacity ${Number(p.capacity_m3s).toFixed(3)} m&sup3;/s<br/>
              <span style="color:#666; font-size:10px">Provenance: SIMULATED (lightweight drainage-graph cascade, not a 2D hydrodynamic solver) &middot; never official MCGM flood data</span>
            </div>`);
        };
        m.on('click', 'flood-simulation-circle', floodSimClickHandler);
        m.on('click', 'flood-simulation-extrusion', floodSimClickHandler);
        m.on('mouseenter', 'flood-simulation-circle', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'flood-simulation-circle', () => { m.getCanvas().style.cursor = ''; });
        m.on('mouseenter', 'flood-simulation-extrusion', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'flood-simulation-extrusion', () => { m.getCanvas().style.cursor = ''; });

        // Drainage graph nodes/edges — INFERRED flow direction (D8 on a real/DERIVED
        // DEM) + ESTIMATED capacity, never the official MCGM network.
        m.on('click', 'drainage-graph-nodes-circle', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:240px">
              <strong>Drainage graph node #${p.node_id}</strong> &middot; ${p.role}<br/>
              Status: ${p.status}<br/>
              Elevation: ${Number(p.elevation_m).toFixed(1)}m &middot; Capacity: ${Number(p.capacity_m3s).toFixed(3)} m&sup3;/s<br/>
              <span style="color:#666; font-size:10px">Provenance: node position/flow INFERRED (D8 on real/DERIVED DEM) &middot; capacity ESTIMATED (anchored to MCGM's real 50mm/hr BRIMSTOWAD design intensity) &middot; NOT the official MCGM underground network</span>
            </div>`);
        });
        m.on('mouseenter', 'drainage-graph-nodes-circle', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'drainage-graph-nodes-circle', () => { m.getCanvas().style.cursor = ''; });
        m.on('click', 'drainage-graph-edges-line', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:240px">
              <strong>Drainage graph edge</strong><br/>
              Flow accumulation: ${p.flow_accumulation_cells} cells &middot; Capacity: ${Number(p.capacity_m3s).toFixed(3)} m&sup3;/s<br/>
              <span style="color:#666; font-size:10px">Provenance: INFERRED flow direction &middot; ESTIMATED capacity &middot; NOT the official MCGM underground network</span>
            </div>`);
        });
        m.on('mouseenter', 'drainage-graph-edges-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'drainage-graph-edges-line', () => { m.getCanvas().style.cursor = ''; });

        // Water bodies / nallas — REAL OSM geometry.
        m.on('click', 'water-fill', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.name || 'Water body'}</strong><br/>
              ${p.natural || p.waterway || 'water'}<br/>
              <span style="color:#666; font-size:10px">Provenance: REAL (OpenStreetMap)</span>
            </div>`);
        });
        m.on('mouseenter', 'water-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'water-fill', () => { m.getCanvas().style.cursor = ''; });
        m.on('click', 'water-line', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.name || 'Nalla / waterway'}</strong><br/>
              ${p.waterway || 'waterway'}<br/>
              <span style="color:#666; font-size:10px">Provenance: REAL (OpenStreetMap)</span>
            </div>`);
        });
        m.on('mouseenter', 'water-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'water-line', () => { m.getCanvas().style.cursor = ''; });

        // City-context major roads — REAL OSM geometry, no simulated status
        // (that only exists for the pilot-zone road network above).
        m.on('click', 'city-roads-line', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.name || 'Unnamed road'}</strong><br/>
              ${p.highway || 'road'}<br/>
              <span style="color:#666; font-size:10px">Provenance: REAL (OpenStreetMap) &middot; open a pilot zone for simulated flood status</span>
            </div>`);
        });
        m.on('mouseenter', 'city-roads-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'city-roads-line', () => { m.getCanvas().style.cursor = ''; });

        // Rainfall — REAL GSMaP in Live Mode, SIMULATED design-storm intensity in Demo Mode.
        m.on('click', 'rainfall-fill', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          const intensity = typeof p.intensity === 'number' ? p.intensity : null;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>Rainfall intensity</strong><br/>
              ${intensity !== null ? `${intensity.toFixed(1)} mm/hr` : 'no reading'}<br/>
              <span style="color:#666; font-size:10px">Provenance: ${demoModeRef.current ? 'SIMULATED (Demo Mode design-storm scenario)' : 'REAL (GSMaP satellite estimate)'}</span>
            </div>`);
        });
        m.on('mouseenter', 'rainfall-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'rainfall-fill', () => { m.getCanvas().style.cursor = ''; });

        // Legacy Scenario-Mode flood-extent polygons.
        m.on('click', 'flood-fill', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>Simulated flood extent</strong><br/>
              Depth: ${p.depthMeters ?? 'n/a'}m &middot; Risk: ${p.riskLevel ?? 'n/a'}<br/>
              <span style="color:#666; font-size:10px">Provenance: SIMULATED — a stylized extent, see the flood-depth (node) layer for the primary simulation</span>
            </div>`);
        });
        m.on('mouseenter', 'flood-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'flood-fill', () => { m.getCanvas().style.cursor = ''; });

        // Routing — the active flood-aware route, the flood-blind comparison
        // route, and the origin/destination markers. Pulls live route detail
        // (risk, avoided roads, time penalty) from computedRoutesRef so the
        // popup always reflects the currently-displayed route, not a stale
        // closure value.
        m.on('click', 'route-line', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const routeMode = (f.properties as Record<string, unknown>).mode as string;
          const route = computedRoutesRef.current?.[routeMode as 'fastest' | 'safest' | 'balanced'];
          if (!route || !route.found) return;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:240px">
              <strong>${routeMode.charAt(0).toUpperCase() + routeMode.slice(1)} route</strong><br/>
              ${route.distanceKm.toFixed(2)}km &middot; ~${Math.round(route.etaMinutes)}min &middot; risk: ${route.riskLabel}<br/>
              ${route.avoidedRoads.length} road(s) avoided vs. the flood-blind normal route<br/>
              ${route.floodedSegmentsOnPath > 0 ? `Still crosses ${route.floodedSegmentsOnPath} at-risk segment(s)<br/>` : ''}
              <span style="color:#666; font-size:10px">Provenance: geometry REAL (OSM) &middot; routing decision MODELLED</span>
            </div>`);
        });
        m.on('mouseenter', 'route-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'route-line', () => { m.getCanvas().style.cursor = ''; });
        m.on('click', 'route-normal-line', (e) => {
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:230px">
              <strong>Flood-blind "normal" route</strong><br/>
              What a non-flood-aware navigation app would have suggested — shown only for comparison.<br/>
              <span style="color:#666; font-size:10px">Provenance: geometry REAL (OSM) &middot; ignores flood status entirely</span>
            </div>`);
        });
        m.on('mouseenter', 'route-normal-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'route-normal-line', () => { m.getCanvas().style.cursor = ''; });
        m.on('click', 'route-endpoints', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.role === 'origin' ? 'Origin' : 'Destination'}</strong><br/>
              ${p.name ?? ''}
            </div>`);
        });
        m.on('mouseenter', 'route-endpoints', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'route-endpoints', () => { m.getCanvas().style.cursor = ''; });
        m.on('click', 'route-external-line', (e) => {
          const f = e.features?.[0];
          const provider = (f?.properties as Record<string, unknown> | undefined)?.provider ?? 'an external routing service';
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:230px">
              <strong>External routing fallback</strong><br/>
              Generated via ${provider}.<br/>
              <span style="color:#666; font-size:10px">This route has NO flood-awareness — the local flood-aware graph could not connect these two points.</span>
            </div>`);
        });
        m.on('mouseenter', 'route-external-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'route-external-line', () => { m.getCanvas().style.cursor = ''; });

        // Raster layers (DEM elevation, slope, flood susceptibility) — MapLibre
        // image sources have no queryable per-pixel features, so a per-layer
        // 'click' listener (like the vector layers above) never fires for them.
        // Instead, a single global click handler checks whether any interactive
        // vector layer was hit first (if so, its own handler above already
        // showed a popup — do nothing here); otherwise it looks up the nearest
        // point in a real, pre-sampled GeoTIFF value grid for whichever raster
        // layer is currently topmost-visible.
        const VECTOR_INTERACTIVE_LAYERS = [
          'infra-point', 'roads-line', 'buildings-fill', 'buildings-extrusion', 'inferred-drainage-line',
          'flood-simulation-circle', 'flood-simulation-extrusion', 'drainage-graph-nodes-circle', 'drainage-graph-edges-line',
          'water-fill', 'water-line', 'city-roads-line', 'rainfall-fill', 'flood-fill',
          'route-line', 'route-normal-line', 'route-endpoints', 'route-external-line',
        ];
        const RASTER_LAYERS: Array<{ id: string; grid: () => GridPoint[]; label: string; unit: string; provenance: string; digits: number }> = [
          { id: 'flood-susceptibility-fill', grid: () => susceptibilityGridRef.current, label: 'Flood susceptibility', unit: '(0-1 index)', provenance: 'MODELLED', digits: 3 },
          { id: 'slope-raster', grid: () => slopeGridRef.current, label: 'Slope', unit: 'deg', provenance: 'INFERRED (DEM-derived)', digits: 2 },
          { id: 'dem-raster', grid: () => elevationGridRef.current, label: 'Elevation', unit: 'm', provenance: 'OBSERVED (Copernicus DEM)', digits: 1 },
        ];
        m.on('click', (e) => {
          const existing = VECTOR_INTERACTIVE_LAYERS.filter((id) => m.getLayer(id));
          if (existing.length > 0 && m.queryRenderedFeatures(e.point, { layers: existing }).length > 0) return;

          const raster = RASTER_LAYERS.find((r) => m.getLayer(r.id) && m.getLayoutProperty(r.id, 'visibility') !== 'none');
          if (!raster) return;
          const pt = nearestGridPoint(raster.grid(), e.lngLat.lng, e.lngLat.lat);
          showInspectPopup(e.lngLat, pt
            ? `<div style="font: 12px sans-serif; color:#111; max-width:220px">
                <strong>${raster.label}</strong><br/>
                ${pt.value.toFixed(raster.digits)} ${raster.unit}<br/>
                <span style="color:#666; font-size:10px">Provenance: ${raster.provenance} &middot; nearest sampled grid point</span>
              </div>`
            : `<div style="font: 12px sans-serif; color:#111">No sampled value near this point.</div>`);
        });

        setStyleLoaded(true);
      });
    }

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Camera: fly to Mumbai overview or into the active pilot zone
  useEffect(() => {
    if (!map.current) return;
    if (viewMode === 'overview') {
      map.current.flyTo({ center: MUMBAI_OVERVIEW.center, zoom: MUMBAI_OVERVIEW.zoom, pitch: 0, essential: true });
    } else if (activeZone) {
      map.current.flyTo({ center: activeZone.center, zoom: activeZone.zoom, pitch: 45, essential: true });
    }
  }, [viewMode, activeZone]);

  // Step 5E — MapLibre-native 3D terrain (raster-dem + map.setTerrain()), NOT
  // Cesium. Only ever active in pilot-zone view, with the terrain3d layer
  // toggle on — city/overview view never loads a terrain-dem source, per the
  // "don't load detailed terrain globally" requirement. Terrain is DERIVED
  // (Copernicus DEM, or its PNG-decoded fallback — see export_terrain_rgb.py);
  // never presented as more precise than that.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;
    let cancelled = false;
    const TERRAIN_SOURCE_ID = 'terrain-rgb-source';
    const wantTerrain = viewMode === 'zone' && !!activeZone && layerVisibility.terrain3d;

    // Always tear down first (Step 5J: unload the previous zone's terrain
    // source before loading the new one / leaving zone view) — cheap, and
    // avoids a stale raster-dem source from a prior zone lingering.
    m.setTerrain(null);
    if (m.getSource(TERRAIN_SOURCE_ID)) m.removeSource(TERRAIN_SOURCE_ID);

    if (wantTerrain) {
      realAdapter.getTerrainRgbManifest(activeZone.id).then((manifest) => {
        if (cancelled || !manifest || !m.isStyleLoaded() || m.getSource(TERRAIN_SOURCE_ID)) return;
        m.addSource(TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          tiles: [`${window.location.origin}/${manifest.tile_url_template}`],
          tileSize: manifest.tile_size,
          encoding: manifest.encoding,
          minzoom: Math.min(...manifest.zoom_levels),
          maxzoom: Math.max(...manifest.zoom_levels),
        });
        m.setTerrain({ source: TERRAIN_SOURCE_ID, exaggeration: 1.5 });
      });
    }
    return () => { cancelled = true; };
  }, [activeZone, viewMode, styleLoaded, layerVisibility.terrain3d]);

  // Step 5F — MapLibre `fill-extrusion` 3D buildings, only in pilot-zone view;
  // the flat 'buildings-fill' layer stays lightweight for the city/overview.
  // Same 'buildings' layer toggle controls both (whichever is relevant to the
  // current view), so there is no separate/confusing 3rd toggle.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;
    const zoneView = viewMode === 'zone';
    const visible = layerVisibility.buildings;
    if (m.getLayer('buildings-fill')) {
      m.setLayoutProperty('buildings-fill', 'visibility', !zoneView && visible ? 'visible' : 'none');
    }
    if (m.getLayer('buildings-extrusion')) {
      m.setLayoutProperty('buildings-extrusion', 'visibility', zoneView && visible ? 'visible' : 'none');
    }
  }, [viewMode, styleLoaded, layerVisibility.buildings]);

  // Same flat-vs-extruded split for the flood-depth layer: flat
  // circles normally, 3D pillars only in "3D mode" (zone view + terrain
  // toggle on, so the pillars have real terrain underneath them to sit on).
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;
    const is3DMode = viewMode === 'zone' && layerVisibility.terrain3d;
    const visible = layerVisibility.floodSimulation;
    if (m.getLayer('flood-simulation-circle')) {
      m.setLayoutProperty('flood-simulation-circle', 'visibility', !is3DMode && visible ? 'visible' : 'none');
    }
    if (m.getLayer('flood-simulation-extrusion')) {
      m.setLayoutProperty('flood-simulation-extrusion', 'visibility', is3DMode && visible ? 'visible' : 'none');
    }
  }, [viewMode, styleLoaded, layerVisibility.terrain3d, layerVisibility.floodSimulation]);

  // Fetch city-wide context layers once (zone/time-independent)
  useEffect(() => {
    realAdapter.getBoundaryData().then(setBoundaryFeatures);
    realAdapter.getWaterData().then(setWaterFeatures);
    realAdapter.getCityRoadsData().then(setCityRoadsFeatures);
    realAdapter.getInferredDrainageData().then(setInferredDrainageFeatures);
    realAdapter.getElevationQueryGrid().then((fc) => setElevationGrid(toGridPoints(fc, 'elevation_m')));
    realAdapter.getSlopeQueryGrid().then((fc) => setSlopeGrid(toGridPoints(fc, 'slope_degrees')));
    realAdapter.getSusceptibilityQueryGrid().then((fc) => setSusceptibilityGrid(toGridPoints(fc, 'susceptibility_score')));
  }, []);

  // DEM elevation + slope image overlays (REAL Copernicus DEM GLO-30, city-wide, added once)
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;
    let cancelled = false;

    (async () => {
      const info = await realAdapter.getFloodSusceptibilityInfo();
      if (cancelled || !info || m.getSource('flood-susceptibility-source')) return;
      const [west, south, east, north] = info.bounds;
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
        [west, north], [east, north], [east, south], [west, south],
      ];
      m.addSource('flood-susceptibility-source', { type: 'image', url: info.url, coordinates });
      m.addLayer(
        {
          id: 'flood-susceptibility-fill', type: 'raster', source: 'flood-susceptibility-source',
          paint: { 'raster-opacity': 0.55 },
          layout: { visibility: useLayerStore.getState().visibility.floodSusceptibility ? 'visible' : 'none' },
        },
        'rainfall-fill'
      );
    })();

    (['elevation', 'slope'] as const).forEach(async (kind) => {
      const info = await realAdapter.getDemVisualInfo(kind);
      if (cancelled || !info || m.getSource(`${kind}-source`)) return;
      const [west, south, east, north] = info.bounds;
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
        [west, north], [east, north], [east, south], [west, south],
      ];
      const layerId = kind === 'elevation' ? 'dem-raster' : 'slope-raster';
      const layerKey = kind === 'elevation' ? 'dem' : 'slope';
      m.addSource(`${kind}-source`, { type: 'image', url: info.url, coordinates });
      m.addLayer(
        {
          id: layerId, type: 'raster', source: `${kind}-source`, paint: { 'raster-opacity': 0.5 },
          layout: { visibility: useLayerStore.getState().visibility[layerKey] ? 'visible' : 'none' },
        },
        'inferred-drainage-line'
      );
    });
    return () => { cancelled = true; };
  }, [styleLoaded]);

  // Fetch per-zone buildings
  useEffect(() => {
    if (!activeZone) return;
    realAdapter.getBuildingsData(activeZone.id).then(setBuildingsFeatures);
  }, [activeZone]);

  // Landcover image overlay: image sources can't setData(), so add/remove per zone
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded || !activeZone) return;

    let cancelled = false;
    realAdapter.getLandcoverInfo(activeZone.id).then((info) => {
      if (cancelled || !info) return;
      const [west, south, east, north] = info.bounds;
      const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
        [west, north], [east, north], [east, south], [west, south],
      ];
      if (m.getLayer('landcover-raster')) m.removeLayer('landcover-raster');
      if (m.getSource('landcover-source')) m.removeSource('landcover-source');
      m.addSource('landcover-source', { type: 'image', url: info.url, coordinates });
      m.addLayer(
        {
          id: 'landcover-raster', type: 'raster', source: 'landcover-source', paint: { 'raster-opacity': 0.45 },
          layout: { visibility: useLayerStore.getState().visibility.landcover ? 'visible' : 'none' },
        },
        'water-fill'
      );
    });
    return () => { cancelled = true; };
  }, [activeZone, styleLoaded]);

  // Update Data Sources — re-runs once style finishes loading (styleLoaded
  // flips to true) as well as whenever the underlying data changes, so data
  // that resolves before the style is ready isn't silently dropped.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;

    const setSrc = (id: string, data: FeatureCollection | null) => {
      if (!data) return;
      const src = m.getSource(id) as maplibregl.GeoJSONSource;
      if (src) src.setData(data);
    };

    setSrc('boundary-source', boundaryFeatures);
    setSrc('water-source', waterFeatures);
    setSrc('city-roads-source', cityRoadsFeatures);
    setSrc('buildings-source', buildingsFeatures);
    // roads-source geometry is set once-per-zone below (perf fix), NOT here.
    setSrc('rainfall-source', rainfallFeatures);
    setSrc('flood-source', floodFeatures);
    setSrc('infra-source', infraWithRisk);
    setSrc('inferred-drainage-source', inferredDrainageFeatures);
    // Step 5C: timestep change replaces this source's data via setData() —
    // no layer/map recreation. Step 5J: swaps automatically on zone change
    // too, since useFloodSimulationFrame/useDrainageGraph are zone-keyed.
    setSrc('flood-simulation-source', activeFloodSimFrame as unknown as FeatureCollection | null);
    setSrc('flood-simulation-extrusion-source', floodExtrusionFeatures);
    setSrc('drainage-graph-nodes-source', drainageNodesWithStatus);
    setSrc('drainage-graph-edges-source', drainageEdgesFeatures as unknown as FeatureCollection | null);

    const activeRoute = computedRoutes?.[routeMode];
    const routeFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: activeRoute?.found
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: activeRoute.path }, properties: { mode: routeMode } }]
        : [],
    };
    setSrc('route-source', routeFC);

    const externalRouteFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: externalRoute
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: externalRoute.path }, properties: { provider: externalRoute.provider } }]
        : [],
    };
    setSrc('route-external-source', externalRouteFC);

    const normalRoute = normalRouteComparison?.normalRoute;
    const normalRouteFC: FeatureCollection = {
      type: 'FeatureCollection',
      features: normalRoute?.found
        ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: normalRoute.path }, properties: { mode: 'normal' } }]
        : [],
    };
    setSrc('route-normal-source', normalRouteFC);

    const endpointFeatures: Feature[] = [];
    if (routeOrigin) endpointFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: routeOrigin.coord }, properties: { role: 'origin', name: routeOrigin.name } });
    if (routeDestination) endpointFeatures.push({ type: 'Feature', geometry: { type: 'Point', coordinates: routeDestination.coord }, properties: { role: 'destination', name: routeDestination.name } });
    setSrc('route-endpoints-source', { type: 'FeatureCollection', features: endpointFeatures });
  }, [styleLoaded, rainfallFeatures, floodFeatures, infraWithRisk, buildingsFeatures, waterFeatures, boundaryFeatures, cityRoadsFeatures, inferredDrainageFeatures, computedRoutes, normalRouteComparison, routeMode, routeOrigin, routeDestination, activeFloodSimFrame, floodExtrusionFeatures, drainageNodesWithStatus, drainageEdgesFeatures, externalRoute]);

  // Performance fix (the ~4.8fps measured during T+0->T+180
  // playback): road GEOMETRY (3200+ features) is set into 'roads-source'
  // only when it actually changes — i.e. on zone switch — using the STATIC
  // roadsRisk collection (useRainfallAwareRisk fetches it once per zone,
  // with no timestep dependency), never on every timeline tick.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded || !roadsRisk) return;
    const src = m.getSource('roads-source') as maplibregl.GeoJSONSource | undefined;
    src?.setData(roadsRisk);
  }, [styleLoaded, roadsRisk]);

  // Per-timestep road flood status is pushed as MapLibre feature-state
  // (keyed by the real OSM id via promoteId) instead of a full setData() —
  // an O(1)-per-feature paint-property update instead of re-tessellating
  // every road on the map for every T+0..180 step.
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded || !roadsWithStatus) return;
    for (const f of roadsWithStatus.features) {
      const osmId = f.properties?.osm_id;
      if (osmId === null || osmId === undefined) continue;
      m.setFeatureState(
        { source: 'roads-source', id: osmId },
        {
          roadStatus: f.properties?.roadStatus,
          affected: Boolean(f.properties?.affected),
          simulatedFloodDepthM: f.properties?.simulatedFloodDepthM ?? 0,
        }
      );
    }
  }, [styleLoaded, roadsWithStatus]);

  // Apply real layer-toggle visibility (this actually controls the map now —
  // previously the Settings checkboxes updated state nothing else read).
  useEffect(() => {
    const m = map.current;
    if (!m || !styleLoaded) return;
    for (const [layerId, maplibreIds] of Object.entries(LAYER_TO_MAPLIBRE)) {
      const visible = layerVisibility[layerId];
      for (const id of maplibreIds) {
        if (m.getLayer(id)) {
          m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
        }
      }
    }
  }, [styleLoaded, layerVisibility]);

  return (
    <div className="relative w-full h-full bg-neutral-900">
      <div ref={mapContainer} className="w-full h-full" />

      {mapError && !styleLoaded && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-neutral-900/95 text-center px-6">
          <p className="text-sm font-semibold text-red-400">Map failed to load</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            The basemap service is unreachable ({mapError}). Rainfall, infrastructure, and risk data in the side
            panels are unaffected — only the map view is down.
          </p>
        </div>
      )}

      <FullscreenToggle />
      <LayerControl />
      <MapLegend />

      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 px-4 py-2 rounded-full text-xs backdrop-blur-sm pointer-events-none border border-white/10 shadow-lg text-center max-w-md">
        {simulationMode === 'demo' && (
          <span className="font-bold text-amber-300 tracking-wide">SCENARIO SIMULATION (HYPOTHETICAL) &middot; </span>
        )}
        {viewMode === 'overview'
          ? 'Mumbai city context: boundary, major roads & water are REAL (OSM). Fly into a pilot zone for building-level detail.'
          : whatIfView !== 'off'
          ? `${activeZone.name}: showing What-If ${whatIfView.toUpperCase()} (T+${floodSimTMin}min) — SIMULATED hypothetical drainage-capacity comparison, not a planned MCGM project.`
          : simulationMode === 'demo'
          ? `${activeZone.name}: self-contained illustrative simulation (T+${floodSimTMin}min) — every flood/road/infrastructure value on screen is SYNTHETIC, not real observed data.`
          : `${activeZone.name}: roads, buildings, water & critical infrastructure are REAL (OSM/MCGM). Flood simulation (T+${floodSimTMin}min, ${floodSimScenario === 'design_storm' ? 'SIMULATED design storm' : 'OBSERVED, dry'}) and drainage graph (INFERRED/ESTIMATED) are available via Layers.`}
      </div>
    </div>
  );
});

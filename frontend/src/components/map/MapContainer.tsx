import React, { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useZoneStore } from '../../stores/useZoneStore';
import { useUIStore } from '../../stores/useUIStore';
import { useLayerStore } from '../../stores/useLayerStore';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { realAdapter } from '../../api/adapters/RealDataAdapter';
import { MUMBAI_OVERVIEW } from '../../types';
import { LayerControl } from './LayerControl';
import { computeRainfallAdjustedRisk, getCriticalityTier } from '../../lib/riskModel';
import type { FeatureCollection } from 'geojson';

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
  roads: ['roads-line'],
  buildings: ['buildings-fill'],
  water: ['water-fill', 'water-line'],
  landcover: ['landcover-raster'],
  infrastructure: ['infra-point'],
  rainfall: ['rainfall-fill'],
  dem: ['dem-raster'],
  slope: ['slope-raster'],
  inferredFlow: ['inferred-drainage-line'],
  flood: ['flood-fill'],
  floodSusceptibility: ['flood-susceptibility-fill'],
};

export const MapContainer: React.FC = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const activeZone = useZoneStore((state) => state.activeZone);
  const viewMode = useUIStore((state) => state.viewMode);
  const { rainfallFeatures, floodFeatures, infraFeatures, roadsFeatures } = useFloodData();
  const { roadsRisk, infraRisk, realRainfallMmHr } = useRainfallAwareRisk();
  const layerVisibility = useLayerStore((state) => state.visibility);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [buildingsFeatures, setBuildingsFeatures] = useState<FeatureCollection | null>(null);
  const [waterFeatures, setWaterFeatures] = useState<FeatureCollection | null>(null);
  const [boundaryFeatures, setBoundaryFeatures] = useState<FeatureCollection | null>(null);
  const [cityRoadsFeatures, setCityRoadsFeatures] = useState<FeatureCollection | null>(null);
  const [inferredDrainageFeatures, setInferredDrainageFeatures] = useState<FeatureCollection | null>(null);
  const [elevationGrid, setElevationGrid] = useState<GridPoint[]>([]);
  const [slopeGrid, setSlopeGrid] = useState<GridPoint[]>([]);
  const [susceptibilityGrid, setSusceptibilityGrid] = useState<GridPoint[]>([]);
  const realRainfallRef = useRef(realRainfallMmHr);
  realRainfallRef.current = realRainfallMmHr;
  const elevationGridRef = useRef<GridPoint[]>([]);
  elevationGridRef.current = elevationGrid;
  const slopeGridRef = useRef<GridPoint[]>([]);
  slopeGridRef.current = slopeGrid;
  const susceptibilityGridRef = useRef<GridPoint[]>([]);
  susceptibilityGridRef.current = susceptibilityGrid;

  // Roads/infra carrying real susceptibility_score, joined onto the
  // real-geometry road/infra collections already used for map rendering —
  // roads join on osm_id, infra joins on rounded coordinates (MCGM assets
  // have no shared id field across the two pipelines, but identical geometry).
  const roadsWithRisk = React.useMemo<FeatureCollection | null>(() => {
    if (!roadsFeatures) return null;
    const byOsmId = new Map<string | number, number>();
    (roadsRisk?.features ?? []).forEach((f) => {
      const id = f.properties?.osm_id;
      const score = f.properties?.susceptibility_score;
      if (id !== undefined && typeof score === 'number') byOsmId.set(id, score);
    });
    return {
      type: 'FeatureCollection',
      features: roadsFeatures.features.map((f) => {
        const score = byOsmId.get(f.properties?.osm_id ?? f.properties?.osmId);
        return score === undefined ? f : { ...f, properties: { ...f.properties, susceptibility_score: score } };
      }),
    };
  }, [roadsFeatures, roadsRisk]);

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

  useEffect(() => {
    if (map.current) return;

    if (mapContainer.current) {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: MUMBAI_OVERVIEW.center,
        zoom: MUMBAI_OVERVIEW.zoom,
        pitch: 0,
      });

      map.current.addControl(new maplibregl.NavigationControl(), 'bottom-right');

      map.current.on('load', () => {
        const m = map.current!;
        const emptyFC: FeatureCollection = { type: 'FeatureCollection', features: [] };

        // Greater Mumbai administrative boundary (REAL — OSM district relations)
        m.addSource('boundary-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'boundary-line', type: 'line', source: 'boundary-source',
          paint: { 'line-color': '#94a3b8', 'line-width': 1.5, 'line-dasharray': [2, 2], 'line-opacity': 0.8 },
        });

        // Water bodies & nallas, city-wide (REAL — OSM waterway/natural=water)
        m.addSource('water-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'water-fill', type: 'fill', source: 'water-source',
          filter: ['==', ['geometry-type'], 'Polygon'],
          paint: { 'fill-color': '#0c4a6e', 'fill-opacity': 0.6 },
        });
        m.addLayer({
          id: 'water-line', type: 'line', source: 'water-source',
          filter: ['==', ['geometry-type'], 'LineString'],
          paint: { 'line-color': '#0ea5e9', 'line-width': 1.5, 'line-opacity': 0.8 },
        });

        // City-context major roads (REAL — OSM, motorway..secondary)
        m.addSource('city-roads-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'city-roads-line', type: 'line', source: 'city-roads-source',
          paint: { 'line-color': '#475569', 'line-width': 1, 'line-opacity': 0.5 },
        });

        // Building footprints, per pilot zone (REAL — OSM)
        m.addSource('buildings-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'buildings-fill', type: 'fill', source: 'buildings-source',
          paint: { 'fill-color': '#334155', 'fill-opacity': 0.5, 'fill-outline-color': '#64748b' },
        });

        // Pilot-zone detailed road network (REAL — OSM, full attributes + simulated flood-affected flag)
        m.addSource('roads-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'roads-line', type: 'line', source: 'roads-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': ['case', ['get', 'affected'], '#ef4444', '#64748b'],
            'line-width': ['case', ['get', 'affected'], 3,
              ['match', ['get', 'highway'],
                'motorway', 2.5, 'trunk', 2.5, 'primary', 2,
                'secondary', 1.5, 'tertiary', 1.2, 1
              ]
            ],
            'line-opacity': ['case', ['get', 'affected'], 0.9, 0.7]
          }
        });

        // Inferred surface drainage (INFERRED — real Copernicus DEM, D8 flow accumulation;
        // NEVER the official MCGM underground network — see Data Provenance)
        m.addSource('inferred-drainage-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'inferred-drainage-line', type: 'line', source: 'inferred-drainage-source',
          paint: {
            'line-color': '#a78bfa',
            'line-width': ['interpolate', ['linear'], ['get', 'flow_accumulation_cells'], 50, 0.5, 1600, 3],
            'line-opacity': 0.55,
          },
        });

        // Rainfall Layer (REAL — GSMaP, intensity-driven opacity)
        m.addSource('rainfall-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'rainfall-fill', type: 'fill', source: 'rainfall-source',
          paint: {
            'fill-color': '#06b6d4',
            'fill-opacity': ['interpolate', ['linear'], ['get', 'intensity'], 0, 0, 20, 0.2, 100, 0.5]
          }
        });

        // Flood Layer (SIMULATED — no real hydrology model yet)
        m.addSource('flood-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'flood-fill', type: 'fill', source: 'flood-source',
          paint: {
            'fill-color': [
              'match', ['get', 'riskLevel'],
              'SEVERE', '#ef4444', 'HIGH', '#f59e0b', 'MODERATE', '#eab308', '#3b82f6'
            ],
            'fill-opacity': 0.6
          }
        });

        // Critical infrastructure (REAL — MCGM official + OSM; status SIMULATED)
        m.addSource('infra-source', { type: 'geojson', data: emptyFC });
        m.addLayer({
          id: 'infra-point', type: 'circle', source: 'infra-source',
          paint: {
            'circle-color': ['match', ['get', 'status'], 'CRITICAL', '#ef4444', 'AT RISK', '#f59e0b', '#10b981'],
            'circle-radius': 6, 'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff'
          }
        });

        m.on('click', 'infra-point', (e) => {
          const feature = e.features?.[0];
          if (!feature || feature.geometry.type !== 'Point') return;
          const p = feature.properties as Record<string, unknown>;
          const { name, type, status, depthMeters, _source } = p as Record<string, string>;
          const susceptibility = typeof p.susceptibility_score === 'number' ? p.susceptibility_score : null;
          const impact = susceptibility !== null ? computeRainfallAdjustedRisk(susceptibility, realRainfallRef.current) : null;
          const tier = getCriticalityTier(type);
          popup.current?.remove();
          popup.current = new maplibregl.Popup({ closeButton: true, offset: 12 })
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setHTML(
              `<div style="font: 12px sans-serif; color: #111; max-width:230px">
                <strong>${name}</strong><br/>
                ${type} &middot; ${status} &middot; criticality: ${tier.replace('_', ' ')}<br/>
                Simulated flood depth: ${depthMeters}m<br/>
                ${susceptibility !== null ? `Susceptibility: ${susceptibility.toFixed(2)} &middot; Exposure (now, weighted): ${impact!.toFixed(2)}<br/>` : ''}
                Rainfall: ${realRainfallRef.current.toFixed(1)} mm/h<br/>
                <span style="color:#666; font-size:10px">Location: ${_source ?? 'OpenStreetMap'} &middot; Susceptibility: MODELLED</span>
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
          const susceptibility = typeof p.susceptibility_score === 'number' ? p.susceptibility_score : null;
          const impact = susceptibility !== null ? computeRainfallAdjustedRisk(susceptibility, realRainfallRef.current) : null;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.name || 'Unnamed road'}</strong><br/>
              ${p.highway ?? 'road'} &middot; <span style="color:${p.affected ? '#dc2626' : '#16a34a'}">${p.affected ? 'flood-affected (simulated)' : 'clear (simulated)'}</span><br/>
              ${susceptibility !== null ? `Susceptibility: ${susceptibility.toFixed(2)} &middot; Impact (now): ${impact!.toFixed(2)}<br/>` : ''}
              Rainfall: ${realRainfallRef.current.toFixed(1)} mm/h<br/>
              <span style="color:#666; font-size:10px">Geometry: REAL (OSM) &middot; Susceptibility: MODELLED</span>
            </div>`);
        });
        m.on('mouseenter', 'roads-line', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'roads-line', () => { m.getCanvas().style.cursor = ''; });

        // Buildings — REAL OSM footprints
        m.on('click', 'buildings-fill', (e) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          showInspectPopup(e.lngLat, `
            <div style="font: 12px sans-serif; color:#111; max-width:220px">
              <strong>${p.name || p.building || 'Building'}</strong><br/>
              ${p['building:levels'] ? `${p['building:levels']} levels` : ''}<br/>
              <span style="color:#666; font-size:10px">Provenance: REAL (OSM)</span>
            </div>`);
        });
        m.on('mouseenter', 'buildings-fill', () => { m.getCanvas().style.cursor = 'pointer'; });
        m.on('mouseleave', 'buildings-fill', () => { m.getCanvas().style.cursor = ''; });

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

        // Raster layers (DEM elevation, slope, flood susceptibility) — MapLibre
        // image sources have no queryable per-pixel features, so a per-layer
        // 'click' listener (like the vector layers above) never fires for them.
        // Instead, a single global click handler checks whether any interactive
        // vector layer was hit first (if so, its own handler above already
        // showed a popup — do nothing here); otherwise it looks up the nearest
        // point in a real, pre-sampled GeoTIFF value grid for whichever raster
        // layer is currently topmost-visible.
        const VECTOR_INTERACTIVE_LAYERS = ['infra-point', 'roads-line', 'buildings-fill', 'inferred-drainage-line'];
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
    setSrc('roads-source', roadsWithRisk);
    setSrc('rainfall-source', rainfallFeatures);
    setSrc('flood-source', floodFeatures);
    setSrc('infra-source', infraWithRisk);
    setSrc('inferred-drainage-source', inferredDrainageFeatures);
  }, [styleLoaded, rainfallFeatures, floodFeatures, infraWithRisk, roadsWithRisk, buildingsFeatures, waterFeatures, boundaryFeatures, cityRoadsFeatures, inferredDrainageFeatures]);

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

      <LayerControl />

      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 text-white/80 px-4 py-2 rounded-full text-xs backdrop-blur-sm pointer-events-none border border-white/10 shadow-lg text-center max-w-md">
        {viewMode === 'overview'
          ? 'Mumbai city context: boundary, major roads & water are REAL (OSM). Fly into a pilot zone for building-level detail.'
          : `${activeZone.name}: roads, buildings, water & critical infrastructure are REAL (OSM/MCGM). Flood depth is SIMULATED — no hydrology model yet.`}
      </div>
    </div>
  );
};

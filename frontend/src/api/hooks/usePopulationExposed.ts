import { useEffect, useState } from 'react';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { useZoneStore } from '../../stores/useZoneStore';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { realAdapter } from '../adapters/RealDataAdapter';
import {
  computeDemoBaseDepthMeters,
  computeDemoDepthAtPoint,
  estimateBuildingOccupants,
  POPULATION_EXPOSURE_DEPTH_THRESHOLD_M,
} from '../../lib/demoEngine';

export interface PopulationExposedResult {
  /** null in Live Mode (no real population data exists — see
   * PROJECT_MASTER_DOCUMENTATION.md §6/§8) or while buildings are
   * still loading. A number, always Demo Mode only, once computed. */
  populationExposed: number | null;
  affectedBuildings: number;
  totalBuildings: number;
}

// Cheap centroid (average of the outer ring's vertices) — not a true
// area-weighted centroid, but sufficient to place ~5-6k building footprints
// for a depth lookup; this is a Demo Mode estimate, not a survey measurement.
function representativePoint(geometry: Polygon | MultiPolygon): [number, number] | null {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
  if (!ring || ring.length === 0) return null;
  let sumLng = 0, sumLat = 0;
  for (const [lng, lat] of ring) { sumLng += lng; sumLat += lat; }
  return [sumLng / ring.length, sumLat / ring.length];
}

/**
 * Demo Mode's Population Exposed KPI: building footprints (real OSM
 * geometry) whose representative point falls inside the current synthetic
 * flood extent, each contributing an ASSUMED occupant count derived from
 * its OSM `levels` tag (or a flat default). This is a clearly-labeled
 * MODELLED estimate for illustrative purposes — never presented as census
 * or survey data, and never computed in Live Mode, where no real
 * population/exposure dataset exists in this project at all.
 */
export function usePopulationExposed(): PopulationExposedResult {
  const activeZoneId = useZoneStore((s) => s.activeZone.id);
  const mode = useSimulationStore((s) => s.mode);
  const timeIndex = useSimulationStore((s) => s.timeIndex);
  const scenarioMultiplier = useSimulationStore((s) => s.scenarioMultiplier);
  const drainageBlockage = useSimulationStore((s) => s.drainageBlockage);
  const [result, setResult] = useState<PopulationExposedResult>({ populationExposed: null, affectedBuildings: 0, totalBuildings: 0 });

  useEffect(() => {
    if (mode !== 'demo') {
      setResult({ populationExposed: null, affectedBuildings: 0, totalBuildings: 0 });
      return;
    }
    const baseDepth = computeDemoBaseDepthMeters(scenarioMultiplier, drainageBlockage, timeIndex);
    if (baseDepth <= 0) {
      realAdapter.getBuildingsData(activeZoneId).then((buildings) => {
        setResult({ populationExposed: 0, affectedBuildings: 0, totalBuildings: buildings.features.length });
      });
      return;
    }

    let cancelled = false;
    realAdapter.getBuildingsData(activeZoneId).then((buildings) => {
      if (cancelled) return;
      let affected = 0;
      let population = 0;
      for (const feature of buildings.features as Feature<Polygon | MultiPolygon>[]) {
        if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') continue;
        const pt = representativePoint(feature.geometry);
        if (!pt) continue;
        const depth = computeDemoDepthAtPoint(activeZoneId, pt[0], pt[1], baseDepth);
        if (depth > POPULATION_EXPOSURE_DEPTH_THRESHOLD_M) {
          affected += 1;
          population += estimateBuildingOccupants(feature.properties?.levels);
        }
      }
      setResult({ populationExposed: population, affectedBuildings: affected, totalBuildings: buildings.features.length });
    });
    return () => { cancelled = true; };
  }, [mode, activeZoneId, timeIndex, scenarioMultiplier, drainageBlockage]);

  return result;
}

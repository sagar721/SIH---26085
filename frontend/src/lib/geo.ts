import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';
import type { PilotZone } from '../types';

export type BBox = [west: number, south: number, east: number, north: number];

export function pointInBBox(point: Position, bbox: BBox): boolean {
  const [x, y] = point;
  const [west, south, east, north] = bbox;
  return x >= west && x <= east && y >= south && y <= north;
}

export function filterByBBox(fc: FeatureCollection, bbox: BBox): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: fc.features.filter(
      (f) => f.geometry && f.geometry.type === 'Point' && pointInBBox(f.geometry.coordinates, bbox)
    ),
  };
}

// Ray-casting point-in-polygon test (outer ring only; ignores holes, which
// none of this app's flood polygons have).
export function pointInPolygon(point: Position, polygon: Polygon): boolean {
  const [x, y] = point;
  const ring = polygon.coordinates[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Finds the highest-severity flood polygon (by depthMeters) containing the
// given point among a set of flood-depth polygon features, if any.
export function findContainingFloodZone(
  point: Position,
  floodFeatures: Feature[]
): { depthMeters: number; riskLevel: string } | null {
  let best: { depthMeters: number; riskLevel: string } | null = null;
  for (const feature of floodFeatures) {
    if (feature.geometry.type !== 'Polygon') continue;
    if (!pointInPolygon(point, feature.geometry)) continue;
    const depthMeters = parseFloat(String(feature.properties?.depthMeters ?? 0));
    if (!best || depthMeters > best.depthMeters) {
      best = { depthMeters, riskLevel: String(feature.properties?.riskLevel ?? 'LOW') };
    }
  }
  return best;
}

// Bounding-box area approximation (equirectangular, not geodesic) — the
// same formula AnalyticsModal's zone-comparison tab already uses, pulled
// out here so the new Zone chip / KPI strip can't silently drift into a
// second, slightly different "zone area" number.
export function zoneAreaKm2(zone: PilotZone): number | null {
  if (!zone.bbox) return null;
  const [west, south, east, north] = zone.bbox;
  return (east - west) * 111 * (north - south) * 111 * Math.cos((zone.center[1] * Math.PI) / 180);
}

// Rough planar area of a Polygon ring in km^2 (equirectangular approximation
// — fine for small pilot-zone polygons, not a geodesic calculation). Same
// formula the pre-V3 Right Panel's affected-area stat used.
function ringAreaKm2(coords: [number, number][], latDeg: number): number {
  const kmPerDegLat = 111.32;
  const kmPerDegLon = 111.32 * Math.cos((latDeg * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const [x1, y1] = coords[i];
    const [x2, y2] = coords[i + 1];
    sum += x1 * kmPerDegLon * (y2 * kmPerDegLat) - x2 * kmPerDegLon * (y1 * kmPerDegLat);
  }
  return Math.abs(sum / 2);
}

export function floodPolygonAreaKm2(floodFeatures: FeatureCollection | Feature[] | null | undefined): number {
  const features = floodFeatures ? ('features' in floodFeatures ? floodFeatures.features : floodFeatures) : [];
  return features.reduce((sum, f) => {
    if (f.geometry.type !== 'Polygon') return sum;
    const ring = f.geometry.coordinates[0] as [number, number][];
    const lat = ring[0]?.[1] ?? 19.05;
    return sum + ringAreaKm2(ring, lat);
  }, 0);
}

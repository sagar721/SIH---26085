import type { Feature, FeatureCollection, Polygon, Position } from 'geojson';

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

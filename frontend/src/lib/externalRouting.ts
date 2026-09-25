// Priority-3 routing fallback: when the local flood-aware road graph can't
// produce a route (origin/destination outside the pilot zone's road extract,
// or a genuinely disconnected pair), fall back to a real external routing
// engine rather than showing "No route available". OSRM's public demo
// server needs no API key (matches this project's no-key-required
// philosophy for the basemap/geocoder), and is functionally the same class
// of engine as the OpenRouteService/Valhalla/GraphHopper examples — it does
// NOT know about this project's flood model, so any route it returns is
// clearly labeled "External routing fallback used" and never claimed to be
// flood-aware.
import type { Position } from 'geojson';

export interface ExternalRoute {
  path: Position[];
  distanceKm: number;
  etaMinutes: number;
  provider: string;
}

const OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1/driving';

export async function fetchExternalRoute(
  origin: [number, number],
  destination: [number, number]
): Promise<ExternalRoute | null> {
  try {
    const url = `${OSRM_ENDPOINT}/${origin[0]},${origin[1]};${destination[0]},${destination[1]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (!route) return null;
    return {
      path: route.geometry.coordinates as Position[],
      distanceKm: route.distance / 1000,
      etaMinutes: route.duration / 60,
      provider: 'OSRM (public demo server)',
    };
  } catch {
    return null; // best-effort fallback — never throw
  }
}

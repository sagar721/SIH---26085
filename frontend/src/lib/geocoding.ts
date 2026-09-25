// Real-world location search for the Routing panel — replaces the old
// "pick from a dropdown of infrastructure points" picker with true search:
// a local, ranked landmark index (instant, no network) searched first, then
// Nominatim (OpenStreetMap's public geocoder — no API key required, matches
// this project's existing no-key-needed tile/data philosophy) as a fallback
// for anything not already in the local dataset. Works identically in Live
// and Demo Mode — search/geocoding has nothing to do with the simulation.
import type { FeatureCollection } from 'geojson';

export type LandmarkSource = 'infrastructure' | 'road' | 'building' | 'geocoded';

export interface SearchResult {
  name: string;
  /** Extra context shown under the name — amenity type, road class, or the
   * geocoder's full address string. */
  subtitle: string;
  coord: [number, number];
  source: LandmarkSource;
  /** Lower = higher priority (hospitals rank above a generic building). */
  priorityTier: number;
}

// Ranking tiers per the explicit priority list: hospitals/schools/colleges/
// stations/depots/police/fire/government/major roads/landmarks/critical
// infrastructure. Lower number = shown first.
const AMENITY_TIER: Record<string, number> = {
  hospital: 0, clinic: 0, doctors: 0,
  fire_station: 1,
  police: 2,
  school: 3, college: 3, university: 3,
  railway: 4, train_station: 4,
  metro: 5, subway: 5,
  bus_station: 6, bus_depot: 6,
  government: 7, townhall: 7, public_facility: 7,
};
const DEFAULT_INFRA_TIER = 8;
const ROAD_TIER: Record<string, number> = {
  motorway: 9, trunk: 9, primary: 10, secondary: 11, tertiary: 12,
};
const DEFAULT_ROAD_TIER = 13;
const BUILDING_TIER = 14;
const GEOCODED_TIER = 20;

// OSM nodes whose only "name" is a raw tag value (traffic_signal, give_way,
// crossing, etc.) are not landmarks a person would search for — this is the
// exact "hundreds of traffic_signal entries" bug this module fixes. A real
// landmark's name never exactly equals its own amenity/highway tag.
const GENERIC_TAG_NAMES = new Set([
  'traffic_signal', 'traffic_signals', 'give_way', 'stop', 'crossing',
  'turning_circle', 'mini_roundabout', 'motorway_junction',
]);

function isGenericTagName(name: string | undefined, amenity: string | undefined): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
  if (GENERIC_TAG_NAMES.has(normalized)) return true;
  if (amenity && normalized === amenity.trim().toLowerCase()) return true;
  return false;
}

export interface LandmarkIndex {
  entries: SearchResult[];
}

/** Builds the local, instant search index for one zone from data already
 * loaded elsewhere in the app (no extra fetch) — real infrastructure, real
 * named roads, real named buildings. Traffic-signal-style generic OSM nodes
 * are excluded entirely, never just deprioritized. */
export function buildLandmarkIndex(
  infra: FeatureCollection | null,
  roads: FeatureCollection | null,
  buildings: FeatureCollection | null
): LandmarkIndex {
  const entries: SearchResult[] = [];
  const seen = new Set<string>();
  const addEntry = (e: SearchResult) => {
    const key = `${e.name}|${e.coord[0].toFixed(5)},${e.coord[1].toFixed(5)}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(e);
  };

  for (const f of infra?.features ?? []) {
    if (f.geometry.type !== 'Point') continue;
    const name = f.properties?.name as string | undefined;
    const amenity = f.properties?.amenity as string | undefined;
    if (isGenericTagName(name, amenity)) continue;
    addEntry({
      name: name!,
      subtitle: (amenity ?? 'infrastructure').replace(/_/g, ' '),
      coord: f.geometry.coordinates as [number, number],
      source: 'infrastructure',
      priorityTier: (amenity ? AMENITY_TIER[amenity] : undefined) ?? DEFAULT_INFRA_TIER,
    });
  }

  for (const f of roads?.features ?? []) {
    if (f.geometry.type !== 'LineString') continue;
    const name = f.properties?.name as string | undefined;
    const highway = f.properties?.highway as string | undefined;
    if (!name) continue;
    const coords = f.geometry.coordinates;
    const mid = coords[Math.floor(coords.length / 2)] as [number, number];
    addEntry({
      name,
      subtitle: `${(highway ?? 'road').replace(/_/g, ' ')} road`,
      coord: mid,
      source: 'road',
      priorityTier: (highway ? ROAD_TIER[highway] : undefined) ?? DEFAULT_ROAD_TIER,
    });
  }

  for (const f of buildings?.features ?? []) {
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') continue;
    const name = f.properties?.name as string | undefined;
    if (!name) continue;
    const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0]?.[0];
    if (!ring || ring.length === 0) continue;
    let sumLng = 0, sumLat = 0;
    for (const [lng, lat] of ring) { sumLng += lng; sumLat += lat; }
    addEntry({
      name,
      subtitle: (f.properties?.building as string | undefined)?.replace(/_/g, ' ') || 'building',
      coord: [sumLng / ring.length, sumLat / ring.length],
      source: 'building',
      priorityTier: BUILDING_TIER,
    });
  }

  return { entries };
}

/** Ranked local search: substring match on name (case-insensitive), sorted
 * by priority tier then alphabetically. Instant — no network. */
export function searchLocalLandmarks(index: LandmarkIndex, query: string, limit = 8): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return index.entries
    .filter((e) => e.name.toLowerCase().includes(q))
    .sort((a, b) => {
      // Exact-start matches first (typing "KEM" should surface "KEM Hospital"
      // above a building that merely contains "kem" mid-name), then tier, then name.
      const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      if (a.priorityTier !== b.priorityTier) return a.priorityTier - b.priorityTier;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

// Greater Mumbai bounding box — biases/restricts Nominatim results to this
// project's actual area of interest instead of returning e.g. "Dadar" in
// an unrelated country.
const MUMBAI_VIEWBOX = '72.75,19.30,73.05,18.85'; // left,top,right,bottom

let nominatimCache = new Map<string, SearchResult[]>();

/** External geocoding fallback (Nominatim, OpenStreetMap's public geocoder —
 * no API key). Called only when local search doesn't have enough results,
 * or for free-text routing where the typed location was never selected from
 * the local list. Network errors are swallowed to an empty array — geocoding
 * is a best-effort enhancement, never something that should crash the panel. */
export async function searchNominatim(query: string, limit = 6): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const cacheKey = `${q.toLowerCase()}|${limit}`;
  const cached = nominatimCache.get(cacheKey);
  if (cached) return cached;

  try {
    // bounded=1 makes the viewbox a HARD filter, not just a soft preference —
    // found via live browser testing: with bounded=0, "Phoenix Mall" matched
    // a same-named place on the other side of the world instead of nothing,
    // and the routing fallback chain dutifully produced a 9,000km "route" to
    // it. Confining every geocode to Greater Mumbai (the app's entire area of
    // interest) means an unmatched query correctly returns zero results
    // rather than a wrong one far away.
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&viewbox=${MUMBAI_VIEWBOX}&bounded=1&limit=${limit}&addressdetails=0`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return [];
    const data = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; name?: string; type?: string }>;
    const results: SearchResult[] = data.map((d) => ({
      name: d.name || d.display_name.split(',')[0],
      subtitle: d.display_name,
      coord: [parseFloat(d.lon), parseFloat(d.lat)],
      source: 'geocoded',
      priorityTier: GEOCODED_TIER,
    }));
    nominatimCache.set(cacheKey, results);
    return results;
  } catch {
    return []; // best-effort — never throw out of a search box
  }
}

export function clearGeocodingCache(): void {
  nominatimCache = new Map();
}

/** Combined search: local index first (instant), then Nominatim merged in —
 * used by the autocomplete dropdown. Local results are never displaced by
 * geocoded ones with the same effective name. */
export async function searchLocations(index: LandmarkIndex, query: string): Promise<SearchResult[]> {
  const local = searchLocalLandmarks(index, query, 6);
  if (local.length >= 6) return local;
  const remote = await searchNominatim(query, 6 - local.length + 2);
  const localNames = new Set(local.map((r) => r.name.toLowerCase()));
  const merged = [...local, ...remote.filter((r) => !localNames.has(r.name.toLowerCase()))];
  return merged.slice(0, 8);
}

/** Free-text routing: resolve arbitrary typed text (never selected from the
 * dropdown) to a coordinate — local index first, then a single Nominatim
 * lookup. Returns null if nothing could be resolved at all. */
export async function resolveFreeText(index: LandmarkIndex, text: string): Promise<SearchResult | null> {
  const local = searchLocalLandmarks(index, text, 1);
  if (local.length > 0) return local[0];
  const remote = await searchNominatim(text, 1);
  return remote[0] ?? null;
}

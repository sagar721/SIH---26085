import type { FloodDataAdapter, TimePoint, FloodRiskSummary } from '../interfaces/FloodDataAdapter';
import type { Feature, FeatureCollection } from 'geojson';
import { rainfallService } from '../services/RainfallDataService';
import { PILOT_ZONES } from '../../types';
import { getEffectiveRainfallMmHr, computeRainfallFactor } from '../../lib/riskModel';

export class MockAdapter implements FloodDataAdapter {
  
  // Deterministic mock helper
  private generateMockFloodPolygons(zoneId: string, baseDepth: number): Feature[] {
    if (baseDepth <= 0.05) return []; // No flood
    const zone = PILOT_ZONES[zoneId];
    const [lng, lat] = zone.center;
    
    const features: Feature[] = [];
    // Generate 3 sub-zones with varying depths
    for (let i = 0; i < 3; i++) {
      const offsetX = (i - 1) * 0.01;
      const offsetY = (i % 2 === 0 ? 1 : -1) * 0.005;
      const depth = baseDepth * (1 + (i * 0.2));
      // Radius grows much more gently with depth than the original formula
      // (0.005 + i*0.002 + depth*0.005) — that version was never actually
      // exercised before the depth-driving bug fix above, and turned out to
      // cover most of a 5.5km pilot zone at just ~0.6m depth, making
      // "alternative routes generated" undemonstrable (everything blocks at
      // once instead of degrading gradually as rainfall increases).
      const radius = 0.003 + (i * 0.001) + (depth * 0.0015);
      
      const coords = [
        [
          [lng + offsetX - radius, lat + offsetY - radius],
          [lng + offsetX + radius, lat + offsetY - radius],
          [lng + offsetX + radius, lat + offsetY + radius],
          [lng + offsetX - radius, lat + offsetY + radius],
          [lng + offsetX - radius, lat + offsetY - radius]
        ]
      ];
      
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: coords },
        properties: {
          type: 'flood',
          depthMeters: depth.toFixed(2),
          riskLevel: depth > 1.0 ? 'SEVERE' : depth > 0.5 ? 'HIGH' : depth > 0.2 ? 'MODERATE' : 'LOW',
          provenance: 'SIMULATED'
        }
      });
    }
    return features;
  }

  async getRainfallData(_zoneId: string, _time: TimePoint): Promise<FeatureCollection> {
    return { type: 'FeatureCollection', features: [] };
  }

  async getRoadsData(): Promise<FeatureCollection> {
    // Road geometry is real (OpenStreetMap) infrastructure, never mocked —
    // see RealDataAdapter.getRoadsData.
    return { type: 'FeatureCollection', features: [] };
  }

  async getFloodData(zoneId: string, time: TimePoint, scenarioMultiplier = 1.0, drainageBlockage = 0): Promise<FeatureCollection> {
    const row = await rainfallService.getRowForTime(time.timestamp);
    if (!row) return { type: 'FeatureCollection', features: [] };

    const baseDepth = this.computeBaseDepthMeters(zoneId, row, scenarioMultiplier, drainageBlockage);

    return {
      type: 'FeatureCollection',
      features: this.generateMockFloodPolygons(zoneId, baseDepth)
    };
  }

  // Shared by getFloodData/getZoneRiskSummary. Depth is driven by
  // getEffectiveRainfallMmHr (real intensity by default, or a SIMULATED
  // design-storm intensity once Scenario Mode's rainfall multiplier moves
  // off 1.0x — see riskModel.ts) rather than real 3h accumulation directly.
  // The real GSMaP dataset behind this project is a genuinely dry 24-hour
  // window (every hour, both zones: 0.0mm/hr and 0mm accumulation) — driving
  // depth off accumulation*multiplier would keep this permanently at zero
  // and Scenario Mode would visibly do nothing to flood extent/routing,
  // exactly the bug already found and fixed for the rainfall-aware impact
  // model. This is the same fix applied to the flood-depth/routing pathway.
  private computeBaseDepthMeters(
    zoneId: string,
    row: { kurla_sion_mean_mm_hr: number; hindmata_dadar_mean_mm_hr: number },
    scenarioMultiplier: number,
    drainageBlockage: number
  ): number {
    let intensity = 0;
    if (zoneId === 'kurla_sion') intensity = row.kurla_sion_mean_mm_hr;
    else if (zoneId === 'hindmata_dadar') intensity = row.hindmata_dadar_mean_mm_hr;

    const effectiveIntensity = getEffectiveRainfallMmHr(intensity, scenarioMultiplier);
    const rainfallFactor = computeRainfallFactor(effectiveIntensity); // 0 (dry) .. 3 (3x design storm)

    // "Design intensity" means drainage is specified to handle it — so a
    // rainfallFactor of exactly 1.0 with unobstructed (0%) drainage should
    // produce ~no flooding, not already-severe depth. Blockage reduces the
    // effective capacity below that nominal 1.0 threshold (up to a third of
    // capacity at 100% blockage — real drains are rarely fully sealed even
    // when badly clogged); flooding only appears once rainfall exceeds
    // whatever capacity remains. This also matches today's actual real
    // rainfall (0mm/hr, scenario at its 1.0x default, 0% blockage): capacity
    // 1.0, excess 0, depth 0 — genuinely dry, not a formula artifact.
    const capacity = Math.max(0.2, 1 - drainageBlockage / 150);
    const excess = Math.max(0, rainfallFactor - capacity);
    // 1.2m depth per unit of excess-over-capacity — e.g. double the design
    // storm with working drainage (excess=1.0) gives 1.2m (SEVERE, >1.0m
    // threshold used throughout the app); the true worst case (3x design
    // storm, 100% blockage: excess~2.67) gives ~3.2m.
    return excess * 1.2;
  }

  async getInfrastructureData(zoneId: string, time: TimePoint, scenarioMultiplier = 1.0, drainageBlockage = 0): Promise<FeatureCollection> {
    const zone = PILOT_ZONES[zoneId];
    const [lng, lat] = zone.center;
    
    // Create a few mock hospitals/schools
    const types = ['Hospital', 'School', 'Emergency Station'];
    const features: Feature[] = [];
    
    const row = await rainfallService.getRowForTime(time.timestamp);
    let baseDepth = row ? ((zoneId === 'kurla_sion' ? row.kurla_sion_accum_3h : row.hindmata_dadar_accum_3h) * scenarioMultiplier) / 100.0 : 0;
    baseDepth *= (1 + (drainageBlockage / 100.0));

    for (let i = 0; i < 4; i++) {
      const offsetX = (i % 2 === 0 ? 0.008 : -0.008) * (i + 1) * 0.5;
      const offsetY = (i < 2 ? 0.008 : -0.008);
      // Rough depth intersection mock
      const depth = Math.max(0, baseDepth - (Math.abs(offsetX) * 10));

      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng + offsetX, lat + offsetY] },
        properties: {
          name: `Zone ${types[i % types.length]} ${i+1}`,
          type: types[i % types.length],
          depthMeters: depth.toFixed(2),
          status: depth > 0.5 ? 'CRITICAL' : depth > 0.1 ? 'AT RISK' : 'SAFE',
          provenance: 'SIMULATED'
        }
      });
    }

    return { type: 'FeatureCollection', features };
  }

  async getZoneRiskSummary(zoneId: string, time: TimePoint, scenarioMultiplier = 1.0, drainageBlockage = 0): Promise<FloodRiskSummary> {
    const row = await rainfallService.getRowForTime(time.timestamp);
    if (!row) return { overallRisk: 'LOW', peakRainfallMmHr: 0, maxDepthMeters: 0, rainfallDataAvailable: false };

    let intensity = 0;
    if (zoneId === 'kurla_sion') intensity = row.kurla_sion_mean_mm_hr;
    else if (zoneId === 'hindmata_dadar') intensity = row.hindmata_dadar_mean_mm_hr;

    // Worst-case sub-zone depth: matches generateMockFloodPolygons' i=2 case
    // (baseDepth * (1 + 2*0.2) = baseDepth * 1.4), so the summary's
    // maxDepthMeters always matches the deepest rendered flood polygon.
    const maxDepth = this.computeBaseDepthMeters(zoneId, row, scenarioMultiplier, drainageBlockage) * 1.4;

    let risk: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' = 'LOW';
    if (maxDepth > 1.0) risk = 'SEVERE';
    else if (maxDepth > 0.5) risk = 'HIGH';
    else if (maxDepth > 0.2) risk = 'MODERATE';

    return {
      overallRisk: risk,
      peakRainfallMmHr: intensity,
      maxDepthMeters: parseFloat(maxDepth.toFixed(2)),
      rainfallDataAvailable: true,
    };
  }
}

export const mockAdapter = new MockAdapter();

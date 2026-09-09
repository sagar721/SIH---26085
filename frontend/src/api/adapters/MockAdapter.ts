import type { FloodDataAdapter, TimePoint, FloodRiskSummary } from '../interfaces/FloodDataAdapter';
import type { Feature, FeatureCollection } from 'geojson';
import { rainfallService } from '../services/RainfallDataService';
import { PILOT_ZONES } from '../../types';

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
      const radius = 0.005 + (i * 0.002) + (depth * 0.005);
      
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
    
    let accum = 0;
    if (zoneId === 'kurla_sion') {
      accum = row.kurla_sion_accum_3h;
    } else if (zoneId === 'hindmata_dadar') {
      accum = row.hindmata_dadar_accum_3h;
    }

    const effectiveAccum = accum * scenarioMultiplier;
    const blockageFactor = 1 + (drainageBlockage / 100.0);
    let baseDepth = (effectiveAccum / 100.0) * blockageFactor;

    return {
      type: 'FeatureCollection',
      features: this.generateMockFloodPolygons(zoneId, baseDepth)
    };
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
    if (!row) return { overallRisk: 'LOW', peakRainfallMmHr: 0, maxDepthMeters: 0 };

    let intensity = 0;
    let accum = 0;
    if (zoneId === 'kurla_sion') {
      intensity = row.kurla_sion_mean_mm_hr;
      accum = row.kurla_sion_accum_3h;
    } else if (zoneId === 'hindmata_dadar') {
      intensity = row.hindmata_dadar_mean_mm_hr;
      accum = row.hindmata_dadar_accum_3h;
    }

    const effectiveAccum = accum * scenarioMultiplier;
    const blockageFactor = 1 + (drainageBlockage / 100.0);
    let maxDepth = (effectiveAccum / 100.0) * blockageFactor * 1.4;

    let risk: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE' = 'LOW';
    if (maxDepth > 1.0) risk = 'SEVERE';
    else if (maxDepth > 0.5) risk = 'HIGH';
    else if (maxDepth > 0.2) risk = 'MODERATE';

    return {
      overallRisk: risk,
      peakRainfallMmHr: intensity * scenarioMultiplier,
      maxDepthMeters: parseFloat(maxDepth.toFixed(2))
    };
  }
}

export const mockAdapter = new MockAdapter();

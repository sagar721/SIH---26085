import type { FeatureCollection } from 'geojson';

export interface TimePoint {
  timestamp: string; // ISO string
  offsetMinutes: number;
}

export interface FloodRiskSummary {
  overallRisk: 'LOW' | 'MODERATE' | 'HIGH' | 'SEVERE';
  peakRainfallMmHr: number;
  maxDepthMeters: number;
  /** False when there was no rainfall row for the requested timestamp — distinct
   * from a confirmed 0mm/hr reading (disaster-readiness audit item 1.1). */
  rainfallDataAvailable: boolean;
}

export interface FloodDataAdapter {
  // Returns GeoJSON feature collection for rainfall visualization
  getRainfallData(zoneId: string, time: TimePoint): Promise<FeatureCollection>;
  
  // Returns GeoJSON feature collection for flood depth polygons
  getFloodData(zoneId: string, time: TimePoint, scenarioMultiplier?: number, drainageBlockage?: number): Promise<FeatureCollection>;

  // Returns GeoJSON feature collection for infrastructure points
  getInfrastructureData(zoneId: string, time: TimePoint, scenarioMultiplier?: number, drainageBlockage?: number): Promise<FeatureCollection>;

  // Returns overall risk summary for the intelligence panel
  getZoneRiskSummary(zoneId: string, time: TimePoint, scenarioMultiplier?: number, drainageBlockage?: number): Promise<FloodRiskSummary>;

  // Returns GeoJSON feature collection for the real OSM road network, with
  // an `affected` flag per segment derived from the simulated flood extent
  getRoadsData(zoneId: string, time: TimePoint, scenarioMultiplier?: number, drainageBlockage?: number): Promise<FeatureCollection>;
}

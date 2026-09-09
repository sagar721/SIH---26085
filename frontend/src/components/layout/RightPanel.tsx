import React from 'react';
import { AlertTriangle, TrendingUp, Map, Hospital, School, Shield, Flame, Route, Ruler, Clock3, Activity, Building2, Download, Printer } from 'lucide-react';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useZoneStore } from '../../stores/useZoneStore';
import { BRIMSTOWAD_DESIGN_INTENSITY_MM_HR } from '../../lib/riskModel';
import { downloadCSV, downloadGeoJSON, featureCollectionToCSVRows, openPrintSummaryReport } from '../../lib/exportUtils';

const AMENITY_ICON: Record<string, React.ElementType> = {
  hospital: Hospital,
  school: School,
  police: Shield,
  fire_station: Flame,
};

// Rough planar area of a Polygon ring in km^2 (equirectangular approximation
// — fine for small pilot-zone polygons, not a geodesic calculation).
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

export const RightPanel: React.FC = () => {
  const { riskSummary, infraFeatures, floodFeatures, roadsFeatures } = useFloodData();
  const { realRainfallMmHr, roadImpact, infraExposure, zoneSeverity, roadsRisk, infraRisk } = useRainfallAwareRisk();
  const { activeZone } = useZoneStore();
  const affectedAssets = (infraFeatures?.features ?? []).filter((f) => f.properties?.status !== 'SAFE');
  const affectedRoads = (roadsFeatures?.features ?? []).filter((f) => f.properties?.affected);

  const affectedAreaKm2 = (floodFeatures?.features ?? []).reduce((sum, f) => {
    if (f.geometry.type !== 'Polygon') return sum;
    const ring = f.geometry.coordinates[0] as [number, number][];
    const lat = ring[0]?.[1] ?? 19.05;
    return sum + ringAreaKm2(ring, lat);
  }, 0);

  const topRisk = affectedAssets
    .slice()
    .sort((a, b) => parseFloat(String(b.properties?.depthMeters ?? 0)) - parseFloat(String(a.properties?.depthMeters ?? 0)))
    .slice(0, 3);

  if (!riskSummary) {
    return (
      <div className="w-80 z-10 h-full bg-background/90 backdrop-blur-xl border-l border-border flex flex-col p-4 shadow-2xl justify-center items-center">
        <p className="text-sm text-muted-foreground animate-pulse">Analyzing...</p>
      </div>
    );
  }

  const riskColor = riskSummary.overallRisk === 'SEVERE' ? 'text-red' :
                    riskSummary.overallRisk === 'HIGH' ? 'text-amber' :
                    riskSummary.overallRisk === 'MODERATE' ? 'text-yellow-500' : 'text-green';

  return (
    <div className="w-80 z-10 h-full bg-background/90 backdrop-blur-xl border-l border-border flex flex-col p-4 shadow-2xl overflow-y-auto">
      <div className="mb-6">
        <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Intelligence
        </h2>
      </div>

      <div className="flex flex-col gap-6">
        {/* Risk Summary */}
        <div className="p-4 rounded-lg bg-card border border-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">Overall Risk</h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">SIMULATED</span>
          </div>
          <div className="flex items-end gap-2">
            <span className={`text-2xl font-bold ${riskColor}`}>{riskSummary.overallRisk}</span>
            {riskSummary.overallRisk !== 'LOW' && <AlertTriangle className={`w-5 h-5 mb-1 ${riskColor}`} />}
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-[10px] text-muted-foreground uppercase mb-1">Peak Rainfall <span className="text-cyan">(real)</span></p>
            <p className="text-lg font-mono text-cyan">{riskSummary.peakRainfallMmHr.toFixed(1)}<span className="text-xs text-muted-foreground">mm/h</span></p>
          </div>
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-[10px] text-muted-foreground uppercase mb-1">Max Depth <span className="text-blue-400">(sim.)</span></p>
            <p className="text-lg font-mono text-red">{riskSummary.maxDepthMeters.toFixed(2)}<span className="text-xs text-muted-foreground">m</span></p>
          </div>
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center gap-1"><Ruler className="w-2.5 h-2.5" />Affected Area</p>
            <p className="text-lg font-mono text-amber-400">{affectedAreaKm2.toFixed(2)}<span className="text-xs text-muted-foreground">km²</span></p>
          </div>
          <div className="p-3 rounded-lg bg-card border border-border">
            <p className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center gap-1"><Route className="w-2.5 h-2.5" />Affected Roads</p>
            <p className="text-lg font-mono text-amber-400">{affectedRoads.length}<span className="text-xs text-muted-foreground"> segments</span></p>
          </div>
        </div>

        {/* Rainfall-Aware Impact Model — MODELLED: real susceptibility (DEM/landcover/
            waterways) x real current GSMaP rainfall, normalized against MCGM's own
            official 50mm/hr BRIMSTOWAD design intensity. Never OBSERVED/VALIDATED. */}
        <div className="p-4 rounded-lg bg-card border border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5" /> Rainfall-Aware Impact
            </h3>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">MODELLED</span>
          </div>
          <div className="flex items-end gap-2 mb-3">
            <span className={`text-xl font-bold ${
              zoneSeverity.label === 'SEVERE' ? 'text-red' : zoneSeverity.label === 'HIGH' ? 'text-amber' :
              zoneSeverity.label === 'MODERATE' ? 'text-yellow-500' : 'text-green'
            }`}>{zoneSeverity.label}</span>
            <span className="text-xs text-muted-foreground mb-0.5">zone severity ({zoneSeverity.score.toFixed(2)})</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="p-2 rounded bg-muted/40 border border-border/60">
              <p className="text-[9px] text-muted-foreground uppercase flex items-center gap-1"><Route className="w-2.5 h-2.5" />Road Impact</p>
              <p className="font-mono text-foreground">{roadImpact.highRiskCount}<span className="text-muted-foreground">/{roadImpact.count} high-risk</span></p>
            </div>
            <div className="p-2 rounded bg-muted/40 border border-border/60">
              <p className="text-[9px] text-muted-foreground uppercase flex items-center gap-1"><Building2 className="w-2.5 h-2.5" />Infra Exposure</p>
              <p className="font-mono text-foreground">{infraExposure.highRiskCount}<span className="text-muted-foreground">/{infraExposure.count} high-risk</span></p>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Real susceptibility (DEM/landcover/waterways) × real rainfall ({realRainfallMmHr.toFixed(1)}mm/h,
            normalized against MCGM's official {BRIMSTOWAD_DESIGN_INTENSITY_MM_HR}mm/h design intensity).
            Not validated against observed flooding.
          </p>
        </div>

        {/* Export — CSV/GeoJSON of the currently-loaded risk-scored data, plus a print-ready summary */}
        <div className="p-3 rounded-lg bg-card border border-border">
          <h3 className="text-[10px] text-muted-foreground uppercase mb-2 tracking-wider">Export</h3>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => roadsRisk && downloadGeoJSON(`${activeZone.id}_roads_risk`, roadsRisk)}
              disabled={!roadsRisk}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-medium bg-muted/60 hover:bg-muted text-foreground border border-border/60 disabled:opacity-40 transition-colors"
            >
              <Download className="w-3 h-3" /> Roads GeoJSON
            </button>
            <button
              onClick={() => infraRisk && downloadCSV(`${activeZone.id}_infrastructure_risk`, featureCollectionToCSVRows(infraRisk))}
              disabled={!infraRisk}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-medium bg-muted/60 hover:bg-muted text-foreground border border-border/60 disabled:opacity-40 transition-colors"
            >
              <Download className="w-3 h-3" /> Infra CSV
            </button>
            <button
              onClick={() => openPrintSummaryReport({
                zoneName: activeZone.name,
                generatedAt: new Date().toLocaleString(),
                realRainfallMmHr,
                zoneSeverity,
                roadImpact,
                infraExposure,
                affectedAreaKm2,
                affectedRoadsCount: affectedRoads.length,
                affectedAssetsCount: affectedAssets.length,
              })}
              className="col-span-2 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-[10px] font-medium bg-muted/60 hover:bg-muted text-foreground border border-border/60 transition-colors"
            >
              <Printer className="w-3 h-3" /> Print Summary Report
            </button>
          </div>
        </div>

        {/* Forecast horizon — honest: no nowcast model exists */}
        <div className="p-3 rounded-lg bg-card border border-border">
          <p className="text-[10px] text-muted-foreground uppercase mb-1 flex items-center gap-1"><Clock3 className="w-2.5 h-2.5" />Forecast Horizon (T+30…T+180min)</p>
          <p className="text-xs font-bold text-muted-foreground">MODEL UNAVAILABLE</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">No rainfall nowcast model is implemented — only observed (past) GSMaP hours are shown on the timeline.</p>
        </div>

        {/* Top risk locations */}
        {topRisk.length > 0 && (
          <div>
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Top Risk Locations</h3>
            <div className="flex flex-col gap-1.5">
              {topRisk.map((f, i) => (
                <div key={i} className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-card border border-border">
                  <span className="truncate">{f.properties?.name}</span>
                  <span className="font-mono text-amber-400 shrink-0 ml-2">{f.properties?.depthMeters}m</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Affected Infrastructure (real OSM/MCGM assets, flood status simulated) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs text-muted-foreground uppercase tracking-wider">Impact Radius</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">REAL LOC. + SIMULATED STATUS</span>
          </div>
          {affectedAssets.length === 0 ? (
            <div className="p-4 rounded-lg bg-card border border-border flex flex-col items-center justify-center py-8 text-center">
              <Map className="w-8 h-8 text-border mb-2" />
              <p className="text-xs text-muted-foreground">No critical infrastructure currently at risk.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {affectedAssets.slice(0, 6).map((f) => {
                const props = f.properties ?? {};
                const Icon = AMENITY_ICON[props.amenity as string] ?? Map;
                const isCritical = props.status === 'CRITICAL';
                return (
                  <div
                    key={props.osmId}
                    className="p-3 rounded-lg bg-card border border-border flex items-center gap-3"
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isCritical ? 'text-red' : 'text-amber-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium truncate">{props.name}</p>
                      <p className="text-[10px] text-muted-foreground">{props.depthMeters}m simulated depth</p>
                    </div>
                    <span className={`text-[10px] font-bold uppercase shrink-0 ${isCritical ? 'text-red' : 'text-amber-400'}`}>
                      {props.status}
                    </span>
                  </div>
                );
              })}
              {affectedAssets.length > 6 && (
                <p className="text-[10px] text-muted-foreground text-center pt-1">
                  +{affectedAssets.length - 6} more affected
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

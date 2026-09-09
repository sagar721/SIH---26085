import React, { useState, useEffect } from 'react';
import type { Feature } from 'geojson';
import { Modal } from '../common/Modal';
import { BarChart3, TrendingUp, AlertTriangle, Droplets, MapPin, Activity } from 'lucide-react';
import { useZoneStore } from '../../stores/useZoneStore';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { rainfallService } from '../../api/services/RainfallDataService';
import { realAdapter } from '../../api/adapters/RealDataAdapter';
import { PILOT_ZONES } from '../../types';
import {
  computeRoadImpactScore,
  computeInfrastructureExposureScore,
  computeZoneFloodSeverity,
  BRIMSTOWAD_DESIGN_INTENSITY_MM_HR,
} from '../../lib/riskModel';

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AnalyticsModal: React.FC<AnalyticsModalProps> = ({ isOpen, onClose }) => {
  const { activeZone, setActiveZoneId } = useZoneStore();
  const { scenarioMultiplier, drainageBlockage, timeIndex, availableTimestamps } = useSimulationStore();
  const { roadsRisk, infraRisk, roadImpact, infraExposure, zoneSeverity, realRainfallMmHr } = useRainfallAwareRisk();
  const [activeTab, setActiveTab] = useState<'trends' | 'comparison' | 'vulnerability'>('trends');
  const [zoneInfra, setZoneInfra] = useState<Record<string, Feature[]>>({});

  useEffect(() => {
    if (!isOpen) return;
    const time = { timestamp: availableTimestamps[timeIndex] ?? '', offsetMinutes: 0 };
    Object.keys(PILOT_ZONES).forEach((zoneId) => {
      realAdapter.getInfrastructureData(zoneId, time, scenarioMultiplier, drainageBlockage).then((fc) => {
        setZoneInfra((prev) => ({ ...prev, [zoneId]: fc.features }));
      });
    });
  }, [isOpen, timeIndex, availableTimestamps, scenarioMultiplier, drainageBlockage]);

  const zoneData = rainfallService.getDataForZone(activeZone.id);
  const multiplier = scenarioMultiplier || 1.0;
  const blockageRatio = (drainageBlockage || 0) / 100;

  // Process time-series points
  const timeSeries = zoneData.map((d, index: number) => {
    const rainfall = d.rainfall_mm * multiplier;
    // Estimated depth dynamic calculation based on rainfall + blockage
    const rawDepth = (rainfall * 0.045) + (blockageRatio * 0.35);
    const depth = Math.min(1.8, Math.max(0, parseFloat(rawDepth.toFixed(2))));
    return {
      hour: `${index}:00`,
      time: d.timestamp_utc,
      rainfall: parseFloat(rainfall.toFixed(1)),
      depth,
      accumulation: d.accumulation_24h * multiplier
    };
  });

  const peakRainfall = timeSeries.length > 0 ? Math.max(...timeSeries.map(t => t.rainfall)) : 0;
  const total24h = timeSeries.length > 0 ? Math.max(...timeSeries.map(t => t.accumulation)) : 0;
  const maxDepth = timeSeries.length > 0 ? Math.max(...timeSeries.map(t => t.depth)) : 0;

  // SVG Chart Dimensions
  const chartHeight = 180;
  const chartWidth = 640;
  const maxRainY = Math.max(peakRainfall * 1.25, 20);
  const maxDepthY = Math.max(maxDepth * 1.3, 1.5);

  // Rainfall-aware impact model (MODELLED) time series — real per-hour GSMaP
  // rainfall (never the SIMULATED scenario multiplier) combined with the
  // real, DEM-sampled susceptibility scores attached to real road/infra
  // geometry (see riskModel.ts / attach_risk_scores.py). Timeline-aware: the
  // active hour on the SimulationTimeline is highlighted below.
  const impactSeries = zoneData.map((d, index: number) => ({
    hour: `${index}:00`,
    rainfall: d.rainfall_mm,
    severity: computeZoneFloodSeverity(roadsRisk, infraRisk, d.rainfall_mm).score,
    roadImpact: computeRoadImpactScore(roadsRisk, d.rainfall_mm).meanAdjustedRisk,
    infraExposure: computeInfrastructureExposureScore(infraRisk, d.rainfall_mm).weightedMeanAdjustedRisk,
  }));
  const activeHourIndex = Math.min(timeIndex, Math.max(impactSeries.length - 1, 0));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Hydro-Spatial Analytics & Telemetry"
      subtitle={`Comprehensive rainfall-runoff time-series, flood depth hydrographs, and risk exposure for ${activeZone.name}`}
      icon={<BarChart3 className="w-5 h-5" />}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-6">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setActiveTab('trends')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'trends'
                  ? 'bg-cyan text-black font-semibold'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Hydrograph & Time-Series
            </button>
            <button
              onClick={() => setActiveTab('comparison')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'comparison'
                  ? 'bg-cyan text-black font-semibold'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Pilot Zone Cross-Comparison
            </button>
            <button
              onClick={() => setActiveTab('vulnerability')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                activeTab === 'vulnerability'
                  ? 'bg-cyan text-black font-semibold'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              Asset Vulnerability Breakdown
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Active Pilot:</span>
            <select
              value={activeZone.id}
              onChange={(e) => setActiveZoneId(e.target.value)}
              className="bg-muted border border-border rounded-md px-2 py-1 text-xs text-foreground focus:outline-none focus:border-cyan"
            >
              {Object.values(PILOT_ZONES).map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* TAB 1: HYDROGRAPH & TIME SERIES */}
        {activeTab === 'trends' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>Peak Rainfall Rate</span>
                  <Droplets className="w-4 h-4 text-cyan" />
                </div>
                <div className="text-xl font-bold font-mono text-cyan mt-2">
                  {peakRainfall.toFixed(1)} <span className="text-xs font-sans text-muted-foreground">mm/h</span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 block">Observed GSMaP hourly</span>
              </div>

              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>24h Total Rainfall</span>
                  <TrendingUp className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-xl font-bold font-mono text-blue-400 mt-2">
                  {total24h.toFixed(1)} <span className="text-xs font-sans text-muted-foreground">mm</span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 block">Cumulative volume</span>
              </div>

              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>Max Simulated Depth</span>
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-xl font-bold font-mono text-amber-400 mt-2">
                  {maxDepth.toFixed(2)} <span className="text-xs font-sans text-muted-foreground">m</span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 block">Depression bottleneck</span>
              </div>

              <div className="p-3.5 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between text-muted-foreground text-xs">
                  <span>Data Points (hours)</span>
                  <TrendingUp className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-xl font-bold font-mono text-purple-400 mt-2">
                  {timeSeries.length} <span className="text-xs font-sans text-muted-foreground">hrs</span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 block">Real GSMaP hourly records loaded</span>
              </div>
            </div>

            {/* Combined Dual-Axis Hydrograph */}
            <div className="p-4 rounded-xl bg-card border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-foreground">Rainfall Intensity vs Inundation Depth Hydrograph</h4>
                  <p className="text-xs text-muted-foreground">24-hour simulation cycle (Hourly observed precipitation coupled with runoff model)</p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded bg-cyan/80 inline-block" />
                    <span className="text-muted-foreground">Rainfall (mm/h)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-3 h-1 bg-amber-400 rounded inline-block" />
                    <span className="text-muted-foreground">Flood Depth (m)</span>
                  </div>
                </div>
              </div>

              {/* Chart SVG */}
              <div className="w-full overflow-x-auto">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-48 bg-muted/20 rounded-lg p-2">
                  {/* Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
                    <line
                      key={i}
                      x1="40"
                      y1={chartHeight - 30 - ratio * (chartHeight - 50)}
                      x2={chartWidth - 20}
                      y2={chartHeight - 30 - ratio * (chartHeight - 50)}
                      stroke="currentColor"
                      className="text-border/40"
                      strokeDasharray="4 4"
                    />
                  ))}

                  {/* Rainfall Bars */}
                  {timeSeries.map((t, i: number) => {
                    const x = 50 + i * ((chartWidth - 80) / timeSeries.length);
                    const barHeight = (t.rainfall / maxRainY) * (chartHeight - 50);
                    const y = chartHeight - 30 - barHeight;
                    return (
                      <g key={i}>
                        <rect
                          x={x}
                          y={y}
                          width={(chartWidth - 80) / timeSeries.length - 4}
                          height={Math.max(barHeight, 2)}
                          fill="rgba(6, 182, 212, 0.6)"
                          className="hover:fill-cyan transition-colors"
                          rx="2"
                        >
                          <title>{`${t.hour} - Rainfall: ${t.rainfall} mm/h`}</title>
                        </rect>
                        <text
                          x={x + ((chartWidth - 80) / timeSeries.length) / 2 - 2}
                          y={chartHeight - 12}
                          textAnchor="middle"
                          fontSize="9"
                          fill="currentColor"
                          className="text-muted-foreground"
                        >
                          {i % 3 === 0 ? t.hour : ''}
                        </text>
                      </g>
                    );
                  })}

                  {/* Depth Line */}
                  {timeSeries.length > 1 && (
                    <polyline
                      fill="none"
                      stroke="#f59e0b"
                      strokeWidth="2.5"
                      points={timeSeries
                        .map((t, i: number) => {
                          const x = 50 + i * ((chartWidth - 80) / timeSeries.length) + ((chartWidth - 80) / timeSeries.length) / 2;
                          const y = chartHeight - 30 - (t.depth / maxDepthY) * (chartHeight - 50);
                          return `${x},${y}`;
                        })
                        .join(' ')}
                    />
                  )}

                  {/* Depth points */}
                  {timeSeries.map((t, i: number) => {
                    const x = 50 + i * ((chartWidth - 80) / timeSeries.length) + ((chartWidth - 80) / timeSeries.length) / 2;
                    const y = chartHeight - 30 - (t.depth / maxDepthY) * (chartHeight - 50);
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r="3"
                        fill="#f59e0b"
                        stroke="#18181b"
                        strokeWidth="1.5"
                      >
                        <title>{`${t.hour} - Flood Depth: ${t.depth} m`}</title>
                      </circle>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Rainfall-Aware Impact Model — MODELLED */}
            <div className="p-4 rounded-xl bg-card border border-border space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-cyan" /> Rainfall-Aware Impact Model
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Zone flood severity, road impact, and criticality-weighted infrastructure exposure —
                    real susceptibility × real per-hour GSMaP rainfall, normalized against MCGM's official
                    {' '}{BRIMSTOWAD_DESIGN_INTENSITY_MM_HR}mm/h design intensity. Not the scenario slider.
                  </p>
                </div>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">MODELLED</span>
              </div>

              {/* Current-hour KPI row */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60">
                  <p className="text-[9px] text-muted-foreground uppercase mb-1">Zone Severity (now)</p>
                  <p className={`text-sm font-bold font-mono ${
                    zoneSeverity.label === 'SEVERE' ? 'text-red' : zoneSeverity.label === 'HIGH' ? 'text-amber' :
                    zoneSeverity.label === 'MODERATE' ? 'text-yellow-500' : 'text-green'
                  }`}>{zoneSeverity.label} <span className="text-muted-foreground font-normal">({zoneSeverity.score.toFixed(2)})</span></p>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60">
                  <p className="text-[9px] text-muted-foreground uppercase mb-1">Road Impact (now)</p>
                  <p className="text-sm font-bold font-mono text-foreground">{roadImpact.highRiskCount}<span className="text-muted-foreground">/{roadImpact.count} high-risk</span></p>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60">
                  <p className="text-[9px] text-muted-foreground uppercase mb-1">Infra Exposure (now, weighted)</p>
                  <p className="text-sm font-bold font-mono text-foreground">{infraExposure.highRiskCount}<span className="text-muted-foreground">/{infraExposure.count} high-risk</span></p>
                </div>
              </div>

              {/* Time-series chart: severity / road impact / infra exposure, 0-1 scale */}
              <div className="w-full overflow-x-auto">
                <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-48 bg-muted/20 rounded-lg p-2">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => (
                    <line key={i} x1="40" y1={chartHeight - 30 - ratio * (chartHeight - 50)} x2={chartWidth - 20}
                      y2={chartHeight - 30 - ratio * (chartHeight - 50)} stroke="currentColor" className="text-border/40" strokeDasharray="4 4" />
                  ))}
                  {impactSeries.length > 1 && (['severity', 'roadImpact', 'infraExposure'] as const).map((key) => {
                    const color = key === 'severity' ? '#ef4444' : key === 'roadImpact' ? '#06b6d4' : '#a78bfa';
                    return (
                      <polyline key={key} fill="none" stroke={color} strokeWidth="2.5"
                        points={impactSeries.map((t, i: number) => {
                          const x = 50 + i * ((chartWidth - 80) / impactSeries.length) + ((chartWidth - 80) / impactSeries.length) / 2;
                          const y = chartHeight - 30 - Math.min(t[key], 1) * (chartHeight - 50);
                          return `${x},${y}`;
                        }).join(' ')}
                      >
                        <title>{key}</title>
                      </polyline>
                    );
                  })}
                  {/* Active timeline-hour marker */}
                  {impactSeries.length > 0 && (
                    <line
                      x1={50 + activeHourIndex * ((chartWidth - 80) / impactSeries.length) + ((chartWidth - 80) / impactSeries.length) / 2}
                      x2={50 + activeHourIndex * ((chartWidth - 80) / impactSeries.length) + ((chartWidth - 80) / impactSeries.length) / 2}
                      y1={20} y2={chartHeight - 30} stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.7"
                    />
                  )}
                  {impactSeries.map((t, i: number) => (
                    i % 3 === 0 ? (
                      <text key={i} x={50 + i * ((chartWidth - 80) / impactSeries.length) + ((chartWidth - 80) / impactSeries.length) / 2}
                        y={chartHeight - 12} textAnchor="middle" fontSize="9" fill="currentColor" className="text-muted-foreground">{t.hour}</text>
                    ) : null
                  ))}
                </svg>
                <div className="flex items-center gap-4 text-xs mt-1">
                  <div className="flex items-center gap-1.5"><span className="w-3 h-1 bg-red rounded inline-block" /><span className="text-muted-foreground">Zone Severity</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-3 h-1 bg-cyan rounded inline-block" /><span className="text-muted-foreground">Road Impact</span></div>
                  <div className="flex items-center gap-1.5"><span className="w-3 h-1 rounded inline-block" style={{ background: '#a78bfa' }} /><span className="text-muted-foreground">Infra Exposure (weighted)</span></div>
                  <div className="flex items-center gap-1.5 ml-auto"><span className="w-2.5 h-2.5 rounded-full border-2 border-amber-400" /><span className="text-muted-foreground">Timeline position ({realRainfallMmHr.toFixed(1)} mm/h now)</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PILOT ZONE CROSS-COMPARISON — real geometry facts only */}
        {activeTab === 'comparison' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.values(PILOT_ZONES).map((z) => {
                const infra = zoneInfra[z.id] ?? [];
                const critical = infra.filter((f) => f.properties?.status === 'CRITICAL').length;
                const atRisk = infra.filter((f) => f.properties?.status === 'AT RISK').length;
                const areaKm2 = z.bbox
                  ? ((z.bbox[2] - z.bbox[0]) * 111 * (z.bbox[3] - z.bbox[1]) * 111 * Math.cos((z.center[1] * Math.PI) / 180)).toFixed(1)
                  : 'n/a';
                return (
                  <div
                    key={z.id}
                    className={`p-4 rounded-xl border transition-all ${
                      activeZone.id === z.id ? 'bg-cyan/5 border-cyan shadow-md shadow-cyan/10' : 'bg-card border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-foreground">{z.name}</h4>
                        <p className="text-xs text-muted-foreground">[{z.center[1].toFixed(4)}°N, {z.center[0].toFixed(4)}°E]</p>
                      </div>
                      {activeZone.id === z.id && (
                        <span className="text-[10px] font-bold text-cyan bg-cyan/10 border border-cyan/20 px-2 py-0.5 rounded">SELECTED</span>
                      )}
                    </div>

                    <div className="mt-4 space-y-2.5 text-xs">
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Bounding-box area (approx.)</span>
                        <span className="font-semibold text-foreground font-mono">{areaKm2} km²</span>
                      </div>
                      <div className="flex justify-between py-1 border-b border-border/50">
                        <span className="text-muted-foreground">Real critical infrastructure (OSM/MCGM)</span>
                        <span className="font-semibold text-foreground font-mono">{infra.length} assets</span>
                      </div>
                      <div className="flex justify-between py-1">
                        <span className="text-muted-foreground">Currently flagged (simulated flood)</span>
                        <span className="font-semibold text-foreground font-mono">{critical} critical · {atRisk} at risk</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-3 italic">
                      Elevation, imperviousness, and drainage-outfall comparisons are not shown here — they require DEM and
                      hydraulic modelling data not yet available (see Data Provenance).
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 3: REAL infrastructure at risk (SIMULATED status, real assets) */}
        {activeTab === 'vulnerability' && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-card border border-border">
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-sm font-bold text-foreground">Real Critical Infrastructure — {activeZone.name}</h4>
                <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                  LOCATIONS: REAL &middot; STATUS: SIMULATED
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Every facility below is a real OpenStreetMap or MCGM-official asset. Its risk status is derived from the
                current SIMULATED flood-depth scenario (scenario multiplier / drainage blockage), not from a measured or
                observed flood.
              </p>

              <div className="space-y-2">
                {(zoneInfra[activeZone.id] ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground italic py-6 text-center">Loading real infrastructure data…</p>
                )}
                {(zoneInfra[activeZone.id] ?? [])
                  .slice()
                  .sort((a, b) => parseFloat(String(b.properties?.depthMeters ?? 0)) - parseFloat(String(a.properties?.depthMeters ?? 0)))
                  .slice(0, 8)
                  .map((item, idx) => {
                    const p = item.properties ?? {};
                    const risk = p.status as string;
                    return (
                      <div key={idx} className="p-3 rounded-lg bg-muted/40 border border-border/60 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="font-bold text-foreground truncate">{p.name}</span>
                          <span className="text-[10px] text-muted-foreground px-1.5 py-0.5 rounded bg-muted border border-border shrink-0">
                            {p.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-amber-400">{p.depthMeters}m sim.</span>
                          <span className={`px-2 py-1 rounded text-[10px] font-bold tracking-wider ${
                            risk === 'CRITICAL' ? 'bg-red-500/15 text-red-400 border border-red-500/30' :
                            risk === 'AT RISK' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                            'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          }`}>
                            {risk}
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

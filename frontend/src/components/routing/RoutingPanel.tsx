import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Route, MapPin, Navigation, AlertTriangle, Zap, Shield, Scale, RefreshCw, GitCompareArrows } from 'lucide-react';
import { DataStatusBadge } from '../common/DataStatusBadge';
import { useZoneStore } from '../../stores/useZoneStore';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useFloodSimulationFrame } from '../../api/hooks/useFloodSimulationFrame';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useRoutingStore, type LocationPoint } from '../../stores/useRoutingStore';
import { buildRoadGraph, findNearestNode, computeRoutes, computeNormalRoute, type RouteMode, type RouteResult, type NormalRouteComparison } from '../../lib/routingEngine';

const MODE_META: Record<RouteMode, { label: string; icon: React.ElementType; color: string }> = {
  fastest: { label: 'Fastest', icon: Zap, color: 'text-cyan' },
  safest: { label: 'Safest', icon: Shield, color: 'text-green' },
  balanced: { label: 'Balanced', icon: Scale, color: 'text-amber-700' },
};

function locationKey(p: LocationPoint) {
  return `${p.name}|${p.coord[0]},${p.coord[1]}`;
}

export const RoutingPanel: React.FC = () => {
  const { activeZone } = useZoneStore();
  const { floodFeatures } = useFloodData();
  // Phase 6 — the precomputed drainage-graph flood-simulation frame at the
  // currently selected T+0..180 timestep is the PRIMARY flood-depth source
  // for routing; `floodFeatures` (legacy Scenario-Mode mock polygons) is
  // only passed as a loading-state fallback inside buildRoadGraph.
  const { frame: floodSimFrame, tMin: floodSimTMin, scenario: floodSimScenario } = useFloodSimulationFrame();
  const { roadsRisk, infraRisk, effectiveRainfallMmHr, scenarioActive } = useRainfallAwareRisk();
  const {
    origin, destination, routes, normalRouteComparison, activeMode, isCalculating, lastUpdateNote, lastBlockedEdgeCount,
    setOrigin, setDestination, setRoutes, setNormalRouteComparison, setActiveMode, setCalculating, setUpdateNote, setBlockedEdgeCount,
  } = useRoutingStore();

  const [error, setError] = useState<string | null>(null);
  const prevRouteSignature = useRef<string | null>(null);

  // Real named locations for this zone — sourced from real MCGM/OSM
  // infrastructure points (data/scripts/attach_risk_scores.py), never
  // geocoded or invented. This is the only location input this app offers,
  // deliberately: free-text geocoding to arbitrary text would require a
  // service this project doesn't have and can't fabricate.
  const locations = useMemo<LocationPoint[]>(() => {
    if (!infraRisk) return [];
    return infraRisk.features
      .filter((f) => f.geometry.type === 'Point' && f.properties?.name)
      .map((f) => ({
        name: f.properties!.name as string,
        amenity: (f.properties!.amenity as string) ?? 'infrastructure',
        coord: (f.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [infraRisk]);

  // Reset origin/destination when the zone changes — a different zone's
  // road graph shares no nodes with the previous one.
  useEffect(() => {
    setOrigin(null);
    setDestination(null);
    useRoutingStore.getState().clearRoutes();
    setError(null);
  }, [activeZone.id, setOrigin, setDestination]);

  const runRouting = (isAutoUpdate: boolean) => {
    if (!origin || !destination || !roadsRisk) return;
    setError(null);
    setCalculating(true);

    // Build the real road-network graph under CURRENT flood/rainfall/timestep
    // conditions — this is what makes both Scenario Mode changes AND moving
    // the T+0..180 timeline propagate into newly-blocked/penalized segments
    // and automatic rerouting.
    const graph = buildRoadGraph(
      roadsRisk, floodSimFrame?.features ?? null, floodFeatures?.features ?? [], infraRisk, effectiveRainfallMmHr
    );
    const startNode = findNearestNode(graph, origin.coord);
    const endNode = findNearestNode(graph, destination.coord);

    if (!startNode || !endNode) {
      setError('Could not snap the selected locations onto the real road network for this zone.');
      setCalculating(false);
      return;
    }

    const result = computeRoutes(graph, startNode, endNode);
    setNormalRouteComparison(computeNormalRoute(graph, startNode, endNode));
    const signature = JSON.stringify(
      (Object.keys(result) as RouteMode[]).map((m) => {
        const r = result[m];
        return r.found ? [m, r.distanceKm.toFixed(2), r.avoidedRoads.length] : [m, 'none'];
      })
    );

    if (isAutoUpdate && prevRouteSignature.current && signature !== prevRouteSignature.current) {
      setUpdateNote(
        lastBlockedEdgeCount !== null && graph.blockedEdges !== lastBlockedEdgeCount
          ? `Route updated — ${graph.blockedEdges} road segment(s) now flooded in this zone (was ${lastBlockedEdgeCount}).`
          : 'Route updated — flood conditions changed.'
      );
    } else if (!isAutoUpdate) {
      setUpdateNote(null);
    }
    prevRouteSignature.current = signature;
    setBlockedEdgeCount(graph.blockedEdges);

    setRoutes(result, activeZone.id);
    setCalculating(false);
  };

  const handleCalculate = () => runRouting(false);

  // Scenario Mode / rainfall / TIMESTEP reactivity: automatically recompute
  // whenever any flood-driving input changes (including moving the T+0..180
  // timeline, via floodSimTMin/floodSimScenario), IF a route already exists.
  // Example: T+0 -> normal route; by T+90 a road floods; by T+120 the engine
  // reroutes around it.
  const autoRecomputeKey = `${activeZone.id}|${effectiveRainfallMmHr.toFixed(1)}|${floodFeatures?.features.length ?? 0}|${floodSimTMin}|${floodSimScenario}`;
  const prevAutoKey = useRef(autoRecomputeKey);
  useEffect(() => {
    if (prevAutoKey.current === autoRecomputeKey) return;
    prevAutoKey.current = autoRecomputeKey;
    if (origin && destination && roadsRisk) {
      runRouting(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRecomputeKey]);

  const activeResult = routes?.[activeMode];

  return (
    <div className="bg-card text-card-foreground p-4 rounded-xl border border-border shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-green">
          <Route size={16} />
          <h2>FLOOD-AWARE SAFE ROUTING</h2>
        </div>
        <DataStatusBadge status="MODELLED" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <div className="absolute left-3 top-3">
            <MapPin size={14} className="text-muted-foreground" />
          </div>
          <select
            value={origin ? locationKey(origin) : ''}
            onChange={(e) => setOrigin(locations.find((l) => locationKey(l) === e.target.value) ?? null)}
            className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground focus:outline-none focus:border-cyan appearance-none"
          >
            <option value="">Select origin (real location)…</option>
            {locations.map((l, i) => (
              <option key={`${locationKey(l)}-${i}`} value={locationKey(l)}>{l.name}</option>
            ))}
          </select>
        </div>

        <div className="relative">
          <div className="absolute left-3 top-3">
            <Navigation size={14} className="text-cyan" />
          </div>
          <select
            value={destination ? locationKey(destination) : ''}
            onChange={(e) => setDestination(locations.find((l) => locationKey(l) === e.target.value) ?? null)}
            className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground focus:outline-none focus:border-cyan appearance-none"
          >
            <option value="">Select destination (real location)…</option>
            {locations.map((l, i) => (
              <option key={`${locationKey(l)}-${i}`} value={locationKey(l)}>{l.name}</option>
            ))}
          </select>
        </div>

        <p className="text-[9px] text-muted-foreground -mt-1">
          Locations are real MCGM/OSM infrastructure points — free-text geocoding isn't available, so no location is ever guessed.
        </p>

        <button
          onClick={handleCalculate}
          disabled={isCalculating || !origin || !destination}
          className="mt-1 w-full bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          {isCalculating ? 'Calculating flood-aware routes…' : 'Calculate Route'}
        </button>

        {error && <p className="text-[10px] text-red-700">{error}</p>}

        {lastUpdateNote && (
          <div className="flex items-start gap-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/25">
            <RefreshCw className="w-3 h-3 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-[9px] text-amber-700 leading-relaxed">{lastUpdateNote}</p>
          </div>
        )}

        {routes && (
          <>
            <div className="grid grid-cols-3 gap-1.5 mt-1">
              {(['fastest', 'safest', 'balanced'] as RouteMode[]).map((mode) => {
                const meta = MODE_META[mode];
                const Icon = meta.icon;
                const r = routes[mode];
                return (
                  <button
                    key={mode}
                    onClick={() => setActiveMode(mode)}
                    className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${
                      activeMode === mode ? 'bg-muted border-cyan/50' : 'bg-background border-border/60 hover:bg-muted/50'
                    } ${!r.found ? 'opacity-50' : ''}`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                    {meta.label}
                    {!r.found && <span className="text-red-700">✕</span>}
                  </button>
                );
              })}
            </div>

            {activeResult && (
              activeResult.found ? (
                <RouteDetail result={activeResult} scenarioActive={scenarioActive} />
              ) : (
                <div className="mt-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center">
                  <AlertTriangle className="w-5 h-5 text-red-700 mx-auto mb-1" />
                  <p className="text-xs font-bold text-red-700">No safe route available</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{activeResult.reason}</p>
                </div>
              )
            )}

            {normalRouteComparison && activeResult?.found && (
              <NormalRouteComparisonCard
                normal={normalRouteComparison}
                floodAware={activeResult}
                tMin={floodSimTMin}
                scenario={floodSimScenario}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

const RouteDetail: React.FC<{ result: Extract<RouteResult, { found: true }>; scenarioActive: boolean }> = ({ result, scenarioActive }) => {
  const riskColor = result.riskLabel === 'SEVERE' ? 'text-red' : result.riskLabel === 'HIGH' ? 'text-amber' :
    result.riskLabel === 'MODERATE' ? 'text-yellow-700' : 'text-green';
  return (
    <div className="mt-1 p-3 bg-muted/40 border border-border/60 rounded-lg space-y-2">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[9px] text-muted-foreground uppercase">Length</p>
          <p className="text-xs font-mono font-bold text-foreground">{result.distanceKm.toFixed(2)}km</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase">ETA <span className="text-blue-700">(modelled)</span></p>
          <p className="text-xs font-mono font-bold text-foreground">{Math.round(result.etaMinutes)}min</p>
        </div>
        <div>
          <p className="text-[9px] text-muted-foreground uppercase">Risk</p>
          <p className={`text-xs font-mono font-bold ${riskColor}`}>{result.riskLabel} ({result.estimatedRiskScore.toFixed(2)})</p>
        </div>
      </div>
      <p className="text-[9px] text-muted-foreground">
        {result.segmentsTraversed} real road segments · {result.highRiskSegmentsTraversed} high-risk ·
        rainfall input {scenarioActive ? 'SIMULATED (scenario)' : 'real (OBSERVED)'}
      </p>
      {result.avoidedRoads.length > 0 ? (
        <div>
          <p className="text-[9px] text-muted-foreground uppercase mb-1">Roads avoided vs. fastest route</p>
          <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
            {result.avoidedRoads.map((a, i) => (
              <div key={i} className="text-[9px] px-1.5 py-1 rounded bg-background/60 border border-border/40">
                <span className="font-semibold text-foreground">{a.name}</span>
                <span className="text-muted-foreground"> — {a.reason}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[9px] text-muted-foreground italic">No roads needed to be avoided — this route matches the fastest path.</p>
      )}
      <p className="text-[8px] text-muted-foreground/70 pt-1 border-t border-border/40">
        Route geometry: REAL (OSM). Risk weighting: MODELLED (real susceptibility × rainfall). Blocked segments: SIMULATED
        (flood-depth proxy). ETA: MODELLED (assumed road-class speeds, not real traffic). Not for operational use — verify
        with official NDRF/MCGM guidance.
      </p>
    </div>
  );
};

// Phase 6 — "NORMAL ROUTE vs FLOOD-AWARE SAFE ROUTE": shows what a
// flood-blind route would have done differently from the active flood-aware
// route, using the SAME precomputed T+0..180 flood-simulation frame that
// drives the map's flood layer (never a separately-fabricated comparison).
const NormalRouteComparisonCard: React.FC<{
  normal: NormalRouteComparison;
  floodAware: Extract<RouteResult, { found: true }>;
  tMin: number;
  scenario: string;
}> = ({ normal, floodAware, tMin, scenario }) => {
  if (!normal.normalRoute.found) {
    return null; // same connectivity gap the flood-aware route already reported
  }
  const n = normal.normalRoute;
  const extraKm = floodAware.distanceKm - n.distanceKm;
  const extraMin = floodAware.etaMinutes - n.etaMinutes;
  const differs = Math.abs(extraKm) > 0.01;

  return (
    <div className="mt-1 p-3 bg-background/60 border border-border/60 rounded-lg space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-foreground uppercase tracking-wide">
        <GitCompareArrows className="w-3 h-3 text-muted-foreground" />
        Normal route vs. flood-aware route &middot; T+{tMin}min ({scenario === 'design_storm' ? 'SIMULATED design storm' : 'OBSERVED, dry'})
      </div>
      {normal.floodedSegmentsOnNormalRoute > 0 ? (
        <p className="text-[9px] text-red-700">
          The flood-blind normal route crosses {normal.floodedSegmentsOnNormalRoute} segment(s) at HIGH/SEVERE simulated
          flood depth at this timestep — the flood-aware route reroutes around {differs ? `them (+${extraKm.toFixed(2)}km, +${Math.round(extraMin)}min)` : 'them'}.
        </p>
      ) : (
        <p className="text-[9px] text-muted-foreground">
          No HIGH/SEVERE flooding on the normal route&apos;s path at this timestep — the two routes {differs ? 'still differ slightly due to risk-cost weighting.' : 'coincide.'}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 text-center pt-1">
        <div>
          <p className="text-[8px] text-muted-foreground uppercase">Normal (flood-blind)</p>
          <p className="text-[11px] font-mono text-foreground">{n.distanceKm.toFixed(2)}km &middot; {Math.round(n.etaMinutes)}min</p>
        </div>
        <div>
          <p className="text-[8px] text-muted-foreground uppercase">Flood-aware ({floodAware.mode})</p>
          <p className="text-[11px] font-mono text-foreground">{floodAware.distanceKm.toFixed(2)}km &middot; {Math.round(floodAware.etaMinutes)}min</p>
        </div>
      </div>
    </div>
  );
};

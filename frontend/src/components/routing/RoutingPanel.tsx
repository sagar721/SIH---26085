import React, { useEffect, useMemo, useState } from 'react';
import { Route, MapPin, Navigation, AlertTriangle, Zap, Shield, Scale, RefreshCw, GitCompareArrows, CloudRain, ShieldCheck, Clock, Ban, Globe2, ShieldAlert, Waves } from 'lucide-react';
import { DataStatusBadge } from '../common/DataStatusBadge';
import { useZoneStore } from '../../stores/useZoneStore';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useFloodSimulationFrame } from '../../api/hooks/useFloodSimulationFrame';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { useRoutingStore } from '../../stores/useRoutingStore';
import { computeAndStoreSafeRoutes } from '../../lib/computeSafeRoute';
import { buildLandmarkIndex } from '../../lib/geocoding';
import { realAdapter } from '../../api/adapters/RealDataAdapter';
import { findFloodDepthAtSimNodes, destinationFloodWarning } from '../../lib/routingEngine';
import type { RouteMode, RouteResult, NormalRouteComparison } from '../../lib/routingEngine';
import { LocationAutocomplete } from './LocationAutocomplete';
import type { FeatureCollection } from 'geojson';

const MODE_META: Record<RouteMode, { label: string; icon: React.ElementType; color: string }> = {
  fastest: { label: 'Fastest', icon: Zap, color: 'text-cyan' },
  safest: { label: 'Safest', icon: Shield, color: 'text-green' },
  balanced: { label: 'Balanced', icon: Scale, color: 'text-amber-700' },
};

const WARNING_STYLE: Record<string, { bg: string; text: string }> = {
  LOW: { bg: 'bg-yellow-500/10 border-yellow-500/30', text: 'text-yellow-700' },
  MEDIUM: { bg: 'bg-amber-500/10 border-amber-500/30', text: 'text-amber-700' },
  HIGH: { bg: 'bg-orange-500/10 border-orange-500/30', text: 'text-orange-700' },
  CRITICAL: { bg: 'bg-red-500/10 border-red-500/30', text: 'text-red-700' },
};

export const RoutingPanel: React.FC = () => {
  const { activeZone } = useZoneStore();
  const { floodFeatures } = useFloodData();
  const { frame: floodSimFrame, tMin: floodSimTMin, scenario: floodSimScenario } = useFloodSimulationFrame();
  const { roadsRisk, infraRisk, effectiveRainfallMmHr, scenarioActive } = useRainfallAwareRisk();
  const { drainageBlockage, mode } = useSimulationStore();
  const isDemo = mode === 'demo';
  const {
    origin, destination, routes, normalRouteComparison, activeMode, isCalculating, lastUpdateNote,
    lastBlockedEdgeCount, lastTotalEdgeCount, externalRoute, usedExpandedSnap,
    setOrigin, setDestination, setActiveMode,
  } = useRoutingStore();

  const [error, setError] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<FeatureCollection | null>(null);
  // Coordinates the two stacked autocomplete fields so only one dropdown is
  // ever open at a time — found via live browser testing that an open
  // Origin dropdown could visually overlap and intercept clicks meant for
  // the Destination field directly below it.
  const [activeField, setActiveField] = useState<'origin' | 'destination' | null>(null);

  // Local search index — real infrastructure (traffic-signal-style generic
  // OSM nodes excluded entirely, never just deprioritized — see
  // lib/geocoding.ts), real named roads, real named buildings. Nominatim
  // (no API key) fills in anything not already in this zone's own data.
  useEffect(() => {
    let cancelled = false;
    realAdapter.getBuildingsData(activeZone.id).then((fc) => { if (!cancelled) setBuildings(fc); });
    return () => { cancelled = true; };
  }, [activeZone.id]);

  const landmarkIndex = useMemo(
    () => buildLandmarkIndex(infraRisk, roadsRisk, buildings),
    [infraRisk, roadsRisk, buildings]
  );

  // Zone changes are already handled by the always-mounted
  // useAutoRouteRecompute hook (CommandCenter.tsx), which clears
  // origin/destination/routes the instant the zone changes regardless of
  // whether this panel is even open. This just clears the panel's own
  // local error message so it doesn't linger across a zone switch.
  useEffect(() => {
    setError(null);
  }, [activeZone.id]);

  const handleCalculate = async () => {
    if (!origin || !destination || !roadsRisk) return;
    setError(null);
    const { error: calcError } = await computeAndStoreSafeRoutes({
      zoneId: activeZone.id,
      origin,
      destination,
      roadsRisk,
      floodSimFeatures: floodSimFrame?.features ?? null,
      legacyFloodFeatures: floodFeatures?.features ?? [],
      infraRisk,
      effectiveRainfallMmHr,
      isAutoUpdate: false,
    });
    if (calcError) setError(calcError);
  };

  const activeResult = routes?.[activeMode];
  const floodedPct = lastTotalEdgeCount && lastTotalEdgeCount > 0 && lastBlockedEdgeCount !== null
    ? (lastBlockedEdgeCount / lastTotalEdgeCount) * 100 : null;

  // Destination flood warning — same depth source routing itself uses, so
  // "is this destination safe" can never disagree with "is the route safe".
  const destWarning = useMemo(() => {
    if (!destination || !floodSimFrame) return null;
    const depth = findFloodDepthAtSimNodes(destination.coord, floodSimFrame.features);
    return destinationFloodWarning(depth);
  }, [destination, floodSimFrame]);

  // "Primary route unsafe" storytelling: the naive/fastest choice is
  // HIGH-or-worse risk, but a meaningfully safer alternative exists.
  const fastestUnsafe = routes?.fastest?.found && (routes.fastest.riskLabel === 'HIGH' || routes.fastest.riskLabel === 'SEVERE');
  const safestBetter = routes?.safest?.found && routes.fastest?.found &&
    routes.safest.estimatedRiskScore < routes.fastest.estimatedRiskScore - 0.05;

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
        <LocationAutocomplete
          value={origin}
          onSelect={setOrigin}
          placeholder="Origin — type any place, landmark, road, address…"
          icon={<MapPin size={14} className="text-muted-foreground" />}
          index={landmarkIndex}
          forceClose={activeField === 'destination'}
          onOpen={() => setActiveField('origin')}
        />
        <LocationAutocomplete
          value={destination}
          onSelect={setDestination}
          placeholder="Destination — type any place, landmark, road, address…"
          icon={<Navigation size={14} className="text-cyan" />}
          index={landmarkIndex}
          forceClose={activeField === 'origin'}
          onOpen={() => setActiveField('destination')}
        />

        <p className="text-[9px] text-muted-foreground -mt-1">
          Searches real MCGM/OSM infrastructure, roads, and buildings first; anything not found locally is looked up via
          OpenStreetMap's Nominatim geocoder. Works in {isDemo ? 'Demo' : 'Live'} Mode regardless of current rainfall.
        </p>

        <button
          onClick={handleCalculate}
          disabled={isCalculating || !origin || !destination}
          className="mt-1 w-full bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          {isCalculating ? 'Calculating flood-aware routes…' : 'Calculate Route'}
        </button>

        {error && <p className="text-[10px] text-red-700">{error}</p>}

        {destWarning && (
          <div className={`flex items-start gap-1.5 p-2 rounded border ${WARNING_STYLE[destWarning.level].bg}`}>
            <Waves className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${WARNING_STYLE[destWarning.level].text}`} />
            <p className={`text-[10px] leading-relaxed ${WARNING_STYLE[destWarning.level].text}`}>
              <span className="font-bold">{destWarning.level}: </span>
              {destWarning.message} (simulated depth {destWarning.depthM.toFixed(2)}m)
            </p>
          </div>
        )}

        {isDemo && lastUpdateNote && (
          <div className="flex items-start gap-1.5 p-2 rounded bg-primary/10 border border-primary/30">
            <RefreshCw className="w-3 h-3 text-primary shrink-0 mt-0.5" />
            <p className="text-[10px] text-primary leading-relaxed">
              <span className="font-bold">Flood conditions have altered the recommended route.</span> {lastUpdateNote}
            </p>
          </div>
        )}
        {!isDemo && lastUpdateNote && (
          <div className="flex items-start gap-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/25">
            <RefreshCw className="w-3 h-3 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-[9px] text-amber-700 leading-relaxed">{lastUpdateNote}</p>
          </div>
        )}

        {usedExpandedSnap && routes && (
          <p className="text-[9px] text-amber-700 flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 shrink-0" /> One endpoint is a bit outside this zone's mapped road network — snapped to the nearest real road.
          </p>
        )}

        {fastestUnsafe && safestBetter && activeMode === 'fastest' && (
          <div className="flex items-start gap-1.5 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30">
            <AlertTriangle className="w-3.5 h-3.5 text-red-700 shrink-0 mt-0.5" />
            <div className="text-[10px] text-red-700 leading-relaxed">
              <p className="font-bold">Primary route unsafe.</p>
              <p>Alternative safe route recommended.</p>
              <button
                onClick={() => setActiveMode('safest')}
                className="mt-1 px-2 py-1 rounded bg-red-700 text-white text-[9px] font-semibold uppercase tracking-wide"
              >
                Switch to Safest route
              </button>
            </div>
          </div>
        )}

        {externalRoute && (
          <div className="mt-1 p-3 bg-muted/40 border border-border/60 rounded-lg space-y-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 uppercase tracking-wide">
              <Globe2 className="w-3.5 h-3.5" /> External routing fallback used
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              This zone's local flood-aware road graph could not connect these two points (likely outside the mapped
              pilot-zone road network), so a route was generated via {externalRoute.provider} instead.
              <span className="font-semibold text-foreground"> This route is NOT flood-aware</span> — it has no knowledge of this app's simulated flood conditions.
            </p>
            <div className="grid grid-cols-2 gap-2 text-center pt-1">
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">Length</p>
                <p className="text-xs font-mono font-bold text-foreground">{externalRoute.distanceKm.toFixed(2)}km</p>
              </div>
              <div>
                <p className="text-[9px] text-muted-foreground uppercase">ETA</p>
                <p className="text-xs font-mono font-bold text-foreground">{Math.round(externalRoute.etaMinutes)}min</p>
              </div>
            </div>
          </div>
        )}

        {routes && (
          <>
            {/* "Explain every route": a compare-before-you-pick strip so a
                dispatcher can see all three options at once, not just
                whichever tab happens to be selected. */}
            <div className="grid grid-cols-3 gap-1.5 mt-1">
              {(['fastest', 'safest', 'balanced'] as RouteMode[]).map((m) => {
                const meta = MODE_META[m];
                const Icon = meta.icon;
                const r = routes[m];
                return (
                  <button
                    key={m}
                    onClick={() => setActiveMode(m)}
                    className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors ${
                      activeMode === m ? 'bg-muted border-cyan/50' : 'bg-background border-border/60 hover:bg-muted/50'
                    } ${!r.found ? 'opacity-50' : ''}`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${meta.color}`} />
                    {meta.label}
                    {r.found ? (
                      <span className="text-[8px] font-mono text-muted-foreground">{Math.round(r.etaMinutes)}min · {r.riskLabel}</span>
                    ) : (
                      <span className="text-red-700">✕ no route</span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeResult && (
              activeResult.found ? (
                <RouteExplanation
                  result={activeResult}
                  allRoutes={routes}
                  normalRouteComparison={normalRouteComparison}
                  scenarioActive={scenarioActive}
                  effectiveRainfallMmHr={effectiveRainfallMmHr}
                  drainageBlockage={drainageBlockage}
                  floodSimTMin={floodSimTMin}
                  floodSimScenario={floodSimScenario}
                  blockedEdges={lastBlockedEdgeCount}
                  totalEdges={lastTotalEdgeCount}
                  floodedPct={floodedPct}
                />
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

// Signed percentage phrasing shared by the risk-reduction callouts below —
// a negative value is reported honestly ("more risk"), never hidden or
// clamped to zero, since occasionally a flood-blind shortest path can
// happen to cross less-susceptible roads than a longer flood-aware one.
function reductionPhrase(pct: number | null, comparedTo: string): string {
  if (pct === null) return `No comparable ${comparedTo} risk score is available.`;
  if (pct >= 0.5) return `${pct.toFixed(0)}% lower modelled flood risk than ${comparedTo}.`;
  if (pct <= -0.5) return `${Math.abs(pct).toFixed(0)}% higher modelled flood risk than ${comparedTo} (still the requested route).`;
  return `About the same modelled flood risk as ${comparedTo}.`;
}

const RouteExplanation: React.FC<{
  result: Extract<RouteResult, { found: true }>;
  allRoutes: Record<RouteMode, RouteResult>;
  normalRouteComparison: NormalRouteComparison | null;
  scenarioActive: boolean;
  effectiveRainfallMmHr: number;
  drainageBlockage: number;
  floodSimTMin: number;
  floodSimScenario: string;
  blockedEdges: number | null;
  totalEdges: number | null;
  floodedPct: number | null;
}> = ({
  result, allRoutes, normalRouteComparison, scenarioActive, effectiveRainfallMmHr, drainageBlockage,
  floodSimTMin, floodSimScenario, blockedEdges, totalEdges, floodedPct,
}) => {
  const riskColor = result.riskLabel === 'SEVERE' ? 'text-red' : result.riskLabel === 'HIGH' ? 'text-amber' :
    result.riskLabel === 'MODERATE' ? 'text-yellow-700' : 'text-green';
  const meta = MODE_META[result.mode];
  const normalFound = normalRouteComparison?.normalRoute.found ? normalRouteComparison.normalRoute : null;
  const rainfallLabel = scenarioActive ? 'SIMULATED (Scenario Mode design-storm)' : 'real, OBSERVED';

  return (
    <div className="mt-1 p-3 bg-muted/40 border border-border/60 rounded-lg space-y-3">
      {/* 1. Explain every route — a plain-language summary of THIS route,
          whichever of the three is currently selected. */}
      <p className="text-[10.5px] text-foreground leading-relaxed">
        <span className={`font-semibold ${meta.color}`}>{meta.label} route:</span>{' '}
        {result.distanceKm.toFixed(2)}km over {result.segmentsTraversed} real road segments, ~{Math.round(result.etaMinutes)} min at
        modelled road-class speeds, carrying <span className={`font-semibold ${riskColor}`}>{result.riskLabel}</span> overall flood
        risk ({result.estimatedRiskScore.toFixed(2)}/1.00). This route crosses {result.floodedSegmentsOnPath} flooded road segment{result.floodedSegmentsOnPath === 1 ? '' : 's'}
        {result.floodedSegmentsOnPath > 0
          ? ' at elevated (HIGH) simulated flood depth, because no unblocked alternative exists'
          : ''}.
      </p>

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
        {result.segmentsTraversed} real road segments · {result.highRiskSegmentsTraversed} high-risk · rainfall input {rainfallLabel}
      </p>

      {/* 3. Explain risk reduction */}
      <div className="flex items-start gap-1.5 pt-1 border-t border-border/40">
        <ShieldCheck className="w-3.5 h-3.5 text-green shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Risk reduction: </span>
          {reductionPhrase(result.riskReductionVsNormalPct, 'a flood-blind route')}
          {result.mode !== 'fastest' && (
            <> {reductionPhrase(result.riskReductionVsFastestPct, `this zone's Fastest option`)}</>
          )}
          {normalFound && (
            <span className="block mt-0.5 text-[9px] text-muted-foreground/80">
              Scores: this route {result.estimatedRiskScore.toFixed(2)} · flood-blind route {normalFound.estimatedRiskScore.toFixed(2)}
              {result.mode !== 'fastest' ? ` · Fastest ${allRoutes.fastest.found ? allRoutes.fastest.estimatedRiskScore.toFixed(2) : 'n/a'}` : ''}
              {' '}(0 = no modelled risk, 1 = maximum).
            </span>
          )}
        </p>
      </div>

      {/* 4. Explain travel-time penalty */}
      <div className="flex items-start gap-1.5">
        <Clock className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Travel-time penalty: </span>
          {result.mode === 'fastest' ? (
            <>This is this zone's fastest flood-aware option.</>
          ) : Math.abs(result.timePenaltyVsFastestMin) < 0.5 ? (
            <>No meaningful time cost versus Fastest — the safer routing didn&apos;t need a detour this time.</>
          ) : (
            <>+{Math.round(result.timePenaltyVsFastestMin)} min versus this zone&apos;s Fastest route, in exchange for the risk reduction above.</>
          )}
          {normalFound && result.timePenaltyVsNormalMin !== null && Math.abs(result.timePenaltyVsNormalMin) >= 0.5 && (
            <> Versus a flood-blind route: {result.timePenaltyVsNormalMin > 0 ? '+' : ''}{Math.round(result.timePenaltyVsNormalMin)} min.</>
          )}
        </p>
      </div>

      {/* 5. Explain flood reasoning */}
      <div className="flex items-start gap-1.5">
        <CloudRain className="w-3.5 h-3.5 text-cyan shrink-0 mt-0.5" />
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="font-semibold text-foreground">Why roads are flooded here: </span>
          At T+{floodSimTMin}min ({floodSimScenario === 'design_storm' ? 'SIMULATED design storm' : 'OBSERVED, dry'}), under {effectiveRainfallMmHr.toFixed(1)}mm/hr
          {' '}{rainfallLabel} rainfall{drainageBlockage > 0 ? ` and a ${drainageBlockage}% drainage-blockage scenario` : ''},{' '}
          {blockedEdges !== null && totalEdges ? (
            <>{blockedEdges} of {totalEdges} real road segments in this zone ({floodedPct?.toFixed(1)}%) are simulated at or beyond the
            {' '}0.5m vehicle-impassable depth and excluded from every route.</>
          ) : (
            <>road segments are excluded once their simulated depth reaches the 0.5m vehicle-impassable threshold.</>
          )}
          {' '}Depths come from the drainage-graph flood-propagation model (SIMULATED); each segment&apos;s underlying susceptibility score
          is REAL, DEM/landcover/waterway-derived.
        </p>
      </div>

      {/* 2. Explain avoided roads, with estimated flood depth per segment */}
      {result.avoidedRoads.length > 0 ? (
        <div className="pt-1 border-t border-border/40">
          <div className="flex items-center gap-1.5 mb-1">
            <Ban className="w-3.5 h-3.5 text-red-700 shrink-0" />
            <p className="text-[9px] text-muted-foreground uppercase tracking-wide">
              {result.avoidedRoads.length} road{result.avoidedRoads.length === 1 ? '' : 's'} avoided vs. a flood-blind route
            </p>
          </div>
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
        <p className="text-[9px] text-muted-foreground italic pt-1 border-t border-border/40">
          No roads needed to be avoided — even a flood-blind route wouldn&apos;t cross any flooded or high-risk segment right now.
        </p>
      )}

      <p className="text-[8px] text-muted-foreground/70 pt-1 border-t border-border/40">
        Route geometry: REAL (OSM). Risk weighting: MODELLED (real susceptibility × rainfall). Blocked segments: SIMULATED
        (flood-depth proxy). ETA: MODELLED (assumed road-class speeds, not real traffic). Not for operational use — verify
        with official NDRF/MCGM guidance.
      </p>
    </div>
  );
};

// "NORMAL ROUTE vs FLOOD-AWARE SAFE ROUTE": shows what a flood-blind route
// would have done differently from the active flood-aware route, using the
// SAME precomputed T+0..180 flood-simulation frame that drives the map's
// flood layer (never a separately-fabricated comparison).
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
        Normal route (grey) vs. flood-aware route ({floodAware.mode === 'safest' ? 'green' : 'blue'}) &middot; T+{tMin}min ({scenario === 'design_storm' ? 'SIMULATED design storm' : 'OBSERVED, dry'})
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
      <div className="grid grid-cols-2 gap-2 text-center pt-1 border-t border-border/40">
        <div>
          <p className="text-[8px] text-muted-foreground uppercase">Flood exposure avoided</p>
          <p className="text-[11px] font-mono text-foreground">{normal.floodedSegmentsOnNormalRoute} segment(s)</p>
        </div>
        <div>
          <p className="text-[8px] text-muted-foreground uppercase">Roads avoided</p>
          <p className="text-[11px] font-mono text-foreground">{floodAware.avoidedRoads.length}</p>
        </div>
      </div>
    </div>
  );
};

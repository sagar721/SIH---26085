import React, { useState } from 'react';
import { CloudRain, Route, Home, ListChecks, Bell, MapPin, Phone } from 'lucide-react';
import { useZoneStore } from '../../stores/useZoneStore';
import { useFloodData } from '../../api/hooks/useFloodData';
import { useRainfallAwareRisk } from '../../api/hooks/useRainfallAwareRisk';
import { PILOT_ZONES } from '../../types';
import { haversineKm } from '../../lib/haversine';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { generateSituationBrief } from '../../lib/situationBrief';
import { computeCapacityMargin } from '../../lib/riskModel';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { MapContainer } from '../map/MapContainer';
import { RoutingPanel } from '../routing/RoutingPanel';

type Tile = 'route' | 'shelters' | 'checklist' | 'alerts' | null;
interface SafePlace { name: string; amenity: string; distKm: number }

const SHELTER_AMENITIES = new Set(['school', 'public_facility']);

const CHECKLIST = [
  'Keep mobile phone charged and a power bank ready.',
  'Move vehicles and valuables to higher ground if you are in a known low-lying area.',
  'Avoid walking or driving through moving water — 0.3m can float a car.',
  'Keep drinking water, medicines, and torch accessible.',
  'Follow MCGM/NDRF advisories rather than word-of-mouth reports.',
];

const SafePlacesList: React.FC<{ places: SafePlace[]; columns?: 1 | 2 }> = ({ places, columns = 1 }) => (
  <div className={columns === 2 ? 'grid grid-cols-2 gap-2' : 'flex flex-col gap-2'}>
    {places.length === 0 ? (
      <p className={`text-[11px] text-muted-foreground italic py-3 text-center ${columns === 2 ? 'col-span-2' : ''}`}>
        No real named locations loaded for this zone yet.
      </p>
    ) : (
      places.map((p, i) => (
        <div key={`${p.name}-${i}`} className="flex items-center gap-2.5 rounded-xl border border-border bg-background p-2.5">
          <div className="w-8 h-8 rounded-lg bg-green/10 flex items-center justify-center shrink-0"><MapPin className="w-3.5 h-3.5 text-green" /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-foreground truncate">{p.name}</div>
            <div className="text-[10px] text-muted-foreground capitalize">{p.amenity.replace('_', ' ')}</div>
          </div>
          <div className="text-right font-mono text-[11px] font-semibold text-foreground shrink-0">{p.distKm.toFixed(1)} km</div>
        </div>
      ))
    )}
  </div>
);

export const CitizenView: React.FC = () => {
  const { activeZone } = useZoneStore();
  const { riskSummary, infraFeatures } = useFloodData();
  const { zoneSeverity, roadImpact, infraExposure, realRainfallMmHr, effectiveRainfallMmHr, scenarioActive } = useRainfallAwareRisk();
  const { drainageBlockage } = useSimulationStore();
  const [tile, setTile] = useState<Tile>(null);
  // Real breakpoint check, not CSS display:none — CitizenView must only
  // ever mount ONE MapContainer at a time (a real MapLibre/WebGL instance
  // with its own tile fetches), never one hidden desktop copy plus one
  // hidden mobile copy sitting in the DOM simultaneously.
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const affectedRoadNames: string[] = [];
  const affectedAssetNames = (infraFeatures?.features ?? [])
    .filter((f) => f.properties?.status !== 'SAFE')
    .map((f) => f.properties?.name)
    .filter(Boolean) as string[];

  const brief = generateSituationBrief({
    zoneName: activeZone.name.split('–')[0],
    rainfallDataAvailable: riskSummary?.rainfallDataAvailable ?? false,
    realRainfallMmHr, effectiveRainfallMmHr, scenarioActive,
    drainageBlockagePct: drainageBlockage,
    capacityMargin: computeCapacityMargin(effectiveRainfallMmHr, drainageBlockage),
    etaMinutes: null,
    zoneSeverity, roadImpact, infraExposure,
    affectedRoadNames, affectedAssetNames,
  });

  const severityStyle = zoneSeverity.label === 'SEVERE' || zoneSeverity.label === 'HIGH'
    ? 'bg-red/10 border-red/25 text-red'
    : zoneSeverity.label === 'MODERATE'
    ? 'bg-amber/10 border-amber/25 text-amber'
    : 'bg-green/10 border-green/25 text-green';

  // Only amenity types a citizen would actually want as a "safe place" —
  // the real infra dataset also includes things like traffic signals and
  // substations (correctly named, real OSM data) that are not meaningful
  // evacuation/shelter destinations and would otherwise show up as the
  // "nearest" result purely by coordinate proximity.
  const SAFE_PLACE_AMENITIES = new Set(['hospital', 'fire_station', 'police', 'school', 'public_facility', 'railway', 'metro']);
  const nearestPlaces: SafePlace[] = (infraFeatures?.features ?? [])
    .filter((f) => f.geometry.type === 'Point' && f.properties?.name && SAFE_PLACE_AMENITIES.has(f.properties?.amenity as string))
    .map((f) => {
      const coord = (f.geometry as { type: 'Point'; coordinates: [number, number] }).coordinates;
      return { name: f.properties!.name as string, amenity: (f.properties!.amenity as string) ?? 'facility', distKm: haversineKm(activeZone.center, coord) };
    })
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 6);

  const shelters = nearestPlaces.filter((p) => SHELTER_AMENITIES.has(p.amenity));
  const safePlacesShown = tile === 'shelters' ? shelters : nearestPlaces;

  const actionTiles = (
    <div className="grid grid-cols-2 gap-2.5">
      <button onClick={() => setTile(tile === 'route' ? null : 'route')} className={`rounded-2xl p-3.5 text-left transition-colors ${tile === 'route' ? 'bg-primary text-primary-foreground' : 'bg-primary/90 text-primary-foreground'}`}>
        <Route className="w-4 h-4 mb-4 opacity-90" />
        <div className="text-[13px] font-bold">Safe route</div>
        <div className="text-[10px] opacity-75 mt-0.5">Real flood-aware routing</div>
      </button>
      <button onClick={() => setTile(tile === 'shelters' ? null : 'shelters')} className={`rounded-2xl p-3.5 text-left border transition-colors ${tile === 'shelters' ? 'bg-muted border-border' : 'bg-background border-border'}`}>
        <Home className="w-4 h-4 mb-4 text-muted-foreground" />
        <div className="text-[13px] font-bold text-foreground">Shelters</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{shelters.length} nearby (real OSM/MCGM)</div>
      </button>
      <button onClick={() => setTile(tile === 'checklist' ? null : 'checklist')} className={`rounded-2xl p-3.5 text-left border transition-colors ${tile === 'checklist' ? 'bg-muted border-border' : 'bg-background border-border'}`}>
        <ListChecks className="w-4 h-4 mb-4 text-muted-foreground" />
        <div className="text-[13px] font-bold text-foreground">What to do</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Preparedness checklist</div>
      </button>
      <button onClick={() => setTile(tile === 'alerts' ? null : 'alerts')} className={`rounded-2xl p-3.5 text-left border transition-colors ${tile === 'alerts' ? 'bg-muted border-border' : 'bg-background border-border'}`}>
        <Bell className="w-4 h-4 mb-4 text-muted-foreground" />
        <div className="text-[13px] font-bold text-foreground">Alerts</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">Current zone risk detail</div>
      </button>
    </div>
  );

  const tileDetail = (
    <>
      {tile === 'route' && <RoutingPanel />}
      {tile === 'checklist' && (
        <div className="rounded-2xl border border-border bg-background p-4">
          <ul className="text-[12px] text-foreground/90 space-y-2 list-disc list-inside leading-relaxed">
            {CHECKLIST.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
      {tile === 'alerts' && (
        <div className="rounded-2xl border border-border bg-background p-4 text-[12px] text-foreground/90 space-y-1.5">
          <div>Zone severity: <b>{zoneSeverity.label}</b> ({zoneSeverity.score.toFixed(2)})</div>
          <div>Road impact: <b>{roadImpact.highRiskCount}/{roadImpact.count}</b> segments high-risk</div>
          <div>Infrastructure exposure: <b>{infraExposure.highRiskCount}/{infraExposure.count}</b> facilities high-risk</div>
          <p className="text-[10.5px] text-muted-foreground pt-1">MODELLED — not validated against observed flooding.</p>
        </div>
      )}
    </>
  );

  const emergencyContacts = (
    <div className="grid grid-cols-3 gap-2">
      <a href="tel:112" className="rounded-xl border border-border bg-background p-2.5 text-center hover:bg-muted transition-colors">
        <Phone className="w-3.5 h-3.5 mx-auto mb-1 text-foreground" />
        <div className="text-[10px] font-bold">Emergency<br/>112</div>
      </a>
      <a href="tel:101" className="rounded-xl border border-border bg-background p-2.5 text-center hover:bg-muted transition-colors">
        <Phone className="w-3.5 h-3.5 mx-auto mb-1 text-foreground" />
        <div className="text-[10px] font-bold">Fire<br/>101</div>
      </a>
      <a href="tel:108" className="rounded-xl border border-border bg-background p-2.5 text-center hover:bg-muted transition-colors">
        <Phone className="w-3.5 h-3.5 mx-auto mb-1 text-foreground" />
        <div className="text-[10px] font-bold">Ambulance<br/>108</div>
      </a>
    </div>
  );

  const alertCard = (
    <div className={`rounded-2xl border p-4 ${severityStyle}`}>
      <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wide mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-current" /> {zoneSeverity.label === 'LOW' ? 'Low flood risk near you' : `${zoneSeverity.label.charAt(0)}${zoneSeverity.label.slice(1).toLowerCase()} flood risk near you`}
      </div>
      <p className="font-serif text-lg font-semibold text-foreground leading-snug mb-1.5">{brief.headline}</p>
      <p className="text-[11.5px] text-foreground/80 leading-relaxed">{brief.briefParagraph}</p>
      <div className="text-[9.5px] text-muted-foreground mt-2">Updated just now · MoES · MCGM data</div>
    </div>
  );

  const header = (
    <div className="flex items-center gap-2.5 px-5 py-4 border-b border-border lg:border-b-0 lg:px-0 lg:mb-5">
      <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center"><CloudRain className="w-4 h-4 text-primary-foreground" /></div>
      <div>
        <div className="text-[13px] font-bold text-foreground leading-tight">FLOODWATCH · Citizen</div>
        <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{activeZone.name.split('–')[0]}</div>
      </div>
    </div>
  );

  if (isDesktop) {
    // Desktop: a narrow action rail beside a much larger map + safe-places
    // area, instead of floating a phone-width card in the middle of a wide
    // screen. Real breakpoint switch (useMediaQuery), so only this branch's
    // single MapContainer mounts.
    return (
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-6xl mx-auto my-6">
          {header}
          <div className="grid grid-cols-[400px_1fr] gap-6 items-start">
            <div className="flex flex-col gap-3.5">
              {alertCard}
              {actionTiles}
              {tileDetail}
              {emergencyContacts}
              <p className="text-[9.5px] text-muted-foreground">
                Citizen Mode · Coverage limited to {Object.values(PILOT_ZONES).length} pilot zones today
              </p>
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-2xl overflow-hidden border border-border h-[420px] relative">
                <MapContainer />
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nearest Safe Places</span>
                <div className="mt-2"><SafePlacesList places={safePlacesShown} columns={2} /></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto flex justify-center bg-background py-6">
      <div className="w-full max-w-md bg-card rounded-3xl border border-border shadow-lg overflow-hidden">
        {header}
        <div className="p-4 flex flex-col gap-3.5">
          {alertCard}
          <div className="rounded-2xl overflow-hidden border border-border h-44 relative">
            <MapContainer />
          </div>
          {actionTiles}
          {tileDetail}
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Nearest Safe Places</span>
            <div className="mt-2"><SafePlacesList places={safePlacesShown} /></div>
          </div>
          {emergencyContacts}
          <p className="text-center text-[9.5px] text-muted-foreground">
            Citizen Mode · Mobile-first · Coverage limited to {Object.values(PILOT_ZONES).length} pilot zones today
          </p>
        </div>
      </div>
    </div>
  );
};

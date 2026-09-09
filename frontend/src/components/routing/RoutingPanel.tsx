import React, { useState } from 'react';
import { Route, MapPin, Navigation } from 'lucide-react';
import { DataStatusBadge } from '../common/DataStatusBadge';

export const RoutingPanel: React.FC = () => {
  const [origin, setOrigin] = useState('Chhatrapati Shivaji Terminus');
  const [destination, setDestination] = useState('KEM Hospital, Parel');
  const [isRouting, setIsRouting] = useState(false);
  const [routeStatus, setRouteStatus] = useState<'IDLE' | 'CALCULATING' | 'READY'>('IDLE');

  const handleRoute = () => {
    setRouteStatus('CALCULATING');
    setIsRouting(true);
    setTimeout(() => {
      setRouteStatus('READY');
      setIsRouting(false);
    }, 1500);
  };

  return (
    <div className="bg-card text-card-foreground p-4 rounded-xl border border-border shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-green">
          <Route size={16} />
          <h2>SAFE ROUTING</h2>
        </div>
        <DataStatusBadge status="MOCK" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="relative">
          <div className="absolute left-3 top-3">
             <MapPin size={14} className="text-muted-foreground" />
          </div>
          <input 
            type="text" 
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground focus:outline-none focus:border-cyan"
            placeholder="Origin"
          />
        </div>

        <div className="relative">
          <div className="absolute left-3 top-3">
             <Navigation size={14} className="text-cyan" />
          </div>
          <input 
            type="text" 
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-xs text-foreground focus:outline-none focus:border-cyan"
            placeholder="Destination"
          />
        </div>

        <button 
          onClick={handleRoute}
          disabled={isRouting}
          className="mt-2 w-full bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors disabled:opacity-50"
        >
          {routeStatus === 'CALCULATING' ? 'Calculating Risk-Aware Route...' : 'Calculate Route'}
        </button>

        {routeStatus === 'READY' && (
          <div className="mt-2 p-3 bg-green/10 border border-green/20 rounded-lg">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] uppercase text-green font-semibold">Route Status: SAFE</span>
              <span className="text-[10px] font-mono text-muted-foreground">ETA: 18 min</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              Route detoured via Dr. B.A. Road to avoid 0.6m simulated flood depth near Hindmata Junction.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

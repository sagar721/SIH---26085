import React, { useState } from 'react';
import { WifiOff, SignalLow, AlertTriangle, X } from 'lucide-react';
import { useOnlineStatus, useConnectionQuality } from '../../lib/useNetworkStatus';
import { useDataHealthStore } from '../../stores/useDataHealthStore';

// Disaster-readiness audit items 1.4, 5.1, 5.4: surfaces real, honest signals
// (browser connectivity state, real fetch failures reported by the
// adapters, real slow-connection detection) instead of letting them fail
// silently in the console while responders stare at a dashboard that looks
// fine but is quietly missing data.
export const SystemHealthBanner: React.FC = () => {
  const online = useOnlineStatus();
  const { isSlow, effectiveType } = useConnectionQuality();
  const failures = useDataHealthStore((s) => s.failures);
  const failureCount = Object.keys(failures).length;
  const [dismissedSlow, setDismissedSlow] = useState(false);

  if (online && !isSlow && failureCount === 0) return null;

  return (
    <div className="w-full flex flex-col z-[60] shrink-0">
      {!online && (
        <div className="w-full bg-red-600 text-white text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          No internet connection — showing the last data loaded into this browser. Nothing here is updating right now.
        </div>
      )}
      {online && isSlow && !dismissedSlow && (
        <div className="w-full bg-amber-500 text-black text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2 relative">
          <SignalLow className="w-3.5 h-3.5 shrink-0" />
          Slow network detected ({effectiveType ?? 'unknown'}) — large map layers may load slowly or fail.
          <button onClick={() => setDismissedSlow(true)} className="absolute right-3 hover:opacity-70" aria-label="Dismiss">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {online && failureCount > 0 && (
        <div className="w-full bg-red-500/90 text-white text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {failureCount} data layer{failureCount > 1 ? 's' : ''} failed to load — some map layers or panels may be
          incomplete. Check System Status for details.
        </div>
      )}
    </div>
  );
};

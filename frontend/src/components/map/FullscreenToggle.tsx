import React, { useCallback, useEffect } from 'react';
import { Maximize2, Minimize2, PanelsTopLeft } from 'lucide-react';
import { useUIStore } from '../../stores/useUIStore';

// One-click Fullscreen Map Mode. Uses the real
// browser Fullscreen API when available (desktop) so the OS/browser chrome
// itself gets out of the way, but the app's own CSS-driven fullscreen
// layout (see CommandCenter.tsx) is what actually does the work — that
// layout applies regardless of whether the native API is supported, since
// iOS Safari in particular does not support requestFullscreen() on
// arbitrary elements. This is why the feature works identically on mobile
// and desktop rather than depending on native fullscreen succeeding.
export const FullscreenToggle: React.FC = () => {
  const isMapFullscreen = useUIStore((s) => s.isMapFullscreen);
  const setMapFullscreen = useUIStore((s) => s.setMapFullscreen);
  const toggleFullscreenDrawer = useUIStore((s) => s.toggleFullscreenDrawer);

  const enter = useCallback(async () => {
    setMapFullscreen(true);
    const el = document.documentElement;
    if (el.requestFullscreen) {
      try {
        await el.requestFullscreen();
      } catch {
        // Native fullscreen refused (permission, iframe policy, no user
        // gesture in this call path, etc.) — the CSS-driven layout above
        // already applied, so the feature still works, just without the
        // browser chrome also disappearing.
      }
    }
  }, [setMapFullscreen]);

  const exit = useCallback(async () => {
    setMapFullscreen(false);
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // Already out of native fullscreen, or unsupported — nothing to do.
      }
    }
  }, [setMapFullscreen]);

  // Keeps app state in sync when fullscreen is exited by means this
  // component didn't trigger itself — the browser's own Escape handling
  // for NATIVE fullscreen, F11, the mobile "exit fullscreen" banner, etc.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (!document.fullscreenElement && useUIStore.getState().isMapFullscreen) {
        useUIStore.getState().setMapFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  return (
    <div className="absolute top-4 left-4 z-20 flex items-center gap-2">
      <button
        onClick={() => (isMapFullscreen ? exit() : enter())}
        className="flex items-center gap-2 bg-card/95 backdrop-blur-md border border-border rounded-lg px-3 py-2 text-xs font-semibold text-foreground shadow-lg hover:border-cyan/50 transition-colors"
        title={isMapFullscreen ? 'Exit fullscreen map (Esc)' : 'Fullscreen map'}
        aria-label={isMapFullscreen ? 'Exit fullscreen map' : 'Enter fullscreen map'}
      >
        {isMapFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-cyan" /> : <Maximize2 className="w-3.5 h-3.5 text-cyan" />}
        {isMapFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
      </button>

      {/* Only meaningful once the map has taken over the whole viewport —
          in normal layout the Decision Flow rail and Right Rail (routing,
          simulation controls, etc.) are already statically visible. */}
      {isMapFullscreen && (
        <button
          onClick={toggleFullscreenDrawer}
          className="flex items-center gap-2 bg-card/95 backdrop-blur-md border border-border rounded-lg px-3 py-2 text-xs font-semibold text-foreground shadow-lg hover:border-cyan/50 transition-colors"
          title="Show Decision Flow, Routing & Simulation controls"
          aria-label="Toggle Decision Flow panel"
        >
          <PanelsTopLeft className="w-3.5 h-3.5 text-cyan" />
          Decision Flow
        </button>
      )}
    </div>
  );
};

import React from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  /** Name of the section this boundary guards, shown in the fallback (e.g. "Map", "Analytics"). */
  label: string;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// Top-level React error boundary. Catches uncaught rendering errors in the
// subtree it wraps and shows a fallback screen instead of leaving the whole
// app white-screened. Multiple instances are used (Map, Modals, Analytics,
// Timeline, Dashboard) so one section crashing doesn't take the rest of the
// app down with it — each is an isolated failure domain.
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error(`[FLOODCAST ErrorBoundary: ${this.props.label}] Uncaught rendering error`, error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[160px] flex flex-col items-center justify-center gap-3 bg-background/95 border border-red-500/30 rounded-xl p-6 text-center">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-red-700" />
            <span className="text-sm font-bold tracking-widest text-foreground">FLOODCAST</span>
          </div>
          <div>
            <p className="text-sm font-semibold text-red-700">Component failed</p>
            <p className="text-xs text-muted-foreground mt-1">
              The "{this.props.label}" section hit an unexpected error and has been isolated to keep the rest of
              the app running. Details were logged to the browser console.
            </p>
            {this.state.error?.message && (
              <p className="text-[10px] font-mono text-muted-foreground/70 mt-2 max-w-md break-words">{this.state.error.message}</p>
            )}
          </div>
          <button
            onClick={this.handleReload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-700 border border-red-500/30 hover:bg-red-500/20 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

import React, { useEffect } from 'react';
import { useSimulationStore } from '../../stores/useSimulationStore';
import { Play, Pause } from 'lucide-react';
import { format, parseISO } from 'date-fns';

export const SimulationTimeline: React.FC = () => {
  const { 
    timeIndex, 
    availableTimestamps, 
    setTimeIndex, 
    isPlaying, 
    togglePlayback,
    playbackSpeed,
    setPlaybackSpeed
  } = useSimulationStore();
  
  const currentTimestamp = availableTimestamps[timeIndex];

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && availableTimestamps.length > 0) {
      interval = setInterval(() => {
        setTimeIndex(timeIndex >= availableTimestamps.length - 1 ? 0 : timeIndex + 1);
      }, 1000 / playbackSpeed); // Adjust playback speed
    }
    return () => clearInterval(interval);
  }, [isPlaying, timeIndex, availableTimestamps, setTimeIndex, playbackSpeed]);

  if (!availableTimestamps || availableTimestamps.length === 0) {
    return (
      <div className="bg-card/95 backdrop-blur-md text-card-foreground p-4 rounded-xl border border-border shadow-2xl flex items-center justify-center h-24">
        <p className="text-sm text-muted-foreground animate-pulse">Loading timeline data...</p>
      </div>
    );
  }

  const parsedTime = parseISO(currentTimestamp);
  const formattedTime = format(parsedTime, 'HH:mm');
  const formattedDate = format(parsedTime, 'MMM dd, yyyy');

  return (
    <div className="bg-card/95 backdrop-blur-md text-card-foreground p-4 rounded-xl border border-border shadow-2xl flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <button 
            onClick={togglePlayback}
            className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg shadow-primary/20 shrink-0"
          >
            {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" className="ml-1" />}
          </button>
          
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              Timeline
              <span className="px-1.5 py-0.5 rounded bg-cyan/10 text-cyan border border-cyan/20 text-[9px] font-bold">OBSERVED</span>
            </span>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold tracking-tight text-cyan">
                {formattedTime}
              </span>
              <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                {formattedDate}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-muted p-1 rounded-lg">
           {[1, 2, 5].map((speed) => (
             <button
               key={speed}
               onClick={() => setPlaybackSpeed(speed)}
               className={`px-2 py-1 rounded text-xs font-mono font-medium transition-colors ${playbackSpeed === speed ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-background'}`}
             >
               {speed}x
             </button>
           ))}
        </div>
      </div>

      <div className="relative pt-2">
        <input
          type="range"
          min="0"
          max={availableTimestamps.length - 1}
          value={timeIndex}
          onChange={(e) => setTimeIndex(parseInt(e.target.value))}
          className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-cyan"
        />
        <div className="flex justify-between text-[10px] font-mono text-muted-foreground mt-2 px-1">
          <span>{format(parseISO(availableTimestamps[0]), 'HH:mm')}</span>
          <span>{format(parseISO(availableTimestamps[Math.floor(availableTimestamps.length/2)]), 'HH:mm')}</span>
          <span>{format(parseISO(availableTimestamps[availableTimestamps.length - 1]), 'HH:mm')}</span>
        </div>
      </div>
    </div>
  );
};

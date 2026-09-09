import React, { useState } from 'react';
import { Layers, ChevronDown, Lock } from 'lucide-react';
import { useLayerStore } from '../../stores/useLayerStore';

export const LayerControl: React.FC = () => {
  const { defs, visibility, toggleLayer } = useLayerStore();
  const [open, setOpen] = useState(false);

  return (
    <div className="absolute top-4 right-4 z-20">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 bg-card/95 backdrop-blur-md border border-border rounded-lg px-3 py-2 text-xs font-semibold text-foreground shadow-lg hover:border-cyan/50 transition-colors"
      >
        <Layers className="w-3.5 h-3.5 text-cyan" />
        Layers
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 w-64 bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl p-2 max-h-[70vh] overflow-y-auto">
          {defs.map((layer) => (
            <label
              key={layer.id}
              className={`flex items-start gap-2.5 px-2.5 py-2 rounded-lg text-xs ${
                layer.available ? 'cursor-pointer hover:bg-muted/50' : 'opacity-50 cursor-not-allowed'
              }`}
              title={layer.unavailableReason}
            >
              <input
                type="checkbox"
                checked={Boolean(visibility[layer.id])}
                disabled={!layer.available}
                onChange={() => toggleLayer(layer.id)}
                className="mt-0.5 rounded border-border text-cyan focus:ring-cyan h-3.5 w-3.5 bg-background shrink-0"
              />
              <div className="min-w-0">
                <span className="text-foreground font-medium block">{layer.label}</span>
                {!layer.available && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Lock className="w-2.5 h-2.5" /> {layer.unavailableReason}
                  </span>
                )}
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

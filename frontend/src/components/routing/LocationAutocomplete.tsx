import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MapPinned } from 'lucide-react';
import type { LandmarkIndex, LandmarkSource, SearchResult } from '../../lib/geocoding';
import { searchLocations, resolveFreeText } from '../../lib/geocoding';
import type { LocationPoint } from '../../stores/useRoutingStore';

const SOURCE_LABEL: Record<LandmarkSource, string> = {
  infrastructure: 'infrastructure',
  road: 'road',
  building: 'building',
  geocoded: 'geocoded',
};

const DEBOUNCE_MS = 300;

interface Props {
  value: LocationPoint | null;
  onSelect: (p: LocationPoint | null) => void;
  placeholder: string;
  icon: React.ReactNode;
  index: LandmarkIndex;
  /** True forces this instance's dropdown shut immediately — used when a
   * sibling field (e.g. Destination, stacked directly below Origin) opens
   * its own dropdown, so two open dropdowns never visually overlap and
   * block clicks on the field underneath (found via live browser testing:
   * an open Origin dropdown intercepted clicks meant for Destination). */
  forceClose?: boolean;
  /** Fired whenever this instance opens (or would open) its dropdown, so the
   * parent can close any sibling field's dropdown in response. */
  onOpen?: () => void;
}

function toLocationPoint(r: SearchResult): LocationPoint {
  return { name: r.name, amenity: r.subtitle, coord: r.coord, source: r.source };
}

/**
 * Real free-text search: as the user types, searches the local landmark
 * index (instant) and, once results are sparse, Nominatim (debounced,
 * network) — see lib/geocoding.ts. Enter with no suggestion highlighted
 * still resolves whatever was typed via the same local-then-geocoder path,
 * so "Phoenix Mall" -> "KEM Hospital" routes even if neither was ever
 * clicked from the dropdown (issue 3's free-text routing requirement).
 */
export const LocationAutocomplete: React.FC<Props> = ({ value, onSelect, placeholder, icon, index, forceClose, onOpen }) => {
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpenState] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const setIsOpen = (open: boolean) => {
    setIsOpenState(open);
    if (open) onOpen?.();
  };

  // A sibling field opened its own dropdown — close this one so the two
  // never overlap.
  useEffect(() => {
    if (forceClose) setIsOpenState(false);
  }, [forceClose]);

  // Sync the visible text when the point is changed programmatically
  // (cleared on zone switch, etc.) rather than by this component itself.
  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpenState(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const runSearch = (text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setNotFound(false);
    if (text.trim().length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    debounceRef.current = setTimeout(async () => {
      const requestId = ++requestIdRef.current;
      const found = await searchLocations(index, text);
      if (requestId !== requestIdRef.current) return; // a newer keystroke superseded this request
      setResults(found);
      setIsSearching(false);
      setHighlighted(found.length > 0 ? 0 : -1);
    }, DEBOUNCE_MS);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setQuery(text);
    setIsOpen(true);
    if (!text) onSelect(null);
    runSearch(text);
  };

  const commitSelection = (r: SearchResult) => {
    setQuery(r.name);
    setIsOpen(false);
    setResults([]);
    setNotFound(false);
    onSelect(toLocationPoint(r));
  };

  const handleFreeTextCommit = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    const resolved = await resolveFreeText(index, query);
    setIsSearching(false);
    if (resolved) {
      commitSelection(resolved);
    } else {
      setNotFound(true);
      onSelect(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) setIsOpen(true);
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && highlighted >= 0 && results[highlighted]) {
        commitSelection(results[highlighted]);
      } else {
        void handleFreeTextCommit();
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</div>
      <input
        type="text"
        value={query}
        onChange={handleChange}
        onFocus={() => { if (results.length > 0) setIsOpen(true); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full bg-background border border-border rounded-lg pl-9 pr-8 py-2 text-xs text-foreground focus:outline-none focus:border-cyan"
      />
      {isSearching && (
        <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
      )}
      {isOpen && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-card border border-border rounded-lg shadow-xl">
          {results.map((r, i) => (
            <button
              key={`${r.name}-${r.coord[0]}-${r.coord[1]}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); commitSelection(r); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`w-full text-left px-3 py-2 flex items-start gap-2 border-b border-border/40 last:border-b-0 ${
                highlighted === i ? 'bg-muted' : 'hover:bg-muted/60'
              }`}
            >
              <MapPinned className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium text-foreground truncate">{r.name}</span>
                <span className="block text-[9px] text-muted-foreground truncate">
                  {r.subtitle} &middot; {SOURCE_LABEL[r.source]}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {notFound && (
        <p className="text-[9px] text-red-700 mt-1">Could not find "{query}" — try a more specific name.</p>
      )}
    </div>
  );
};

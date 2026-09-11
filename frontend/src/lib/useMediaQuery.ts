import { useEffect, useState } from 'react';

// Real breakpoint detection (not CSS display:none) — needed anywhere a
// component must only MOUNT on one side of a breakpoint rather than just
// visually hide, e.g. so CitizenView never runs two live MapLibre
// instances at once for the same page.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const listener = () => setMatches(mql.matches);
    listener();
    mql.addEventListener('change', listener);
    return () => mql.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

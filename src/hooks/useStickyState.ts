'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * useState that survives navigating away and back within the session (Frank Aug-2026 —
 * filters must persist until reset). Backed by sessionStorage, keyed by `key`. Clears
 * only when the tab closes or the user resets the filter.
 */
export function useStickyState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);
  const hydrated = useRef(false);

  // Restore once on mount (client only).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      if (raw != null) setState(JSON.parse(raw) as T);
    } catch { /* ignore bad/blocked storage */ }
    hydrated.current = true;
  }, [key]);

  // Persist after hydration so the stored value isn't clobbered by `initial`.
  useEffect(() => {
    if (!hydrated.current) return;
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch { /* ignore */ }
  }, [key, state]);

  return [state, setState];
}

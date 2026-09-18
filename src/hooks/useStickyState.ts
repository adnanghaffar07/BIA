'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * useState that survives navigating away and back within the session (Frank Aug-2026 —
 * filters must persist until reset). Backed by sessionStorage, keyed by `key`. Clears
 * only when the tab closes or the user resets the filter.
 *
 * The ordering here is the whole point, and the obvious version of it is wrong.
 *
 * Both effects below run in the same flush on mount, restore first, persist second. A
 * `hydrated` ref flipped by the restore effect is therefore already true when the persist
 * effect runs — but `state` in that closure is still the INITIAL value, because the
 * restore's setState has not re-rendered yet. So the persist effect wrote the default
 * straight over the saved value, on every mount, and the filters that were supposed to
 * survive a trip to a lead detail page were wiped by the act of coming back. React's dev
 * double-invoke does the same thing a second time, so a flag consumed once is no fix
 * either.
 *
 * Instead of guessing when restoring is "done", this waits to SEE it: the restore effect
 * records the serialized value it is restoring to, and the persist effect refuses to write
 * anything until the state it is looking at actually matches that value. Nothing is
 * written before the saved value has made it into the render.
 */
export function useStickyState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(initial);

  /** 'idle' = storage not read yet · 'restoring' = waiting for the saved value to land · 'live' = safe to write. */
  const phase = useRef<'idle' | 'restoring' | 'live'>('idle');
  /** The serialized value we are waiting to see in `state`. */
  const pending = useRef<string | null>(null);
  /** Captured once: object literals passed as `initial` are new on every render. */
  const initialRef = useRef(initial);

  // Restore once on mount (client only — sessionStorage does not exist during SSR, and
  // reading it in the useState initializer would desync the hydrated markup).
  useEffect(() => {
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(key); } catch { /* blocked storage */ }
    if (raw == null) { phase.current = 'live'; return; }

    let value: T;
    try { value = JSON.parse(raw) as T; } catch { phase.current = 'live'; return; }

    // Already what we would render anyway: there is no re-render coming, so waiting for
    // one would strand this key in 'restoring' and stop it ever saving again.
    const norm = JSON.stringify(value);
    if (norm === JSON.stringify(initialRef.current)) { phase.current = 'live'; return; }

    pending.current = norm;
    phase.current = 'restoring';
    setState(value);
  }, [key]);

  useEffect(() => {
    if (phase.current === 'idle') return;          // nothing read yet — never write blind
    const serialized = JSON.stringify(state);
    if (phase.current === 'restoring') {
      // Still the pre-restore value. Writing it now is exactly the bug described above.
      if (serialized !== pending.current) return;
      phase.current = 'live';
      return;
    }
    try { sessionStorage.setItem(key, serialized); } catch { /* ignore */ }
  }, [key, state]);

  return [state, setState];
}

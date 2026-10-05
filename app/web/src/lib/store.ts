// Owned by the lead. A tiny external store and the hook that reads a slice of it (used by lib/live.tsx and lib/nav.tsx).
import { useRef, useSyncExternalStore } from "react";

export type Store<S> = { get: () => S; subscribe: (listener: () => void) => () => void };

/** Listeners for a store: `emit` after the state changed. */
export function listeners() {
  const set = new Set<() => void>();
  return {
    subscribe: (l: () => void) => { set.add(l); return () => { set.delete(l); }; },
    emit: () => { for (const l of [...set]) l(); },
  };
}

/** Same keys, same values (one level deep). A missing key and `undefined` count as equal. */
export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b || Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  for (const k in x) if (!Object.is(x[k], y[k])) return false;
  for (const k in y) if (!(k in x) && y[k] !== undefined) return false;
  return true;
}

/**
 * A slice of a store. The component renders again only when `select` gives something new (by `eq`, Object.is by
 * default; pass shallowEqual for a selector that builds an object or array). `select` may be an inline function.
 */
export function useStoreSelector<S, T>(store: Store<S>, select: (s: S) => T, eq: (a: T, b: T) => boolean = Object.is): T {
  const memo = useRef<{ s: S; select: (s: S) => T; value: T } | null>(null);
  const snapshot = () => {
    const s = store.get(), m = memo.current;
    if (m && m.s === s && m.select === select) return m.value;
    const value = select(s);
    if (m && eq(m.value, value)) { memo.current = { s, select, value: m.value }; return m.value; }
    memo.current = { s, select, value };
    return value;
  };
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

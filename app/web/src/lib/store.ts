// Tiny external stores: atoms (one value, optionally kept in localStorage), the hook that reads a slice of a bigger
// store (lib/live.tsx, lib/nav.tsx), and localStorage reads and writes that survive blocked storage.
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

// ---------- browser storage ----------

/** localStorage's value for `key`, or null when there's none or storage is blocked (a private window, a sandbox). */
export function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
/** Remember `value` under `key`; when storage is blocked it is simply not remembered (still applied for this visit). */
export function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* not remembered, still applied */ }
}
/** JSON kept under `key`, or `fallback` when there's none, it can't be read, or it doesn't parse. */
export function readStoredJson<T>(key: string, fallback: T): T {
  const raw = readStored(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ---------- atoms ----------

export type Atom<T> = Store<T> & {
  /** A new value (or a function of the current one). Listeners hear about it only if it changed (Object.is). */
  set: (next: T | ((prev: T) => T)) => void;
  /** The value, in a component (renders again when it changes). */
  use: () => T;
};

/** `parse` turns what was kept into a value (undefined or a throw: not a value, the initial one is used). */
type Remembered<T> = { key: string; parse: (raw: string) => T | undefined; serialize?: (v: T) => string };

/**
 * One value and its listeners: the small stores (a setting, a list) are made with this. With `stored`, it starts from
 * what localStorage kept (else `initial`) and every change is written back (`serialize`: String by default).
 */
export function createAtom<T>(initial: T, stored?: Remembered<T>): Atom<T> {
  const raw = stored ? readStored(stored.key) : null;
  let value = initial;
  if (raw != null) try { value = stored!.parse(raw) ?? initial; } catch { /* unreadable: the initial value */ }
  const l = listeners();
  const get = () => value;
  const set = (next: T | ((prev: T) => T)) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(value) : next;
    if (Object.is(v, value)) return;
    value = v;
    if (stored) writeStored(stored.key, (stored.serialize ?? String)(v));
    l.emit();
  };
  const use = () => useSyncExternalStore(l.subscribe, get, get);
  return { get, set, subscribe: l.subscribe, use };
}

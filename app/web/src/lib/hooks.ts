// Small hooks the views share: one copy of each rule.
import { useEffect, useRef, useState } from "react";
import { clock } from "./live";

/**
 * Calls `run` now and then every `ms` while `on`, but not while the tab is hidden: once more as soon as it shows
 * again. `run` may change between renders (the latest one is called); `deps` restart the polling.
 */
export function usePoll(run: () => void, ms: number, on: boolean, deps: readonly unknown[] = []) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") latest.current(); }, ms);
    const onShow = () => { if (document.visibilityState === "visible") latest.current(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, on, ...deps]);
}

/** The app's clock (lib/live's clock: a replay's own time), read again every `ms`, so "3 min ago" keeps up. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(clock);
  useEffect(() => { const t = setInterval(() => setNow(clock()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export type Size = { w: number; h: number };
/** An element's size in whole pixels, kept up to date as it changes (`initial` until it's measured). */
export function useSize<T extends HTMLElement>(initial: Size = { w: 800, h: 600 }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

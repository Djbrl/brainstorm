// Small hooks the views share: one copy of each rule.
import { useEffect, useRef } from "react";

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

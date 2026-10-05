// The side panels' shared rules (the step panel and the file panel): Esc or Back closes them (lib/nav `back`), and so
// does a click outside them. A drag isn't a click: panning the map with a panel open keeps it.
import { useEffect, useRef } from "react";

/** Clicks here move between steps or files rather than leave them: the panels, the sidebar, the player, the Track's line, the header. */
export const KEEPS_OPEN = ".map-panel, .map-sidebar, .dock, .rp-bar, .trk-line, .trk-window, .crumbs, .lens-switch, .settings, .welcome";

/** Close on a click outside `keep` (a CSS selector), not on a drag. */
export function useClickAway(open: boolean, keep: string, close: () => void) {
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = e.button !== 0 || (e.target as Element | null)?.closest?.(keep) ? null : { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) closeRef.current(); down = null; };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("pointerup", onUp, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("pointerup", onUp, true); };
  }, [open, keep]);
}

/** The last thing a panel showed: it keeps showing while the panel slides out, so closing never leaves an empty sheet. */
export function useLastShown<T>(value: T | null | undefined): T | undefined {
  const last = useRef<T | undefined>(undefined);
  if (value) last.current = value;
  return value ?? last.current;
}

// The phone's thread sheet under the map (MapSidebar's "pip"): its top, as a share of the map's height, set by dragging
// its grab bar (for this page: a reload starts it at the middle again), and down past its lowest to fold it. The player
// rides on its edge (sidebar.css --pip-top).
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

// Where its top may go, within a thumb's reach: no higher than a quarter of the map (and 96 px, under the map's top
// controls), no lower than 170 px above the bottom (a few steps and the grab bar stay in view); dragged 6% past that, it folds.
const PIP_MIN = 25, PIP_MAX = 72, TOP_PX = 96, BOTTOM_PX = 170, FOLD_PAST = 6;
const pipRange = (h: number) => ({ lo: Math.max(PIP_MIN, (TOP_PX / Math.max(1, h)) * 100), hi: Math.max(PIP_MIN + 5, Math.min(PIP_MAX, ((h - BOTTOM_PX) / Math.max(1, h)) * 100)) });
const PIP_START = 50;   // each page load starts the sheet at the middle (its height isn't remembered)

/** `sheet` goes on the sheet, `top` (%) is where it sits, `grab` are the grab bar's props; `onFold` folds the sheet. */
export function usePhoneSheet(onFold: () => void) {
  const [pipTop, setPipTop] = useState(PIP_START);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number } | null>(null);
  const wrapBox = () => sheet.current?.closest(".map-wrap")?.getBoundingClientRect();
  const toPct = (y: number) => { const w = wrapBox(); return w ? ((y - w.top) / Math.max(1, w.height)) * 100 : pipTop; };
  const range = () => pipRange(wrapBox()?.height ?? 600);
  const clampPip = (v: number) => { const r = range(); return Math.max(r.lo, Math.min(r.hi, v)); };
  // While dragging it follows the finger (a little past the lowest, to fold); at rest, within reach on this screen.
  const top = drag.current ? pipTop : clampPip(pipTop);
  useLayoutEffect(() => { (sheet.current?.closest(".map-wrap") as HTMLElement | null)?.style.setProperty("--pip-top", `${top}%`); });

  const grab = {
    role: "separator", "aria-orientation": "horizontal" as const, "aria-label": "Drag to resize the thread's sheet", tabIndex: 0,
    "aria-valuemin": PIP_MIN, "aria-valuemax": PIP_MAX, "aria-valuenow": Math.round(pipTop),
    onPointerDown: (e: PointerEvent<HTMLElement>) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer that's gone */ } drag.current = { from: pipTop }; },
    onPointerMove: (e: PointerEvent<HTMLElement>) => { if (drag.current) { const r = range(); setPipTop(Math.max(r.lo, Math.min(r.hi + FOLD_PAST, toPct(e.clientY)))); } },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current; drag.current = null;
      if (!d) return;
      const v = toPct(e.clientY);
      if (v > range().hi + FOLD_PAST * 0.6) { setPipTop(d.from); onFold(); return; }   // dragged past the lowest: fold
      setPipTop(clampPip(v));
    },
    onPointerCancel: () => { if (drag.current) { setPipTop(drag.current.from); drag.current = null; } },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      const d = e.key === "ArrowUp" ? -5 : e.key === "ArrowDown" ? 5 : 0;
      if (!d) return;
      e.preventDefault();
      setPipTop(clampPip(pipTop + d));
    },
  };
  return { sheet, top, grab };
}

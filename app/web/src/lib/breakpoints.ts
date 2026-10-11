// The window widths where the layout changes, and the reduced-motion setting, for the scripts. The CSS can't read these
// constants, so the same numbers are written in its media queries; change one, change them all:
//   NARROW (1100 px): map/map.css, map/lens.css, map/sidebar/sidebar.css, map/replay/replay.css
//     (lens.css and sidebar.css also use `min-width: 441px`, the first width above PHONE)
//   PHONE (440 px):   map/map.css, map/lens.css, map/readmap.css, map/sidebar/sidebar.css, map/replay/replay.css,
//                     map/tour/tour.css
import { useSyncExternalStore } from "react";

/** At or below this width the sidebar starts folded and opens over the content. */
export const NARROW_PX = 1100;
/** At or below this width it's a phone: the thread opens in a sheet below the map. */
export const PHONE_PX = 440;

export const NARROW = `(max-width: ${NARROW_PX}px)`;
export const PHONE = `(max-width: ${PHONE_PX}px)`;
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether a media query matches now (false where there's no window). */
export const matches = (query: string) => typeof matchMedia === "function" && matchMedia(query).matches;
/** The person asked their system for less motion: animations jump to their end. */
export const reducedMotion = () => matches(REDUCED_MOTION);

/** Whether a media query matches, kept up to date as the window resizes. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (on) => { const m = matchMedia(query); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
    () => matches(query),
    () => false,
  );
}

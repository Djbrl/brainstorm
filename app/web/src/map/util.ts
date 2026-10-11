// Small helpers the map's layers share: easing curves and a string hash. One copy each.

/** Ease in and out (cubic): slow, fast, slow, for 0…1. The camera's moves, a marker's glide, the layout's tween. */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Ease out (cubic): fast, then settling, for 0…1. */
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A stable unsigned number for a string (an id), to pick a colour or a variant the same way every time. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

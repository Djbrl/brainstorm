// Owner: perf-canvas. Small pictures drawn once and stamped many times: a themed file mark (a plate, a station, a cube at
// one of a few angles) costs one drawImage a frame instead of its paths, gradients and strokes. Kept per colour and
// screen size (in half pixels), at the screen's pixel density so they stay sharp; the oldest go first when there are
// too many. A file also remembers its last stamp (StampMemo), so a frame where nothing changed looks nothing up.

export type Sprite = { canvas: HTMLCanvasElement; w: number; h: number; ox: number; oy: number };
/** What a file's last stamp was made of, and the stamp: the next frame reuses it while those stay the same. */
export type StampMemo = { a?: unknown; b?: unknown; c?: unknown; d?: unknown; e?: unknown; s?: Sprite | null; g?: Sprite | null; gk?: unknown };

const MAX = 3000;
const cache = new Map<string, Sprite>();
let dpr = 1;

/** Once per frame: the screen's pixel density (a window moved to another screen redraws every sprite at its own). */
export function spriteFrame() {
  const ratio = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
  if (ratio !== dpr) { cache.clear(); dpr = ratio; }
}

/**
 * The sprite for `key`, drawn by `paint` the first time: `w`×`h` CSS pixels with the mark's centre at (`ox`, `oy`).
 * `paint` draws in CSS pixels around (ox, oy), as the mark would be drawn on the map at scale 1.
 */
export function sprite(key: string, w: number, h: number, ox: number, oy: number, paint: (ctx: CanvasRenderingContext2D) => void): Sprite | null {
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(w * dpr));
  canvas.height = Math.max(1, Math.ceil(h * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  paint(ctx);
  const s = { canvas, w, h, ox, oy };
  if (cache.size >= MAX) { let n = MAX >> 2; for (const k of cache.keys()) { cache.delete(k); if (--n <= 0) break; } }
  cache.set(key, s);
  return s;
}

/** Stamp a sprite on the map: its centre at graph point (x, y), drawn at `k` graph units per sprite pixel (1 / scale).
 *  `baked`: the sprite already holds the file's strength (see faded), so it goes on at full strength. */
export function stamp(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, k: number, baked = false) {
  if (!baked) { ctx.drawImage(s.canvas, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k); return; }
  const a = ctx.globalAlpha;
  ctx.globalAlpha = 1;
  ctx.drawImage(s.canvas, x - s.ox * k, y - s.oy * k, s.w * k, s.h * k);
  ctx.globalAlpha = a;
}

/**
 * A faded file's strength for its stamp, to 1/32. A mark drawn in several strokes at an alpha shows each stroke at that
 * alpha (overlaps add up); a stamp drawn at the alpha would fade the mark as one piece, a little fainter. So a faded
 * file's stamp is drawn with the alpha inside it, as the strokes would be, and goes on at full strength.
 */
export const faded = (alpha: number) => (alpha >= 1 ? 1 : Math.max(1 / 32, Math.round(alpha * 32) / 32));

/** Screen sizes are bucketed to half pixels: few sprites, and a mark never jumps by more than a quarter pixel. */
export const bucket = (px: number) => Math.max(0.5, Math.round(px * 2) / 2);

/** Drop every sprite (the theme's colours changed). */
export function clearSprites() { cache.clear(); }

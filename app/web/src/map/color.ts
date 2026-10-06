// Owner: D. A file's colour on the map: the theme's recency colours (CSS variables, themes.css) and the mix between them.
// No app state in here: the caller says whether this is a recording and since when a change counts as new.
import type { RGB } from "./themes";

const MIN = 60_000;
const HOUR = 60 * MIN;

export function hex(c: string): [number, number, number] {
  const h = c.trim().replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((x) => x + x).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const mixRGB = (a: RGB, b: RGB, t: number): RGB => {
  const k = Math.max(0, Math.min(1, t));
  return a.map((v, i) => Math.round(v + (b[i] - v) * k)) as RGB;
};
export function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    hot: hex(v("--hot", "#ff5b1f")), warm: hex(v("--warm", "#ffa66e")), cool: hex(v("--cool", "#c7cbd6")),
    accent: v("--accent", "#2563eb"), ink: v("--ink", "#121214"),
    display: v("--font-display", "-apple-system, sans-serif"), body: v("--font-body", "-apple-system, sans-serif"),
  };
}
export type Tokens = ReturnType<typeof readTokens>;

/**
 * A file's color: hot for a few minutes after an edit, warm if it changed since you last looked (`since`, see
 * lib/visit.ts), quiet otherwise. A recording (the hosted demo) has no "last visit": there, warm fades out over an hour.
 */
export function recencyRGB(t: Tokens, iso: string | undefined, now: number, recorded: boolean, since: number): RGB {
  if (!iso) return t.cool;
  const at = Date.parse(iso), age = now - at;
  if (!(age >= 0)) return t.hot;
  // In 1/32 steps (a few seconds each): the same few colours for every file, so their drawings can be reused (sprites.ts).
  if (age < 5 * MIN) return mixRGB(t.hot, t.warm, steps((age / (5 * MIN)) ** 1.5));
  if (recorded) return age < HOUR ? mixRGB(t.warm, t.cool, steps((age - 5 * MIN) / (HOUR - 5 * MIN))) : t.cool;
  return at > since ? t.warm : t.cool;
}
export const steps = (k: number, n = 32) => Math.round(k * n) / n;
export const css = (c: RGB) => `rgb(${c.join(",")})`;
export const same = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

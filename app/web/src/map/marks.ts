// The marks drawn on the map in each theme's way (themes.ts): Prism's glass cube, Hologram's wireframe globe, Metro's
// station, each drawn or stamped from a cached sprite; and an agent's marker (a disc, or Metro's badge). Moved out of themes.ts.
import { bucket, faded, sprite, stamp, type Sprite, type StampMemo } from "./sprites";
import { mapStyle, type RGB } from "./themes";

const TAU = Math.PI * 2;
const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a})`;
/** Colour strings built once: the same few colours are asked for by thousands of files a frame. */
const rgbaCache = new Map<string, string>();
const rgbaOf = (r: number, g: number, b: number, a: number) => {
  const k = r + "," + g + "," + b + "," + a;
  let v = rgbaCache.get(k);
  if (v === undefined) { v = `rgba(${k})`; if (rgbaCache.size > 4000) rgbaCache.clear(); rgbaCache.set(k, v); }
  return v;
};
const q = (v: number) => Math.round(v * 100) / 100;   // alphas to 1/100: fewer distinct strings, the same picture

// ---------- Prism: a glass cube, turning slowly ----------
const CUBE_V = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
const CUBE_F = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 5, 4, 2, 3, 7, 6, 1, 2, 6, 5, 0, 3, 7, 4];
const TILT_C = Math.cos(0.55), TILT_S = Math.sin(0.55);
const PV = new Float64Array(24), FZ = new Float64Array(6), ORDER = [0, 1, 2, 3, 4, 5];
/** The cube's six glass faces at `angle`, far to near (one set of buffers: nothing allocated per cube). */
function cubeBody(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, lineWidth: number) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  for (let v = 0; v < 8; v++) {
    const a = CUBE_V[v * 3], b = CUBE_V[v * 3 + 1], d = CUBE_V[v * 3 + 2];
    const x1 = a * ca - d * sa, z1 = a * sa + d * ca;
    PV[v * 3] = x + x1 * s; PV[v * 3 + 1] = y + (b * TILT_C - z1 * TILT_S) * s; PV[v * 3 + 2] = b * TILT_S + z1 * TILT_C;
  }
  for (let f = 0; f < 6; f++) {
    FZ[f] = (PV[CUBE_F[f * 4] * 3 + 2] + PV[CUBE_F[f * 4 + 1] * 3 + 2] + PV[CUBE_F[f * 4 + 2] * 3 + 2] + PV[CUBE_F[f * 4 + 3] * 3 + 2]) / 4;
    ORDER[f] = f;
  }
  // Far (bigger z) first; stable, like the sort it replaces.
  for (let i = 1; i < 6; i++) { const f = ORDER[i]; let j = i - 1; while (j >= 0 && FZ[ORDER[j]] < FZ[f]) { ORDER[j + 1] = ORDER[j]; j--; } ORDER[j + 1] = f; }
  ctx.lineWidth = lineWidth;
  for (let i = 0; i < 6; i++) {
    const f = ORDER[i], z = FZ[f];
    ctx.beginPath();
    for (let n = 0; n < 4; n++) { const v = CUBE_F[f * 4 + n] * 3; if (n) ctx.lineTo(PV[v], PV[v + 1]); else ctx.moveTo(PV[v], PV[v + 1]); }
    ctx.closePath();
    ctx.fillStyle = rgbaOf(c[0], c[1], c[2], q(0.2 + (1 - z) * 0.12)); ctx.fill();
    ctx.strokeStyle = rgbaOf(232, 240, 255, q(0.38 + (1 - z) * 0.25)); ctx.stroke();
  }
}
function cubeGlow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: RGB) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, s * 3.6);
  g.addColorStop(0, rgba(c, 0.45)); g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s * 3.6, 0, TAU); ctx.fill();
}
export function drawCube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, glow: boolean, scale: number, here: string | null = null) {
  if (here) { // where an agent is: one glowing ring on the floor under the cube
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y + s * 1.35, s * 1.9, s * 0.62, 0, 0, TAU);
    ctx.strokeStyle = here; ctx.lineWidth = 1.8 / scale; ctx.shadowColor = here; ctx.shadowBlur = 12; ctx.stroke();
    ctx.restore();
  }
  if (glow) cubeGlow(ctx, x, y, s, c);
  cubeBody(ctx, x, y, s, angle, c, 0.9 / scale);
}

/** Below this size on screen (half a cube's width, in pixels) a cube stands still: its turn wouldn't show. */
export const CUBE_STILL_PX = 3;
const CUBE_STAMP_PX = 12;    // up to here a cube is stamped at one of ANGLES angles; bigger ones are drawn as they turn
const ANGLES = 32;           // per quarter turn (a cube looks the same a quarter turn on): 2.8° apart
const QUARTER = Math.PI / 2;
/**
 * A Prism cube, the quick way: a stamp of its glow and one of its body at the nearest of 32 angles, for every cube up to
 * CUBE_STAMP_PX on screen (all of them on a big map); false when it's bigger (drawCube draws it then). Looks like drawCube.
 * `css`: its colour as a string, the stamp's key.
 */
export function stampCube(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, css: string, glow: boolean, scale: number, memo: StampMemo = {}, alpha = 1): boolean {
  const S = s * scale;
  if (S > CUBE_STAMP_PX) return false;
  const b = bucket(S), k = (1 / scale) * (S / b);
  if (glow) {
    let g: Sprite | null | undefined = memo.g;
    if (!g || memo.gk !== css || memo.c !== b) g = memo.g = sprite("cg|" + css + "|" + b, b * 7.2, b * 7.2, b * 3.6, b * 3.6, (cx) => cubeGlow(cx, b * 3.6, b * 3.6, b, c));
    memo.gk = css;
    if (g) stamp(ctx, g, x, y, k);
  }
  let a = angle % QUARTER; if (a < 0) a += QUARTER;
  const step = Math.round((a / QUARTER) * ANGLES) % ANGLES, half = b * 1.8 + 1, fa = faded(alpha);   // the glow is one fill: it fades as is
  let body: Sprite | null | undefined = memo.s;
  if (!body || memo.a !== css || memo.c !== b || memo.d !== step || memo.e !== fa) {
    body = memo.s = sprite("cb|" + css + "|" + b + "|" + step + "|" + fa, half * 2, half * 2, half, half, (cx) => { cx.globalAlpha = fa; cubeBody(cx, half, half, b, (step / ANGLES) * QUARTER, c, 0.9); });
    memo.a = css; memo.c = b; memo.d = step; memo.e = fa;
  }
  if (!body) { cubeBody(ctx, x, y, s, angle, c, 0.9 / scale); return true; }
  stamp(ctx, body, x, y, k, fa < 1);
  return true;
}

// ---------- Hologram: a wireframe globe, turning slowly ----------
const MERIDIANS = 2;                     // a globe looks the same a 1/MERIDIANS half turn on
const LATS = [0];                        // its parallels, as sines of their latitude: the equator
/** The globe: a faint body, its outline, meridians turning about the vertical axis and parallels seen a little from above. */
function globeBody(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, lit: boolean, lineWidth: number) {
  const wire: RGB = [Math.round(c[0] + (235 - c[0]) * 0.45), Math.round(c[1] + (245 - c[1]) * 0.45), Math.round(c[2] + (255 - c[2]) * 0.45)];
  ctx.lineWidth = lineWidth;
  ctx.beginPath(); ctx.arc(x, y, s, 0, TAU);
  ctx.fillStyle = rgba(c, lit ? 0.26 : 0.14); ctx.fill();
  ctx.strokeStyle = rgba(lit ? c : wire, lit ? 1 : 0.7); ctx.stroke();
  ctx.strokeStyle = rgba(wire, lit ? 0.6 : 0.38);
  ctx.beginPath();
  for (let k = 0; k < MERIDIANS; k++) {
    const rx = s * Math.abs(Math.cos(angle + (k * Math.PI) / MERIDIANS));
    if (rx < s * 0.04) { ctx.moveTo(x, y - s); ctx.lineTo(x, y + s); continue; }
    ctx.moveTo(x + rx, y); ctx.ellipse(x, y, rx, s, 0, 0, TAU);
  }
  for (const l of LATS) {
    const rx = s * Math.sqrt(1 - l * l), py = y + s * l;
    ctx.moveTo(x + rx, py); ctx.ellipse(x, py, rx, rx * 0.22, 0, 0, TAU);
  }
  ctx.stroke();
}
export function drawGlobe(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, lit: boolean, scale: number, here: string | null = null) {
  if (here) { // where an agent is: one glowing ring around its equator, wider than the globe
    ctx.save();
    ctx.beginPath(); ctx.ellipse(x, y + s * 0.15, s * 1.55, s * 0.42, 0, 0, TAU);
    ctx.strokeStyle = here; ctx.lineWidth = 1.8 / scale; ctx.shadowColor = here; ctx.shadowBlur = 12; ctx.stroke();
    ctx.restore();
  }
  if (lit) cubeGlow(ctx, x, y, s * 0.8, c);
  globeBody(ctx, x, y, s, angle, c, lit, 0.9 / scale);
}
const GLOBE_STAMP_PX = 14;   // up to here a globe is stamped at one of GLOBE_ANGLES angles; bigger ones are drawn as they turn
const GLOBE_ANGLES = 24;     // per 1/MERIDIANS half turn
/** A Hologram globe as a stamp (up to GLOBE_STAMP_PX on screen, no agent ring); false when drawGlobe must draw it. */
export function stampGlobe(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, angle: number, c: RGB, css: string, lit: boolean, scale: number, memo: StampMemo = {}, alpha = 1): boolean {
  const S = s * scale;
  if (S > GLOBE_STAMP_PX) return false;
  const b = bucket(S), k = (1 / scale) * (S / b), period = Math.PI / MERIDIANS, fa = faded(alpha);
  let a = angle % period; if (a < 0) a += period;
  const step = Math.round((a / period) * GLOBE_ANGLES) % GLOBE_ANGLES, half = lit ? b * 2.9 : b + 1.5, key = lit ? css + "|1" : css;
  let sp: Sprite | null | undefined = memo.s;
  if (!sp || memo.a !== key || memo.c !== b || memo.d !== step || memo.e !== fa) {
    sp = memo.s = sprite("gl|" + key + "|" + b + "|" + step + "|" + fa, half * 2, half * 2, half, half, (cx) => {
      cx.globalAlpha = fa;
      if (lit) cubeGlow(cx, half, half, b * 0.8, c);
      globeBody(cx, half, half, b, (step / GLOBE_ANGLES) * period, c, lit, 0.9);
    });
    memo.a = key; memo.c = b; memo.d = step; memo.e = fa;
  }
  if (!sp) return false;
  stamp(ctx, sp, x, y, k, fa < 1);
  return true;
}

// ---------- Metro: a station, and imports as transit lines ----------
/** A station: ringed in its folder's colour (ink outside any), filled with the recency colour once the file changed
 *  (white while quiet), like a stop on an RER map.
 *  Where an agent is: one more ring, in the "just now" colour. Nothing else is drawn around a station. */
export function drawStation(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, here: string | null, bold: boolean, scale: number) {
  const rr = Math.max(2.6, r * 0.6);
  ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU);
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = (bold ? 2.4 : 1.6) / scale + rr * 0.14;
  ctx.strokeStyle = ring; ctx.stroke();
  if (here) {
    ctx.beginPath(); ctx.arc(x, y, rr + 4.5 / scale + rr * 0.18, 0, TAU);
    ctx.lineWidth = 2.2 / scale; ctx.strokeStyle = here; ctx.stroke();
  }
}
const STATION_STAMP_PX = 40;
/** A Metro station as a stamp (up to STATION_STAMP_PX on screen, no agent ring); false when drawStation must draw it. */
export function stampStation(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ring: string, bold: boolean, scale: number, memo: StampMemo = {}, alpha = 1): boolean {
  const rr = Math.max(2.6, r * 0.6), R = rr * scale;
  if (R > STATION_STAMP_PX) return false;
  const b = bucket(R), fa = faded(alpha);
  let sp: Sprite | null | undefined = memo.s;
  if (!sp || memo.a !== fill || memo.b !== ring || memo.c !== b || memo.d !== bold || memo.e !== fa) {
    // The ring's width is in pixels plus a share of the station (drawStation): the same, measured on screen.
    const lw = (bold ? 2.4 : 1.6) + b * 0.14, half = b + lw / 2 + 1;
    sp = memo.s = sprite("s|" + fill + "|" + ring + "|" + (bold ? 1 : 0) + "|" + b + "|" + fa, half * 2, half * 2, half, half, (cx) => {
      cx.globalAlpha = fa;
      cx.beginPath(); cx.arc(half, half, b, 0, TAU);
      cx.fillStyle = fill; cx.fill();
      cx.lineWidth = lw; cx.strokeStyle = ring; cx.stroke();
    });
    memo.a = fill; memo.b = ring; memo.c = b; memo.d = bold; memo.e = fa;
  }
  if (!sp) return false;
  stamp(ctx, sp, x, y, (1 / scale) * (R / b), fa < 1);
  return true;
}

/**
 * An agent's mark, of radius R (map units), in the theme's way (MapStyle.marker), with `text` (its letter, a replay's
 * step number) in the middle. disc: filled in its colour, ringed white (a glow in the dark themes). badge (Metro):
 * white, ringed in its colour, the letter in its colour, like an RER line's roundel.
 */
export function drawMarker(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, color: string, text: string, fontPx: number, family: string, scale: number, st = mapStyle()) {
  ctx.save();
  if (st.marker === "badge") {
    ctx.shadowColor = "rgba(60,40,0,0.18)"; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = "#fff"; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = 2.4 / scale; ctx.strokeStyle = color; ctx.stroke();
    ctx.fillStyle = color;
  } else {
    ctx.shadowColor = st.glow ? color : "rgba(0,0,0,0.18)"; ctx.shadowBlur = st.glow ? 16 : 6; ctx.shadowOffsetY = st.glow ? 0 : 1;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fillStyle = color; ctx.fill();
    ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.lineWidth = 2 / scale; ctx.strokeStyle = st.markerStroke; ctx.stroke();
    ctx.fillStyle = st.markerText;
  }
  ctx.font = `700 ${fontPx / scale}px ${family}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5 / scale);
  ctx.restore();
}

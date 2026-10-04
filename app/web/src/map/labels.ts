// Owned by the lead. Folder names on the map without the pile-up.
// 1. Labels are drawn by priority (folder under the pointer or selected, then where agents work, then recent edits,
//    then size), and a label that would overlap one already drawn is skipped, like town names on a map.
// 2. Subfolders fold into one label for their parent folder while the group is small on screen; zoomed in, each
//    subfolder shows its own name, without the parent's when the parent has many ("alpha", not "projects/alpha").
// Colours and fonts follow the map theme (map/themes.ts).
// File names use the same idea: a LabelSpace per frame, so two file labels never print on top of each other.

import { mapStyle, moduleColor } from "./themes";

export type LabelNode = { x?: number; y?: number; r: number; module: string; lastChangedAt?: string; active: boolean };

type Box = { x0: number; y0: number; x1: number; y1: number };

/** Boxes already taken this frame, in graph coordinates. */
export class LabelSpace {
  private boxes: Box[] = [];
  reset() { this.boxes = []; }
  hits(b: Box) { return this.boxes.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0); }
  add(b: Box) { this.boxes.push(b); }
  /** Takes the box if it's free (or `force`d) and says whether the label may be drawn. */
  claim(b: Box, force = false) { if (!force && this.hits(b)) return false; this.add(b); return true; }
}

const HOUR = 3_600_000;
const COLLAPSE_PX = 280;          // a parent's subfolders fold into one label below this size on screen
const SHORTEN_FROM = 4;           // subfolders a parent needs before their labels drop its name

const parentOf = (m: string) => (!m || m === "." ? "." : m.split("/")[0]);
const display = (m: string) => (!m || m === "." ? "root" : m);

/** Where a label sits: above most of the files, so one stray file doesn't drag it into a neighbour. */
const labelTop = (tops: number[]) => { const t = [...tops].sort((a, b) => a - b); return t[Math.floor(t.length * 0.15)]; };

type Agg = { m: string; n: number; sx: number; sy: number; x0: number; x1: number; y0: number; y1: number; tops: number[]; recent: number; busy: boolean };

function aggregate(nodes: LabelNode[], key: (n: LabelNode) => string) {
  const out = new Map<string, Agg>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const k = key(n);
    const a = out.get(k) ?? { m: k, n: 0, sx: 0, sy: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, tops: [], recent: 0, busy: false };
    a.n++; a.sx += n.x; a.sy += n.y;
    a.x0 = Math.min(a.x0, n.x - n.r); a.x1 = Math.max(a.x1, n.x + n.r);
    a.y0 = Math.min(a.y0, n.y - n.r); a.y1 = Math.max(a.y1, n.y + n.r); a.tops.push(n.y - n.r);
    const t = n.lastChangedAt ? Date.parse(n.lastChangedAt) : 0;
    if (t > a.recent) a.recent = t;
    if (n.active) a.busy = true;
    out.set(k, a);
  }
  return out;
}

export function drawModuleLabels(ctx: CanvasRenderingContext2D, scale: number, nodes: LabelNode[], opts: {
  font: string; now: number; focus: Set<string>; busy: Set<string>; space: LabelSpace;
}) {
  const mods = aggregate(nodes, (n) => n.module);
  const groups = new Map<string, Agg[]>();
  for (const a of mods.values()) { const p = parentOf(a.m); groups.set(p, [...(groups.get(p) ?? []), a]); }

  type Cand = { text: string; x: number; y: number; px: number; prio: number; mods: string[] };
  const cands: Cand[] = [];
  const prio = (list: Agg[]) => {
    const names = list.map((a) => a.m);
    let p = list.reduce((s, a) => s + a.n, 0);
    const recent = Math.max(...list.map((a) => a.recent));
    if (recent && opts.now - recent < HOUR) p += 1000 * (1 - (opts.now - recent) / HOUR);
    if (list.some((a) => a.busy) || names.some((m) => opts.busy.has(m))) p += 1e5;
    if (names.some((m) => opts.focus.has(m))) p += 1e6;
    return p;
  };
  for (const [parent, list] of groups) {
    const x0 = Math.min(...list.map((a) => a.x0)), x1 = Math.max(...list.map((a) => a.x1));
    const y0 = Math.min(...list.map((a) => a.y0)), y1 = Math.max(...list.map((a) => a.y1));
    const small = Math.max(x1 - x0, y1 - y0) * scale < COLLAPSE_PX;
    if (list.length > 1 && small) {
      const n = list.reduce((s, a) => s + a.n, 0);
      cands.push({ text: display(parent), x: list.reduce((s, a) => s + a.sx, 0) / n, y: labelTop(list.flatMap((a) => a.tops)), px: Math.min(34, 18 + Math.sqrt(n) * 2.6), prio: prio(list), mods: list.map((a) => a.m) });
    } else {
      for (const a of list) {
        // Drop the parent only where it repeats a lot (a "projects/" folder with dozens of entries); small repos keep "app/server".
        const short = list.length >= SHORTEN_FROM && a.m !== parent ? a.m.slice(parent.length + 1) : display(a.m);
        cands.push({ text: short, x: a.sx / a.n, y: labelTop(a.tops), px: Math.min(28, 15 + Math.sqrt(a.n) * 2.4), prio: prio([a]), mods: [a.m] });
      }
    }
  }
  // Two short names that read the same ("src" in two places) keep their full path.
  const seen = new Map<string, number>();
  for (const c of cands) seen.set(c.text, (seen.get(c.text) ?? 0) + 1);
  for (const c of cands) if ((seen.get(c.text) ?? 0) > 1 && c.mods.length === 1) c.text = display(c.mods[0]);

  cands.sort((a, b) => b.prio - a.prio);
  const style = mapStyle(), font = style.moduleFont ?? opts.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  for (const c of cands) {
    const px = c.px / scale, y = c.y - 10 / scale;
    ctx.font = `700 ${px}px ${font}`;
    const w = ctx.measureText(c.text).width, pad = 8 / scale;
    const box = { x0: c.x - w / 2 - pad, x1: c.x + w / 2 + pad, y0: y - px - pad / 2, y1: y + pad / 2 };
    const focused = c.mods.some((m) => opts.focus.has(m));
    if (!opts.space.claim(box, focused)) continue;
    const lively = focused || c.prio >= 1e5;
    if (style.moduleColored) { ctx.globalAlpha = lively ? 0.95 : 0.7; ctx.fillStyle = moduleColor(c.mods[0]); }
    else ctx.fillStyle = lively ? style.moduleInkLively : style.moduleInk;
    ctx.fillText(c.text, c.x, y);
    ctx.globalAlpha = 1;
  }
}

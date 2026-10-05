// Owned by the lead. Folder names on the map without the pile-up.
// 1. Labels are drawn by priority (folder under the pointer or selected, then where agents work, then recent edits,
//    then size), and a label that would overlap one already drawn is skipped, like town names on a map.
// 2. Subfolders fold into one label for their parent folder while the group is small on screen; zoomed in, each
//    subfolder shows its own name, without the parent's when the parent has many ("alpha", not "projects/alpha").
// Colours and fonts follow the map theme (map/themes.ts).
// 3. Folder names sit above their group (or below it), never on its files.
// File names use the same idea: one LabelSpace per frame holds the files' footprints, the folder names, the replay's
// badges and the file names, so no name prints over a file, a badge or another name.

import { mapStyle, moduleColor } from "./themes";

/** `r`: how far the file reaches on the canvas (themes.ts reachOf), not its bare radius. */
export type LabelNode = { x?: number; y?: number; r: number; module: string; lastChangedAt?: string; active: boolean };

export type Box = { x0: number; y0: number; x1: number; y1: number; own?: string };

/**
 * Space taken this frame, in graph coordinates: names already placed, and the files themselves (added before the names),
 * so a name never prints over a file. A coarse grid keeps it cheap with hundreds of files every frame.
 */
export class LabelSpace {
  private cells = new Map<string, Box[]>();
  private cell = 40;
  /** A new frame. `cell`: the grid's cell size in graph units (about 48px on screen suits names). */
  reset(cell = 40) { this.cells.clear(); this.cell = Math.max(1, cell); }
  private keys(b: Box) {
    const c = this.cell, out: string[] = [];
    for (let i = Math.floor(b.x0 / c); i <= Math.floor(b.x1 / c); i++) for (let j = Math.floor(b.y0 / c); j <= Math.floor(b.y1 / c); j++) out.push(i + "," + j);
    return out;
  }
  /** Whether the box overlaps anything taken; `own` skips that file's own footprint (its name may sit right by it). */
  hits(b: Box, own?: string) {
    for (const k of this.keys(b)) for (const o of this.cells.get(k) ?? []) {
      if (own !== undefined && o.own === own) continue;
      if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
    }
    return false;
  }
  add(b: Box) { for (const k of this.keys(b)) { const l = this.cells.get(k); if (l) l.push(b); else this.cells.set(k, [b]); } }
  /** Takes the box if it's free (or `force`d) and says whether the label may be drawn. */
  claim(b: Box, force = false, own?: string) { if (!force && this.hits(b, own)) return false; this.add(b); return true; }
  /** A file's footprint (its centre and how far its mark reaches), so names keep off it. */
  file(id: string, x: number, y: number, r: number) { this.add({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, own: id }); }
}

/** A file name waiting for the label pass (graph coordinates; `y` is the top of the text). */
export type QueuedLabel = {
  text: string; x: number; y: number; size: number; scale: number; alpha: number;
  font: string; ink: string; halo: string; prio: number; forced: boolean;
  /** Its file (id, centre, reach): a name that can't sit under it tries above, right, then left of it. */
  at?: { id: string; x: number; y: number; r: number };
  /** Drawn even when every spot is taken (the selected file, the one you point at). */
  must?: boolean;
};

/**
 * File names, drawn in one pass after all the files so no circle covers one. Higher priority claims its space first
 * and is drawn last, so it sits on top. A name tries under its file, then above, right and left; where all four would
 * print over a file, a badge or a name taken first, it waits for the zoom. Only a `must` one (selected, pointed at)
 * is drawn anyway, under its file. `forced` names (those, and where an agent works) skip the size and zoom cut in MapView.
 */
export function drawQueuedLabels(ctx: CanvasRenderingContext2D, queue: QueuedLabel[], space: LabelSpace) {
  if (!queue.length) return;
  const keep: QueuedLabel[] = [];
  queue.sort((a, b) => b.prio - a.prio);
  for (const l of queue) {
    ctx.font = l.font;
    // Air around a name, wider to the sides: two names in a row shouldn't read as one.
    const w = ctx.measureText(l.text).width, px = 6 / l.scale, py = 2.5 / l.scale, g = 3 / l.scale, f = l.at;
    const box = (x: number, y: number): Box => ({ x0: x - w / 2 - px, x1: x + w / 2 + px, y0: y - py, y1: y + l.size + py });
    const spots: [number, number][] = [[l.x, l.y]];
    if (f) spots.push([f.x, f.y - f.r - g - l.size], [f.x + f.r + g + w / 2, f.y - l.size / 2], [f.x - f.r - g - w / 2, f.y - l.size / 2]);
    const spot = spots.find(([x, y]) => !space.hits(box(x, y), f?.id)) ?? (l.must ? spots[0] : undefined);
    if (!spot) continue;
    space.add(box(spot[0], spot[1]));
    keep.push({ ...l, x: spot[0], y: spot[1] });
  }
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = keep.length - 1; i >= 0; i--) {
    const l = keep[i];
    ctx.globalAlpha = l.alpha;
    ctx.font = l.font;
    ctx.lineWidth = 3 / l.scale;
    ctx.strokeStyle = l.halo;
    ctx.strokeText(l.text, l.x, l.y);
    ctx.fillStyle = l.ink;
    ctx.fillText(l.text, l.x, l.y);
  }
  ctx.restore();
}

const HOUR = 3_600_000;
const COLLAPSE_PX = 280;          // a parent's subfolders fold into one label below this size on screen
const SHORTEN_FROM = 4;           // subfolders a parent needs before their labels drop its name

const parentOf = (m: string) => (!m || m === "." ? "." : m.split("/")[0]);
const display = (m: string) => (!m || m === "." ? "root" : m);

/** The edge of a group, leaving out a stray file or two (a far import can pull one out), so the name doesn't follow it. */
const edge = (ys: number[], k: number) => { const t = [...ys].sort((a, b) => a - b); return t[Math.min(t.length - 1, Math.floor(t.length * k))]; };

type Agg = { m: string; n: number; sx: number; sy: number; x0: number; x1: number; y0: number; y1: number; tops: number[]; bots: number[]; recent: number; busy: boolean };

function aggregate(nodes: LabelNode[], key: (n: LabelNode) => string) {
  const out = new Map<string, Agg>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    const k = key(n);
    const a = out.get(k) ?? { m: k, n: 0, sx: 0, sy: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, tops: [], bots: [], recent: 0, busy: false };
    a.n++; a.sx += n.x; a.sy += n.y;
    a.x0 = Math.min(a.x0, n.x - n.r); a.x1 = Math.max(a.x1, n.x + n.r);
    a.y0 = Math.min(a.y0, n.y - n.r); a.y1 = Math.max(a.y1, n.y + n.r); a.tops.push(n.y - n.r); a.bots.push(n.y + n.r);
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

  type Cand = { text: string; x: number; top: number; bot: number; px: number; prio: number; mods: string[] };
  const ends = (list: Agg[]) => ({ top: edge(list.flatMap((a) => a.tops), 0.04), bot: edge(list.flatMap((a) => a.bots), 0.96) });
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
      cands.push({ text: display(parent), x: list.reduce((s, a) => s + a.sx, 0) / n, ...ends(list), px: Math.min(34, 18 + Math.sqrt(n) * 2.6), prio: prio(list), mods: list.map((a) => a.m) });
    } else {
      for (const a of list) {
        // Drop the parent only where it repeats a lot (a "projects/" folder with dozens of entries); small repos keep "app/server".
        const short = list.length >= SHORTEN_FROM && a.m !== parent ? a.m.slice(parent.length + 1) : display(a.m);
        cands.push({ text: short, x: a.sx / a.n, ...ends([a]), px: Math.min(28, 15 + Math.sqrt(a.n) * 2.4), prio: prio([a]), mods: [a.m] });
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
    const px = c.px / scale, gap = 6 / scale;
    ctx.font = `700 ${px}px ${font}`;
    const w = ctx.measureText(c.text).width, pad = 8 / scale;
    const box = (y: number) => ({ x0: c.x - w / 2 - pad, x1: c.x + w / 2 + pad, y0: y - px - pad / 2, y1: y + pad / 2 });
    // The name sits above its group, never on its files (they're in the space already): just above, a little higher, then below.
    const spots = [c.top - gap, c.top - gap - px * 0.8, c.bot + gap + px];
    const focused = c.mods.some((m) => opts.focus.has(m));
    const y = spots.find((s) => !opts.space.hits(box(s))) ?? (focused ? spots[0] : undefined);
    if (y === undefined) continue;
    opts.space.add(box(y));
    const lively = focused || c.prio >= 1e5;
    if (style.moduleColored) { ctx.globalAlpha = lively ? 0.95 : 0.7; ctx.fillStyle = moduleColor(c.mods[0]); }
    else ctx.fillStyle = lively ? style.moduleInkLively : style.moduleInk;
    ctx.fillText(c.text, c.x, y);
    ctx.globalAlpha = 1;
  }
}

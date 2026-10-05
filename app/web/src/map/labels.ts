// Owned by the lead. Folder names on the map without the pile-up.
// 1. Labels are drawn by priority (folder under the pointer or selected, then where agents work, then recent edits,
//    then size), and a label that would overlap one already drawn is skipped, like town names on a map.
// 2. Subfolders fold into one label for their parent folder while the group is small on screen; zoomed in, each
//    subfolder shows its own name, without the parent's when the parent has many ("alpha", not "projects/alpha").
// Colours and fonts follow the map theme (map/themes.ts).
// 3. Folder names sit above their group (or below it), never on its files.
// File names use the same idea: one LabelSpace per frame holds the files' footprints, the folder names, the replay's
// badges and the file names, so no name prints over a file, a badge or another name.
// For big maps (perf-canvas): the files' footprints and the folders' outlines are kept between frames until something
// moves, text widths are measured once per font, and only the names on screen are placed and drawn.

import { mapStyle, moduleColor } from "./themes";

/** `r`: how far the file reaches on the canvas (themes.ts reachOf), not its bare radius. */
export type LabelNode = { x?: number; y?: number; r: number; module: string; lastChangedAt?: string; active: boolean };

export type Box = { x0: number; y0: number; x1: number; y1: number; own?: string };

/** Boxes in a coarse grid (numeric cell keys: no strings built per lookup). */
class Grid {
  private cells = new Map<number, Box[]>();
  private cell = 40;
  reset(cell: number) { this.cells.clear(); this.cell = Math.max(1e-6, cell); }
  hits(b: Box, own?: string) {
    const c = this.cell, i1 = Math.floor(b.x1 / c), j0 = Math.floor(b.y0 / c), j1 = Math.floor(b.y1 / c);
    for (let i = Math.floor(b.x0 / c); i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.cells.get(i * 65536 + j);
      if (l) for (const o of l) {
        if (own !== undefined && o.own === own) continue;
        if (b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0) return true;
      }
    }
    return false;
  }
  add(b: Box) {
    const c = this.cell, i1 = Math.floor(b.x1 / c), j0 = Math.floor(b.y0 / c), j1 = Math.floor(b.y1 / c);
    for (let i = Math.floor(b.x0 / c); i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i * 65536 + j, l = this.cells.get(k);
      if (l) l.push(b); else this.cells.set(k, [b]);
    }
  }
}

/**
 * Space taken this frame, in graph coordinates: names already placed, and the files themselves (added before the names),
 * so a name never prints over a file. The files' layer is kept from frame to frame until its key changes (they moved,
 * the zoom changed a lot, the focus changed): a frame that only moves an agent doesn't lay out every file again.
 */
export class LabelSpace {
  private names = new Grid();
  private files = new Grid();
  private filesKey: string | null = null;
  /** A new frame. `cell`: the grid's cell size in graph units (about 48px on screen suits names). */
  reset(cell = 40) { this.names.reset(cell); }
  /** The files' footprints: `fill` adds them, only when `key` differs from the last frame's. */
  fileLayer(key: string, cell: number, fill: (add: (id: string, x: number, y: number, r: number) => void) => void) {
    if (key === this.filesKey) return;
    this.filesKey = key;
    this.files.reset(cell);
    fill((id, x, y, r) => this.files.add({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, own: id }));
  }
  /** Whether the box overlaps anything taken; `own` skips that file's own footprint (its name may sit right by it). */
  hits(b: Box, own?: string) { return this.files.hits(b, own) || this.names.hits(b, own); }
  add(b: Box) { this.names.add(b); }
  /** Takes the box if it's free (or `force`d) and says whether the label may be drawn. */
  claim(b: Box, force = false, own?: string) { if (!force && this.hits(b, own)) return false; this.add(b); return true; }
  /** A file's footprint for this frame only (the selected file's ring, wider than its mark). */
  file(id: string, x: number, y: number, r: number) { this.names.add({ x0: x - r, x1: x + r, y0: y - r, y1: y + r, own: id }); }
}

// ---------- text widths, measured once per font ----------
const REF = 100;
const widths = new Map<string, number>();
/** Width of `text` at `px` pixels in `weight` `family`: measured once at 100px, then scaled (canvas text scales linearly). */
export function textWidth(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, px: number) {
  const k = weight + "|" + family + "|" + text;
  let w = widths.get(k);
  if (w === undefined) {
    const font = ctx.font;
    ctx.font = `${weight} ${REF}px ${family}`;
    w = ctx.measureText(text).width / REF;
    ctx.font = font;
    if (widths.size > 20000) widths.clear();
    widths.set(k, w);
  }
  return w * px;
}
/** Forget measured widths (a web font finished loading). */
export function clearTextWidths() { widths.clear(); }

/** A file name waiting for the label pass (graph coordinates; `y` is the top of the text). */
export type QueuedLabel = {
  text: string; x: number; y: number; size: number; scale: number; alpha: number;
  weight: number; family: string; ink: string; halo: string; prio: number; forced: boolean;
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
 * The queue holds only files on screen; MapView keeps the highest priorities when there are very many.
 */
export function drawQueuedLabels(ctx: CanvasRenderingContext2D, queue: QueuedLabel[], space: LabelSpace) {
  if (!queue.length) return;
  const keep: QueuedLabel[] = [];
  queue.sort((a, b) => b.prio - a.prio);
  for (const l of queue) {
    // Air around a name, wider to the sides: two names in a row shouldn't read as one.
    const w = textWidth(ctx, l.text, l.weight, l.family, l.size), px = 6 / l.scale, py = 2.5 / l.scale, g = 3 / l.scale, f = l.at;
    const box = (x: number, y: number): Box => ({ x0: x - w / 2 - px, x1: x + w / 2 + px, y0: y - py, y1: y + l.size + py });
    let sx = l.x, sy = l.y, ok = !space.hits(box(sx, sy), f?.id);
    if (!ok && f) {
      const spots: [number, number][] = [[f.x, f.y - f.r - g - l.size], [f.x + f.r + g + w / 2, f.y - l.size / 2], [f.x - f.r - g - w / 2, f.y - l.size / 2]];
      for (const [x, y] of spots) if (!space.hits(box(x, y), f.id)) { sx = x; sy = y; ok = true; break; }
    }
    if (!ok && !l.must) continue;
    if (!ok) { sx = l.x; sy = l.y; }
    space.add(box(sx, sy));
    l.x = sx; l.y = sy;
    keep.push(l);
  }
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = keep.length - 1; i >= 0; i--) {
    const l = keep[i];
    ctx.globalAlpha = l.alpha;
    ctx.font = `${l.weight} ${l.size}px ${l.family}`;
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
const MAX_FOLDER_LABELS = 240;    // drawn per frame at most (the most important first): a huge map stays readable and quick

const parentOf = (m: string) => (!m || m === "." ? "." : m.split("/")[0]);
const display = (m: string) => (!m || m === "." ? "root" : m);

/** The edge of a group, leaving out a stray file or two (a far import can pull one out), so the name doesn't follow it. */
const edge = (ys: Float64Array, k: number) => { const t = ys.sort(); return t[Math.min(t.length - 1, Math.floor(t.length * k))]; };

/** A folder's files on the map: where they are, how far they spread, its group's edges, how recently and whether busy. */
export type FolderAgg = { m: string; n: number; sx: number; x0: number; x1: number; y0: number; y1: number; top: number; bot: number; recent: number; busy: boolean };
/** A parent folder and its subfolders (the label that folds them together while they're small). */
export type ParentAgg = { parent: string; mods: FolderAgg[]; n: number; sx: number; span: number; x0: number; x1: number; y0: number; y1: number; top: number; bot: number };
export type Folders = { parents: ParentAgg[] };

/**
 * The folders' outlines, from the files: one pass, kept by MapView until the layout moves, the files change or the
 * focus changes (sorting every file's edge on every frame was the cost on a big map).
 */
export function aggregateFolders(nodes: Iterable<LabelNode>): Folders {
  type Acc = FolderAgg & { tops: number[]; bots: number[] };
  const mods = new Map<string, Acc>();
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    let a = mods.get(n.module);
    if (!a) mods.set(n.module, (a = { m: n.module, n: 0, sx: 0, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, top: 0, bot: 0, recent: 0, busy: false, tops: [], bots: [] }));
    a.n++; a.sx += n.x;
    a.x0 = Math.min(a.x0, n.x - n.r); a.x1 = Math.max(a.x1, n.x + n.r);
    a.y0 = Math.min(a.y0, n.y - n.r); a.y1 = Math.max(a.y1, n.y + n.r); a.tops.push(n.y - n.r); a.bots.push(n.y + n.r);
    const t = n.lastChangedAt ? Date.parse(n.lastChangedAt) : 0;
    if (t > a.recent) a.recent = t;
    if (n.active) a.busy = true;
  }
  const groups = new Map<string, Acc[]>();
  for (const a of mods.values()) { const p = parentOf(a.m); const l = groups.get(p); if (l) l.push(a); else groups.set(p, [a]); }
  const parents: ParentAgg[] = [];
  for (const [parent, list] of groups) {
    let n = 0, sx = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, len = 0;
    for (const a of list) { n += a.n; sx += a.sx; x0 = Math.min(x0, a.x0); x1 = Math.max(x1, a.x1); y0 = Math.min(y0, a.y0); y1 = Math.max(y1, a.y1); len += a.tops.length; }
    let top = 0, bot = 0;
    if (list.length > 1) {
      const tops = new Float64Array(len), bots = new Float64Array(len);
      let i = 0;
      for (const a of list) { tops.set(a.tops, i); bots.set(a.bots, i); i += a.tops.length; }
      top = edge(tops, 0.04); bot = edge(bots, 0.96);
    }
    const mods: FolderAgg[] = list.map((a) => ({ m: a.m, n: a.n, sx: a.sx, x0: a.x0, x1: a.x1, y0: a.y0, y1: a.y1,
      top: edge(Float64Array.from(a.tops), 0.04), bot: edge(Float64Array.from(a.bots), 0.96), recent: a.recent, busy: a.busy }));
    if (list.length === 1) { top = mods[0].top; bot = mods[0].bot; }
    parents.push({ parent, mods, n, sx, span: Math.max(x1 - x0, y1 - y0), x0, x1, y0, y1, top, bot });
  }
  return { parents };
}

export function drawModuleLabels(ctx: CanvasRenderingContext2D, scale: number, folders: Folders, opts: {
  font: string; now: number; focus: Set<string>; busy: Set<string>; space: LabelSpace;
  /** With a thread open: the folders that have files in its focus. The others' names step back with their files. */
  lit?: Set<string> | null;
  /** With a thread open: when the thread last changed something in each folder (its files' own times don't count then). */
  focusRecent?: Map<string, number> | null;
  /** The part of the map on screen (graph units): names elsewhere aren't placed. */
  view?: Box;
}) {
  type Cand = { text: string; x: number; top: number; bot: number; px: number; prio: number; mods: string[] };
  const fr = opts.focusRecent;
  const recentOf = (a: FolderAgg) => (fr ? fr.get(a.m) ?? 0 : a.recent);
  const prio = (list: FolderAgg[]) => {
    let p = 0, recent = 0, busy = false, focus = false;
    for (const a of list) {
      p += a.n; recent = Math.max(recent, recentOf(a));
      if ((!fr && a.busy) || opts.busy.has(a.m)) busy = true;
      if (opts.focus.has(a.m)) focus = true;
    }
    if (recent && opts.now - recent < HOUR) p += 1000 * (1 - (opts.now - recent) / HOUR);
    if (busy) p += 1e5;
    if (focus) p += 1e6;
    return p;
  };
  const cands: Cand[] = [];
  for (const g of folders.parents) {
    const small = g.span * scale < COLLAPSE_PX;
    if (g.mods.length > 1 && small) {
      cands.push({ text: display(g.parent), x: g.sx / g.n, top: g.top, bot: g.bot, px: Math.min(34, 18 + Math.sqrt(g.n) * 2.6), prio: prio(g.mods), mods: g.mods.map((a) => a.m) });
    } else {
      for (const a of g.mods) {
        // Drop the parent only where it repeats a lot (a "projects/" folder with dozens of entries); small repos keep "app/server".
        const short = g.mods.length >= SHORTEN_FROM && a.m !== g.parent ? a.m.slice(g.parent.length + 1) : display(a.m);
        cands.push({ text: short, x: a.sx / a.n, top: a.top, bot: a.bot, px: Math.min(28, 15 + Math.sqrt(a.n) * 2.4), prio: prio([a]), mods: [a.m] });
      }
    }
  }
  // Two short names that read the same ("src" in two places) keep their full path.
  const seen = new Map<string, number>();
  for (const c of cands) seen.set(c.text, (seen.get(c.text) ?? 0) + 1);
  for (const c of cands) if ((seen.get(c.text) ?? 0) > 1 && c.mods.length === 1) c.text = display(c.mods[0]);

  cands.sort((a, b) => b.prio - a.prio);
  const style = mapStyle(), font = style.moduleFont ?? opts.font, v = opts.view;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  let drawn = 0;
  for (const c of cands) {
    if (drawn >= MAX_FOLDER_LABELS) break;
    const px = c.px / scale, gap = 6 / scale;
    // Off screen (with room for the widest name): not placed, not drawn.
    if (v && (c.x + 40 * px < v.x0 || c.x - 40 * px > v.x1 || c.bot + gap + px < v.y0 || c.top - gap - 2 * px > v.y1)) continue;
    const w = textWidth(ctx, c.text, 700, font, px), pad = 8 / scale;
    const box = (y: number) => ({ x0: c.x - w / 2 - pad, x1: c.x + w / 2 + pad, y0: y - px - pad / 2, y1: y + pad / 2 });
    // The name sits above its group, never on its files (they're in the space already): just above, a little higher, then below.
    const spots = [c.top - gap, c.top - gap - px * 0.8, c.bot + gap + px];
    const focused = c.mods.some((m) => opts.focus.has(m));
    const y = spots.find((s) => !opts.space.hits(box(s))) ?? (focused ? spots[0] : undefined);
    if (y === undefined) continue;
    opts.space.add(box(y));
    drawn++;
    const lively = focused || c.prio >= 1e5;
    const back = !focused && !!opts.lit && !c.mods.some((m) => opts.lit!.has(m));   // none of its files in the thread's focus
    ctx.font = `700 ${px}px ${font}`;
    if (style.moduleColored) { ctx.globalAlpha = lively ? 0.95 : 0.7; ctx.fillStyle = moduleColor(c.mods[0]); }
    else ctx.fillStyle = lively ? style.moduleInkLively : style.moduleInk;
    if (back) ctx.globalAlpha *= 0.3;
    ctx.fillText(c.text, c.x, y);
    ctx.globalAlpha = 1;
  }
}

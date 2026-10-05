// Owned by the lead. Names on the map without the pile-up. One LabelSpace per frame holds the files' footprints, the
// open folders' names (drawNode.ts drawFolderNames), the replay's badges and the file names, so no name prints over a
// file, a badge or another name; a name with no room waits for the zoom, like town names on a map. Names are stamped
// from small cached pictures (their outline stroked once), measured at their size on screen, and only the ones on
// screen are placed and drawn. Colours and fonts follow the map theme (map/themes.ts).

import { bucket, sprite, type Sprite } from "./sprites";

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
/**
 * Width of `text` at `px` in `weight` `family`: measured once at `ref` pixels, then scaled. Close enough for folder
 * names; a file name passes its size on screen as `ref`, since system fonts space small text wider than big text
 * (San Francisco: about 14% at 12px against 100px).
 */
export function textWidth(ctx: CanvasRenderingContext2D, text: string, weight: number, family: string, px: number, ref = REF) {
  const k = weight + "|" + family + "|" + ref + "|" + text;
  let w = widths.get(k);
  if (w === undefined) {
    const font = ctx.font;
    ctx.font = `${weight} ${ref}px ${family}`;
    w = ctx.measureText(text).width / ref;
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
    const on = bucket(l.size * l.scale), w = textWidth(ctx, l.text, l.weight, l.family, on, on) / l.scale, px = 6 / l.scale, py = 2.5 / l.scale, g = 3 / l.scale, f = l.at;
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
  // Each name is a small picture (its outline stroked once), copied in device pixels: stroking every name's outline on
  // every frame was most of a frame zoomed in, where many names fit.
  const m = ctx.getTransform(), dpr = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = keep.length - 1; i >= 0; i--) {
    const l = keep[i], s = nameSprite(ctx, l);
    if (!s) continue;
    ctx.globalAlpha = l.alpha;
    const dx = l.x * m.a + l.y * m.c + m.e, dy = l.x * m.b + l.y * m.d + m.f;   // the text's top centre, in device pixels
    ctx.drawImage(s.canvas, Math.round(dx - s.ox * dpr), Math.round(dy - s.oy * dpr));
  }
  ctx.restore();
}

/** A name with its outline, `px` pixels on screen, its top centre at graph point (x, y): stamped like the file names. */
export function drawName(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, px: number, weight: number, family: string, ink: string, halo: string, alpha: number) {
  const s = nameSprite(ctx, { text, x, y, size: px, scale: 1, alpha, weight, family, ink, halo, prio: 0, forced: false });
  if (!s) return;
  const m = ctx.getTransform(), dpr = (typeof devicePixelRatio === "number" && devicePixelRatio) || 1;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(s.canvas, Math.round(x * m.a + y * m.c + m.e - s.ox * dpr), Math.round(x * m.b + y * m.d + m.f - s.oy * dpr));
  ctx.restore();
}

/** A name with its outline, as the label pass draws it, at its size on screen (half-pixel buckets): (ox, oy) is its top centre. */
function nameSprite(ctx: CanvasRenderingContext2D, l: QueuedLabel): Sprite | null {
  const px = bucket(l.size * l.scale), halo = 1.5, w = textWidth(ctx, l.text, l.weight, l.family, px, px);
  const W = Math.ceil(w + 2 * halo + 2), H = Math.ceil(px * 1.3 + 2 * halo + 2), ox = W / 2, oy = halo + 1;
  return sprite(`name|${l.text}|${l.weight}|${l.family}|${l.ink}|${l.halo}|${px}`, W, H, ox, oy, (c) => {
    c.font = `${l.weight} ${px}px ${l.family}`;
    c.textAlign = "center"; c.textBaseline = "top";
    c.lineJoin = "round"; c.lineWidth = 2 * halo; c.strokeStyle = l.halo;
    c.strokeText(l.text, ox, oy);
    c.fillStyle = l.ink;
    c.fillText(l.text, ox, oy);
  });
}

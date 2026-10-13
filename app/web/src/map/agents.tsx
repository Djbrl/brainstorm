// Live agents on the Map: markers that glide between files, fading trails, lines of sight to the files they read.
import type { AgentPresence } from "@contract";
import { clock } from "../lib/live";
import { mapStyle, type RGB } from "./themes";
import { drawMarker } from "./marks";
import { drawTrip, platform } from "./routes";
import { hex, mixRGB, rgbOf, same } from "./color";
import { hashString } from "./util";
import { drawPulse, drawThinkRing, ERR_PULSE_MS, ERROR_RED, glide, PULSE_MS, setOff, trailPath } from "./tracer";
export { ERROR_RED } from "./tracer";

/** Main threads get the accent (Metro: their own ink line); subagents a colour from the theme's palette, by id. */
export function agentColor(a: Pick<AgentPresence, "id" | "isSubagent">, accent: string): string {
  if (!a.isSubagent) return mapStyle().track ?? accent;
  const palette = mapStyle().palette;
  return palette[hashString(a.id) % palette.length];
}

/** The letter's colour on an agent's colour: white on a dark one, near-black on a light one (the dark themes' pastels). */
export function inkOn(color: string): string {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color.trim())) return "#fff";
  const [r, g, b] = hex(color).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#111114" : "#fff";
}

export const shortName = (a: AgentPresence, max = 34) => {
  const n = a.name || a.id.slice(0, 7);
  return n.length > max ? n.slice(0, max - 1).trimEnd() + "…" : n;
};
/** The letter on an agent's mark: its task's first letter for a subagent ("Loader on result pages": L), the thread's for the main one. */
export const initial = (a: Pick<AgentPresence, "name" | "isSubagent">) => {
  const n = (a.name || "").replace(/^Subagent\s*·\s*/i, "").trim();
  return (n.match(/[\p{L}\p{N}]/u)?.[0] ?? (a.isSubagent ? "S" : "A")).toUpperCase();
};

const VERB_ING: Record<string, string> = {
  edit: "Editing", write: "Writing", read: "Reading", search: "Searching", run: "Running", delegate: "Delegating",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const verbIng = (a?: string) => (a ? VERB_ING[a] ?? cap(a) : "Working");
export { basename as baseName } from "@shared/text";

/** Agents worth drawing: active, or inactive for up to 10 minutes (faded). */
export function visibleAgents(agents: AgentPresence[], now = clock()): AgentPresence[] {
  return agents.filter((a) => a.active || now - Date.parse(a.ts) < 10 * 60_000);
}

/** The one faint look on the map, and it means only "not the focus": files outside the thread's recent steps, an agent
 *  of the thread you aren't watching (drawAgents' `dimmed`, thread/focus.ts). Nothing else is drawn faint. */
export const DIM = 0.4;
const IDLE_AFTER = 20_000, IDLE_FADE = 40_000;   // an agent at rest on the overview: lit a little longer, then gone

/**
 * How strongly a marker shows: lit while it works, waits on you or thinks. On the project overview, once it rests it
 * fades out over a short while and disappears (it doesn't linger faint: faint means "not the focus"); with its thread
 * open it stays, solid, where it last was (by its trail).
 */
export function agentAlpha(a: AgentPresence, now: number, busy: boolean, keep: boolean): number {
  if (a.active || busy) return 1;
  if (keep) return 1;   // a thread open: its agent, done, stays where it is now, as solid as it was (map, Readmap)
  return Math.max(0, Math.min(1, 1 - (now - Date.parse(a.ts) - IDLE_AFTER) / IDLE_FADE));
}

// ---------- canvas layer ----------
// Writes are movement: the marker sits on the last file the agent changed and glides there on each edit/write,
// and its trail links only write positions. Reads are a line of sight: the marker stays put and a thin line to
// the file read fades out. A step with no file (a search or a command) is a short pulse on the marker.
/** A breathing ring for the page to draw over the map: where (CSS pixels on the canvas), whose colour, how strong. */
export type AgentRing = { id: string; kind: "think" | "wait"; x: number; y: number; color: string; alpha: number };

export type AgentAnim = {
  x: number; y: number; fromX: number; fromY: number; t0: number; file: string; alpha: number;
  seen: Set<string>; seeded: boolean;           // trail entries already accounted for (no flash on first sight)
  flashes: { file: string; t0: number }[];      // recent reads to draw as lines of sight
  lastTs: string; pulseT0: number;              // activity without a new file → pulse
  lastErr?: string; errT0: number;              // a failed tool call → the marker flashes red
  landedT0?: number;                            // the trip whose landing was announced (Prism: the cube flashes)
  // Changing state eases (STATE_EASE): the marker's colour (its own, error red, greyed at rest), the thinking and
  // waiting rings fading in and out; `easing` while any is still on its way (useLiveAgents keeps the frames coming).
  col?: RGB; thinkA?: number; waitA?: number; easeT?: number; easing?: boolean;
  // Kept between frames so a frame allocates nothing for an agent that didn't change (drawAgents):
  /** What its trail gave, for the trail object it came with (a new one per agent message) and the resolver. */
  read?: { trail: AgentPresence["trail"]; resolveId: (file: string) => string | undefined; was: string | undefined; anchor: string;
    files: string[]; key: string; reads: string[] };
  /** The colour it eases toward, for its state's colour and whether it rests. */
  want?: { color: string; resting: boolean; rgb: RGB };
  /** The marker's CSS colour, for the rounded colour it was made from (r << 16 | g << 8 | b). */
  markCss?: string; markKey?: number;
  /** Its trail's points this frame (reused). */
  pts?: Pt[];
};
type Pt = { x: number; y: number; r: number };
const READ_MS = 1500;
const READS_SHOWN = 4;      // the files it read lately that keep a dotted line
const ERR_MS = 2600;        // how long the marker stays red
const WAIT_MS = 1800;       // the amber ring's breath while an agent waits on you
const STATE_EASE = 0.16;    // seconds for a marker to (nearly) take its new state's colour and rings
const REST_GREY: RGB = [176, 180, 190];   // at rest, the marker's colour turns this much toward grey (REST_MIX)
const REST_MIX = 0.55;
const toward = (a: number, b: number, f: number) => (Math.abs(b - a) < 0.01 ? b : a + (b - a) * f);
/** Eases `a` toward `b`, in place. */
const easeRGB = (a: RGB, b: RGB, f: number) => {
  for (let i = 0; i < 3; i++) a[i] = Math.abs(b[i] - a[i]) < 0.5 ? b[i] : a[i] + (b[i] - a[i]) * f;
};
const WAIT_AMBER = "#f59e0b";
const WAIT_TEXT = "#9a5800";      // on a light outline
const WAIT_TEXT_DARK = "#ffc56b"; // on a dark one (Prism, Hologram)
/** A dark theme draws labels on a dark outline (its halo). */
const darkHalo = (halo: string) => Number(/\d+/.exec(halo)?.[0] ?? 255) < 128;
export const isWrite = (action?: string) => action === "edit" || action === "write";

/** The files an agent read lately (map node ids), newest first: the last few distinct ones in its trail, but `except`
 *  (the file it stands on). The map draws them as dotted lines, the Readmap too (often they're out of view). */
export function recentReads(a: AgentPresence, resolveId: (file: string) => string | undefined, except?: string, max = READS_SHOWN): string[] {
  return readsWithTimes(a, resolveId, except, max).map((r) => r.id);
}
/** The same, with when each was read (ms). */
export function readsWithTimes(a: AgentPresence, resolveId: (file: string) => string | undefined, except?: string, max = READS_SHOWN): { id: string; at: number }[] {
  const reads: { id: string; at: number }[] = [];
  for (let i = a.trail.length - 1; i >= 0 && reads.length < max; i--) {
    const m = a.trail[i];
    if (m.action !== "read") continue;   // a file it opened (not a search's folder, nor a command's)
    const id = resolveId(m.file);
    if (id && id !== except && !reads.some((r) => r.id === id)) reads.push({ id, at: Date.parse(m.ts) || 0 });
  }
  return reads;
}

/** When an agent last read a file (ms), or 0. */
export function lastReadAt(a: AgentPresence): number {
  for (let i = a.trail.length - 1; i >= 0; i--) if (a.trail[i].action === "read") return Date.parse(a.trail[i].ts) || 0;
  return 0;
}

/** Where an agent waits that hasn't touched a file yet: the top of the project's circle (MapView adds it to the nodes). */
export const PARK = "@project";

/** Where the marker stands (a map node): the last file it changed (an edit, a write, a command that edits). Reads never
 *  move it (they are lines of sight and the Readmap). Before it changes anything, or with what it changed off the map,
 *  where it stood already (`was`); else the top of the project (PARK). Never nowhere: an agent that existed but stood
 *  on no file used to be left off the map, which looked broken. */
export function anchorFile(a: AgentPresence, resolveId: (file: string) => string | undefined, was?: string): string {
  for (let i = a.trail.length - 1; i >= 0; i--) if (isWrite(a.trail[i].action)) { const id = resolveId(a.trail[i].file); if (id) return id; }
  return was ?? PARK;
}

export function drawAgents(opts: {
  ctx: CanvasRenderingContext2D; scale: number; agents: AgentPresence[]; anim: Map<string, AgentAnim>;
  resolve: (file: string) => Pt | undefined; accent: string; font: string; hoverFile: string | null; followId: string | null;
  resolveId: (file: string) => string | undefined; showReads: boolean;
  /** The project overview: markers only (no trails, no lines of sight), until a thread or an agent is picked. */
  quiet?: boolean;
  /** Agents waiting on you (attention), by agent id → the label to show. They stay lit and breathe amber. */
  waiting?: ReadonlyMap<string, string>;
  /** Agents thinking (mid-turn, nothing logged yet): lit, a slow ring in their colour, "Thinking…". */
  thinking?: ReadonlySet<string>;
  /** A thread is open: its agents stay where they last were once they stop. */
  keep?: boolean;
  /** Agents in the background (another agent of the thread, while you watch one): drawn faint. */
  dimmed?: ReadonlySet<string>;
  /** Agents whose replay marker stands in for them (you look back through their thread): the replay's marker is their
   *  one marker, where they were then; here only a small ring where they work now, and nothing once they rest. */
  behind?: ReadonlySet<string>;
  /** Filled with the rings that breathe (thinking, waiting on you), in CSS pixels on the canvas: the page draws them
   *  over the map (MapView's AgentRings, CSS animations), so a breath doesn't repaint the whole map. */
  rings?: AgentRing[];
  /** A marker landed on a file (Prism's hop: its cube spins up and flashes). */
  land?: (id: string, t: number) => void;
}) {
  const { ctx, scale, agents, anim, resolve, accent, hoverFile, followId, resolveId, showReads, quiet, waiting, thinking, keep, dimmed, behind, rings, land } = opts;
  // Graph point → CSS pixel on the canvas (its transform is in device pixels).
  const m = ctx.getTransform(), dpr = ctx.canvas.width / Math.max(1, ctx.canvas.clientWidth);
  const onScreen = (x: number, y: number) => ({ x: (m.a * x + m.c * y + m.e) / dpr, y: (m.b * x + m.d * y + m.f) / dpr });
  const t = performance.now();
  const now = clock();
  const style = mapStyle(), font = style.marker === "badge" ? style.labelFont ?? opts.font : opts.font;   // Metro names agents in its own type

  // Fan out agents standing on the same file (the groups and their lists are kept from frame to frame).
  for (const l of groups.values()) l.length = 0;
  for (const a of agents) {
    const st0 = anim.get(a.id), was = st0?.file, w = was && resolve(was) ? was : undefined;
    // Where it stands only changes with its trail (a new object per message), the resolver, or where it was.
    const r = st0?.read;
    const key = r && r.trail === a.trail && r.resolveId === resolveId && r.was === w ? r.anchor : anchorFile(a, resolveId, w);
    if (st0) { if (r && r.trail === a.trail && r.resolveId === resolveId) { r.was = w; r.anchor = key; } else st0.read = undefined; }
    if (!key) continue;
    const l = groups.get(key);
    if (l) l.push(a); else groups.set(key, [a]);
  }
  if (groups.size > 64) for (const [k, l] of groups) if (!l.length) groups.delete(k);

  for (const [key, group] of groups) {
    if (!group.length) continue;
    if (group.length > 1) group.sort(byId);
    const node = resolve(key);
    if (!node) continue;
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      const angle = -Math.PI / 4 + i * ((Math.PI * 2) / Math.max(group.length, 5));
      const dist = node.r + 11 / scale;
      const tx = node.x + Math.cos(angle) * dist, ty = node.y + Math.sin(angle) * dist;

      let st = anim.get(a.id);
      if (!st) {
        st = { x: tx, y: ty, fromX: tx, fromY: ty, t0: -1e9, file: key, alpha: 0, seen: new Set(), seeded: false, flashes: [], lastTs: a.ts, pulseT0: -1e9, errT0: -1e9, lastErr: a.errorAt };
        anim.set(a.id, st);
      }
      if (st.file !== key) { setOff(st, t); st.file = key; }
      const { p, e, trip } = glide(st, tx, ty, t, style.route, 1, () => land?.(key, t));
      const thinks = !!thinking?.has(a.id) && !waiting?.has(a.id);
      const target = agentAlpha(a, now, !!waiting?.has(a.id) || thinks, !!keep) * (dimmed?.has(a.id) ? DIM : 1);
      st.alpha += (target - st.alpha) * 0.08;

      // New trail entries: reads become lines of sight. Activity with no new file becomes a pulse. A trail already
      // read (the same object: no message since) has nothing new.
      let fresh = false;
      const known = st.read?.trail === a.trail && st.read.resolveId === resolveId ? st.read : undefined;
      if (!known) for (const m of a.trail) {
        const k = `${m.file}|${m.action}|${m.ts}`;
        if (st.seen.has(k)) continue;
        st.seen.add(k); fresh = true;
        if (st.seeded && !isWrite(m.action)) st.flashes.push({ file: m.file, t0: t });
      }
      if (st.seeded && a.ts !== st.lastTs && !fresh) st.pulseT0 = t;
      if (a.errorAt && a.errorAt !== st.lastErr) { st.lastErr = a.errorAt; if (Date.now() - Date.parse(a.errorAt) < 10_000) st.errT0 = t; }
      st.lastTs = a.ts; st.seeded = true;
      if (st.seen.size > 200) st.seen = new Set([...st.seen].slice(-60));
      // What its trail gives (the files it wrote, those it read lately), once per trail.
      const rd = known && known.key === key ? known : (st.read = {
        trail: a.trail, resolveId, was: st.read?.was, anchor: key, key, files: writtenFiles(a, resolveId), reads: recentReads(a, resolveId, key),
      });
      if (st.alpha < 0.01) { st.easing = false; continue; }
      if (behind?.has(a.id)) {   // looking back: where it works now, a small ring in its colour (amber: it waits on you)
        st.easing = false; st.flashes.length = 0;
        const waits = !!waiting?.has(a.id);
        if (a.active || thinks || waits) {
          ctx.globalAlpha = st.alpha;
          ctx.beginPath(); ctx.arc(st.x, st.y, 4.5 / scale, 0, Math.PI * 2);
          ctx.strokeStyle = waits ? WAIT_AMBER : agentColor(a, accent); ctx.lineWidth = 2 / scale; ctx.stroke();
          ctx.globalAlpha = 1;
        }
        continue;
      }

      const erring = t - st.errT0 < ERR_MS;
      const color = erring ? ERROR_RED : agentColor(a, accent);
      // Its state's colour, eased: its own while it works or thinks, red on an error, greyed once it rests.
      const resting = !a.active && !thinks && !waiting?.has(a.id) && !erring && !keep;   // with its thread open it keeps its colour
      if (st.want?.color !== color || st.want.resting !== resting) st.want = { color, resting, rgb: resting ? mixRGB(rgbOf(color), REST_GREY, REST_MIX) : rgbOf(color) };
      const want = st.want.rgb;
      const f = 1 - Math.exp(-Math.min(0.1, Math.max(0, (t - (st.easeT ?? t)) / 1000)) / STATE_EASE);
      st.easeT = t;
      // Eased in fractions and rounded only for the CSS string: rounding each frame would stall a channel a few
      // units short of its target (the step is ~0.1 at 60 fps), and the map would keep redrawing for nothing.
      if (st.col) easeRGB(st.col, want, f); else st.col = [want[0], want[1], want[2]];
      // One ring at a time, by what matters most: red (failed), then amber (needs you), then the thinking breath.
      const ringWait = !erring && !!waiting?.has(a.id), ringThink = !erring && !ringWait && thinks;
      st.thinkA = toward(st.thinkA ?? (ringThink ? 1 : 0), ringThink ? 1 : 0, f);
      st.waitA = toward(st.waitA ?? (ringWait ? 1 : 0), ringWait ? 1 : 0, f);
      st.easing = !same(st.col, want) || (st.thinkA > 0 && st.thinkA < 1) || (st.waitA > 0 && st.waitA < 1);
      const r0 = Math.round(st.col[0]), g0 = Math.round(st.col[1]), b0 = Math.round(st.col[2]), mk = (r0 << 16) | (g0 << 8) | b0;
      if (st.markKey !== mk || !st.markCss) { st.markKey = mk; st.markCss = `rgb(${r0},${g0},${b0})`; }
      const markCss = st.markCss;

      // Trail through the last distinct files it wrote, newest strongest.
      // Metro: through the marker's stops by each file, so the track it rode is the one it leaves.
      const pts = (st.pts ??= []);
      let np = 0;
      for (let k = Math.max(0, rd.files.length - 7); k < rd.files.length; k++) {
        const n = resolve(rd.files[k]);
        if (!n) continue;
        const q = pts[np] ?? (pts[np] = { x: 0, y: 0, r: 0 });
        np++;
        if (style.route !== "glide") { const pl = platform(n.x, n.y, n.r, scale, angle); q.x = pl.x; q.y = pl.y; q.r = 0; }
        else { q.x = n.x; q.y = n.y; q.r = n.r; }
      }
      pts.length = np;
      if (np) { const q = pts[np - 1]; q.x = st.x; q.y = st.y; q.r = 0; } // end at the marker
      if (pts.length > 1 && (!quiet || followId === a.id)) {
        ctx.lineCap = "round";
        for (let k = 0; k < pts.length - 1; k++) {
          const a0 = pts[k], a1 = pts[k + 1];
          const w = (k + 1) / (pts.length - 1);
          ctx.globalAlpha = st.alpha * (0.1 + 0.55 * w);
          ctx.strokeStyle = color;
          ctx.lineWidth = ((1.2 + 1.6 * w) * (style.trackWidth ?? 1)) / scale;
          trailPath(ctx, a0, a1, style.route, scale);
          if (style.glow) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
          ctx.stroke();
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(a0.x, a0.y, 2.8 / scale, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }

      // What it read lately: a dotted line from the marker to each of the last few files it read (not the one it stands
      // on), the newest strongest, until it reads others. Writes are the solid trail above.
      if (showReads && (!quiet || followId === a.id)) {
        const reads = rd.reads;
        if (reads.length) {
          dash[0] = 2.2 / scale; dash[1] = 3.6 / scale;
          ctx.setLineDash(dash);
          ctx.lineCap = "round";
          ctx.strokeStyle = color;
          for (let j = 0; j < reads.length; j++) {
            const n = resolve(reads[j]);
            if (!n) continue;
            const dx = n.x - st.x, dy = n.y - st.y, d = Math.hypot(dx, dy), stop = Math.max(0, d - n.r - 2 / scale);
            if (stop < 6 / scale) continue;
            ctx.globalAlpha = st.alpha * (0.62 - j * 0.12);
            ctx.lineWidth = 1.4 / scale;
            ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(st.x + (dx / d) * stop, st.y + (dy / d) * stop); ctx.stroke();
          }
          ctx.setLineDash(NO_DASH);
        }
      }

      // A read as it happens: a thin line from the marker to the file read and a small ring on it, fading out.
      if (st.flashes.length) { let kept = 0; for (const fl of st.flashes) if (t - fl.t0 < READ_MS) st.flashes[kept++] = fl; st.flashes.length = kept; }
      if (showReads && (!quiet || followId === a.id)) for (const f of st.flashes) {
        const id = resolveId(f.file);
        const n = id ? resolve(id) : undefined;
        if (!n) continue;
        const fade = 1 - (t - f.t0) / READ_MS;
        ctx.globalAlpha = st.alpha * fade * 0.75;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2 / scale;
        ctx.beginPath(); ctx.moveTo(st.x, st.y); ctx.lineTo(n.x, n.y); ctx.stroke();
        ctx.lineWidth = 1.6 / scale;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 / scale, 0, Math.PI * 2); ctx.stroke();
      }

      // A search or command without a file: one short pulse on the marker (not over another ring).
      if (!erring && !ringWait && !ringThink) drawPulse(ctx, st.x, st.y, (t - st.pulseT0) / PULSE_MS, 9, 12, color, 1.6, st.alpha * 0.55, scale);

      // A failed tool call: one red ring, wider than the activity pulse.
      drawPulse(ctx, st.x, st.y, (t - st.errT0) / ERR_PULSE_MS, 10, 26, ERROR_RED, 2.4, st.alpha * 0.8, scale);

      // The trip under way: Prism's afterimages behind.
      if (trip) drawTrip(ctx, style.route, trip, p, e, color, 9 / scale, st.alpha, scale);

      // Thinking: a slow ring in its colour, swelling and fading, until its next step. Waiting on you: an amber ring that
      // breathes, as long as it waits. Both breathe in the page over the map (`rings`), or here when nobody takes them.
      const at = rings && (st.thinkA > 0.01 || st.waitA > 0.01) ? onScreen(st.x, st.y) : null;
      if (st.thinkA > 0.01) {
        if (at) rings!.push({ id: a.id, kind: "think", x: at.x, y: at.y, color, alpha: st.alpha * st.thinkA });
        else drawThinkRing(ctx, st.x, st.y, t, color, st.alpha * st.thinkA, scale);
        ctx.globalAlpha = st.alpha;
      }

      const waitLabel = waiting?.get(a.id);
      if (st.waitA > 0.01) {
        if (at) rings!.push({ id: a.id, kind: "wait", x: at.x, y: at.y, color: WAIT_AMBER, alpha: st.alpha * st.waitA });
        else {
          const b = (t % WAIT_MS) / WAIT_MS;
          ctx.globalAlpha = st.alpha * st.waitA * (1 - b) * 0.9;
          ctx.beginPath(); ctx.arc(st.x, st.y, (11 + b * 16) / scale, 0, Math.PI * 2);
          ctx.strokeStyle = WAIT_AMBER; ctx.lineWidth = 2.6 / scale; ctx.stroke();
        }
        ctx.globalAlpha = st.alpha * st.waitA;
        ctx.beginPath(); ctx.arc(st.x, st.y, 12 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = WAIT_AMBER; ctx.lineWidth = 2.2 / scale; ctx.stroke();
      }

      // Marker
      ctx.globalAlpha = st.alpha;
      drawMarker(ctx, st.x, st.y, 9 / scale, markCss, initial(a), 10, font, scale, style);

      if (scale > 1.6 || hoverFile === key || followId === a.id || erring || waitLabel || (thinks && keep)) {
        const label = waitLabel ? `${shortName(a, 20)} · ${waitLabel}` : erring && a.error ? `${shortName(a, 20)} · ${a.error.slice(0, 48)}`
          : thinks ? `${shortName(a, 28)} · Thinking…` : !a.active ? `${shortName(a, 28)} · Done` : `${shortName(a, 28)} · ${a.away ?? verbIng(a.action)}`;
        ctx.font = `600 ${12 / scale}px ${font}`;
        ctx.textAlign = "left";
        const lx = st.x + 13 / scale, ly = st.y;
        ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = style.halo;
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = waitLabel ? (darkHalo(style.halo) ? WAIT_TEXT_DARK : WAIT_TEXT) : color;
        ctx.fillText(label, lx, ly);
      }
      ctx.globalAlpha = 1;
    }
  }
}

const groups = new Map<string, AgentPresence[]>();
const byId = (a: AgentPresence, b: AgentPresence) => a.id.localeCompare(b.id);
const dash = [0, 0], NO_DASH: number[] = [];
/** The last distinct files an agent wrote (map node ids), oldest first. */
function writtenFiles(a: AgentPresence, resolveId: (file: string) => string | undefined): string[] {
  const files: string[] = [];
  for (const m of a.trail) {
    if (!isWrite(m.action)) continue;
    const id = resolveId(m.file);
    if (id && files[files.length - 1] !== id) files.push(id);
  }
  return files;
}

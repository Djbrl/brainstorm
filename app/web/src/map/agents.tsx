// Live agents on the Map: markers that glide between files, fading trails, lines of sight to the files they read.
import type { AgentPresence } from "@contract";
import { clock } from "../lib/live";
import { along, casing, drawTrip, landings, mapStyle, platform, polyPath, routePoints, tripMs } from "./themes";

/** Main threads get the accent (Metro: their own ink line); subagents a colour from the theme's palette, by id. */
export function agentColor(a: Pick<AgentPresence, "id" | "isSubagent">, accent: string): string {
  if (!a.isSubagent) return mapStyle().track ?? accent;
  let h = 0;
  for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) >>> 0;
  const palette = mapStyle().palette;
  return palette[h % palette.length];
}

export const shortName = (a: AgentPresence, max = 34) => {
  const n = a.name || a.id.slice(0, 7);
  return n.length > max ? n.slice(0, max - 1).trimEnd() + "…" : n;
};
export const initial = (a: AgentPresence) => {
  const n = (a.name || "").replace(/^Subagent\s*·\s*/i, "").trim();
  return (a.isSubagent ? "S" : (n[0] || "A")).toUpperCase();
};

const VERB_ING: Record<string, string> = {
  edit: "Editing", write: "Writing", read: "Reading", search: "Searching", run: "Running", delegate: "Delegating",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const verbIng = (a?: string) => (a ? VERB_ING[a] ?? cap(a) : "Working");
export const baseName = (p: string) => p.split("/").pop() || p;

/** Agents worth drawing: active, or inactive for up to 10 minutes (faded). */
export function visibleAgents(agents: AgentPresence[], now = clock()): AgentPresence[] {
  return agents.filter((a) => a.active || now - Date.parse(a.ts) < 10 * 60_000);
}

// ---------- canvas layer ----------
// Writes are movement: the marker sits on the last file the agent changed and glides there on each edit/write,
// and its trail links only write positions. Reads are a line of sight: the marker stays put and a thin line to
// the file read fades out. A step with no file (a search or a command) is a short pulse on the marker.
export type AgentAnim = {
  x: number; y: number; fromX: number; fromY: number; t0: number; file: string; alpha: number;
  seen: Set<string>; seeded: boolean;           // trail entries already accounted for (no flash on first sight)
  flashes: { file: string; t0: number }[];      // recent reads to draw as lines of sight
  lastTs: string; pulseT0: number;              // activity without a new file → pulse
  lastErr?: string; errT0: number;              // a failed tool call → the marker flashes red
  landedT0?: number;                            // the trip whose landing was announced (PS2: the cube flashes)
};
type Pt = { x: number; y: number; r: number };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const GLIDE_MS = 650;
const READ_MS = 1500;
const PULSE_MS = 700;
export const ERROR_RED = "#d93025";
const ERR_MS = 2600;        // how long the marker stays red
const ERR_PULSE_MS = 1100;  // one red ring
const WAIT_MS = 1800;       // the amber ring's breath while an agent waits on you
const WAIT_AMBER = "#f59e0b";
const WAIT_TEXT = "#9a5800";      // on a light outline
const WAIT_TEXT_DARK = "#ffc56b"; // on a dark one (PS2, Dead Space)
/** A dark theme draws labels on a dark outline (its halo). */
const darkHalo = (halo: string) => Number(/\d+/.exec(halo)?.[0] ?? 255) < 128;
export const isWrite = (action?: string) => action === "edit" || action === "write";

/** Where the marker stands: the last file written, or before any write, the first file touched. */
export function anchorFile(a: AgentPresence): string | undefined {
  for (let i = a.trail.length - 1; i >= 0; i--) if (isWrite(a.trail[i].action)) return a.trail[i].file;
  return a.trail[0]?.file ?? a.file;
}

export function drawAgents(opts: {
  ctx: CanvasRenderingContext2D; scale: number; agents: AgentPresence[]; anim: Map<string, AgentAnim>;
  resolve: (file: string) => Pt | undefined; accent: string; font: string; hoverFile: string | null; followId: string | null;
  resolveId: (file: string) => string | undefined; showReads: boolean;
  /** The project overview: markers only (no trails, no lines of sight), until a thread or an agent is picked. */
  quiet?: boolean;
  /** Agents waiting on you (attention), by agent id → the label to show. They stay lit and breathe amber. */
  waiting?: ReadonlyMap<string, string>;
}) {
  const { ctx, scale, agents, anim, resolve, accent, font, hoverFile, followId, resolveId, showReads, quiet, waiting } = opts;
  const t = performance.now();
  const now = clock();
  const style = mapStyle();

  // Fan out agents standing on the same file.
  const groups = new Map<string, AgentPresence[]>();
  for (const a of agents) {
    const f = anchorFile(a);
    const key = f && resolveId(f);
    if (!key) continue;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  for (const [key, group] of groups) {
    group.sort((a, b) => a.id.localeCompare(b.id));
    const node = resolve(key);
    if (!node) continue;
    group.forEach((a, i) => {
      const angle = -Math.PI / 4 + i * ((Math.PI * 2) / Math.max(group.length, 5));
      const dist = node.r + 11 / scale;
      const tx = node.x + Math.cos(angle) * dist, ty = node.y + Math.sin(angle) * dist;

      let st = anim.get(a.id);
      if (!st) {
        st = { x: tx, y: ty, fromX: tx, fromY: ty, t0: -1e9, file: key, alpha: 0, seen: new Set(), seeded: false, flashes: [], lastTs: a.ts, pulseT0: -1e9, errT0: -1e9, lastErr: a.errorAt };
        anim.set(a.id, st);
      }
      if (st.file !== key) { st.fromX = st.x; st.fromY = st.y; st.t0 = t; st.file = key; }
      const p = Math.min(1, (t - st.t0) / tripMs(style.route, GLIDE_MS));
      const e = ease(p);
      const trip = p < 1 && style.route !== "glide" ? routePoints(style.route, st.fromX, st.fromY, tx, ty) : null;
      if (trip) { const q = along(trip, e); st.x = q.x; st.y = q.y; }  // ride the route
      else { st.x = st.fromX + (tx - st.fromX) * e; st.y = st.fromY + (ty - st.fromY) * e; }
      if (style.route === "hop" && p >= 1 && st.t0 > 0 && st.landedT0 !== st.t0) { st.landedT0 = st.t0; landings.set(key, t); }
      const idle = now - Date.parse(a.ts);
      const target = a.active || waiting?.has(a.id) ? 1 : Math.max(0, 0.35 * (1 - (idle - 2 * 60_000) / (8 * 60_000)));
      st.alpha += (target - st.alpha) * 0.08;

      // New trail entries: reads become lines of sight. Activity with no new file becomes a pulse.
      let fresh = false;
      for (const m of a.trail) {
        const k = `${m.file}|${m.action}|${m.ts}`;
        if (st.seen.has(k)) continue;
        st.seen.add(k); fresh = true;
        if (st.seeded && !isWrite(m.action)) st.flashes.push({ file: m.file, t0: t });
      }
      if (st.seeded && a.ts !== st.lastTs && !fresh) st.pulseT0 = t;
      if (a.errorAt && a.errorAt !== st.lastErr) { st.lastErr = a.errorAt; if (Date.now() - Date.parse(a.errorAt) < 10_000) st.errT0 = t; }
      st.lastTs = a.ts; st.seeded = true;
      if (st.seen.size > 200) st.seen = new Set([...st.seen].slice(-60));
      if (st.alpha < 0.01) return;

      const erring = t - st.errT0 < ERR_MS;
      const color = erring ? ERROR_RED : agentColor(a, accent);

      // Trail through the last distinct files it wrote, newest strongest.
      const files: string[] = [];
      for (const m of a.trail) {
        if (!isWrite(m.action)) continue;
        const id = resolveId(m.file);
        if (id && files[files.length - 1] !== id) files.push(id);
      }
      // Metro: through the marker's stops by each file, so the track it rode is the one it leaves.
      const pts = files.slice(-7).map((f) => resolve(f)).filter((x): x is Pt => !!x)
        .map((n) => (style.route !== "glide" ? { ...platform(n.x, n.y, n.r, scale, angle), r: 0 } : n));
      if (pts.length) pts[pts.length - 1] = { x: st.x, y: st.y, r: 0 }; // end at the marker
      if (pts.length > 1 && (!quiet || followId === a.id)) {
        ctx.lineCap = "round";
        for (let k = 0; k < pts.length - 1; k++) {
          const a0 = pts[k], a1 = pts[k + 1];
          const w = (k + 1) / (pts.length - 1);
          ctx.globalAlpha = st.alpha * (0.1 + 0.55 * w);
          ctx.strokeStyle = color;
          ctx.lineWidth = (1.2 + 1.6 * w) / scale;
          const mx = (a0.x + a1.x) / 2, my = (a0.y + a1.y) / 2;
          const dx = a1.x - a0.x, dy = a1.y - a0.y;
          if (style.route !== "glide") { polyPath(ctx, routePoints(style.route, a0.x, a0.y, a1.x, a1.y)); if (style.route === "metro") casing(ctx, scale); } // the way it went
          else {
            ctx.beginPath();
            ctx.moveTo(a0.x, a0.y);
            ctx.quadraticCurveTo(mx - dy * 0.15, my + dx * 0.15, a1.x, a1.y);
          }
          if (style.glow) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
          ctx.stroke();
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(a0.x, a0.y, 2.8 / scale, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }

      // Reads: a thin line from the marker to the file read and a small ring on it, fading out.
      st.flashes = st.flashes.filter((f) => t - f.t0 < READ_MS);
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

      // A search or command without a file: one short pulse on the marker.
      const q = (t - st.pulseT0) / PULSE_MS;
      if (q >= 0 && q < 1) {
        ctx.globalAlpha = st.alpha * (1 - q) * 0.55;
        ctx.beginPath(); ctx.arc(st.x, st.y, (9 + q * 12) / scale, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = 1.6 / scale; ctx.stroke();
      }

      // A failed tool call: one red ring, wider than the activity pulse.
      const ep = (t - st.errT0) / ERR_PULSE_MS;
      if (ep >= 0 && ep < 1) {
        ctx.globalAlpha = st.alpha * (1 - ep) * 0.8;
        ctx.beginPath(); ctx.arc(st.x, st.y, (10 + ep * 26) / scale, 0, Math.PI * 2);
        ctx.strokeStyle = ERROR_RED; ctx.lineWidth = 2.4 / scale; ctx.stroke();
      }

      // The trip under way: Dead Space's locator line ahead, PS2's afterimages behind.
      if (trip) drawTrip(ctx, style.route, trip, p, e, color, 9 / scale, st.alpha, scale);

      // Waiting on you: an amber ring that breathes, as long as it waits.
      const waitLabel = waiting?.get(a.id);
      if (waitLabel) {
        const b = (t % WAIT_MS) / WAIT_MS;
        ctx.globalAlpha = st.alpha * (1 - b) * 0.9;
        ctx.beginPath(); ctx.arc(st.x, st.y, (11 + b * 16) / scale, 0, Math.PI * 2);
        ctx.strokeStyle = WAIT_AMBER; ctx.lineWidth = 2.6 / scale; ctx.stroke();
        ctx.globalAlpha = st.alpha;
        ctx.beginPath(); ctx.arc(st.x, st.y, 12 / scale, 0, Math.PI * 2);
        ctx.strokeStyle = WAIT_AMBER; ctx.lineWidth = 2.2 / scale; ctx.stroke();
      }

      // Marker
      ctx.globalAlpha = st.alpha;
      if (style.glow) { ctx.shadowColor = color; ctx.shadowBlur = 16; }
      else { ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1; }
      ctx.beginPath(); ctx.arc(st.x, st.y, 9 / scale, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = style.markerStroke; ctx.stroke();
      ctx.fillStyle = style.markerText;
      ctx.font = `700 ${10 / scale}px ${font}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(initial(a), st.x, st.y + 0.5 / scale);

      if (scale > 1.6 || hoverFile === key || followId === a.id || erring || waitLabel) {
        const label = waitLabel ? `${shortName(a, 20)} · ${waitLabel}` : erring && a.error ? `${shortName(a, 20)} · ${a.error.slice(0, 48)}` : `${shortName(a, 28)} · ${verbIng(a.action)}`;
        ctx.font = `600 ${12 / scale}px ${font}`;
        ctx.textAlign = "left";
        const lx = st.x + 13 / scale, ly = st.y;
        ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = style.halo;
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = waitLabel ? (darkHalo(style.halo) ? WAIT_TEXT_DARK : WAIT_TEXT) : color;
        ctx.fillText(label, lx, ly);
      }
      ctx.globalAlpha = 1;
    });
  }
}

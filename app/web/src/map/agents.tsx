// Owner: D. Live agents on the Map: markers that glide between files, fading trails, and the tracker list.
import { useEffect, useState } from "react";
import type { AgentPresence } from "@contract";
import { clock } from "../lib/live";

// Colors that do not clash with the recency scale (orange/amber/grey). Main threads get the accent.
const PALETTE = ["#2f7ae5", "#0f9d8a", "#c2409a", "#7c4dde", "#2e9e4f", "#0b8fb3", "#b5487a", "#4a6fa5"];
export function agentColor(a: Pick<AgentPresence, "id" | "isSubagent">, accent: string): string {
  if (!a.isSubagent) return accent;
  let h = 0;
  for (let i = 0; i < a.id.length; i++) h = (h * 31 + a.id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export const shortName = (a: AgentPresence, max = 34) => {
  const n = a.name || a.id.slice(0, 7);
  return n.length > max ? n.slice(0, max - 1).trimEnd() + "…" : n;
};
export const initial = (a: AgentPresence) => {
  const n = (a.name || "").replace(/^Subagent\s*·\s*/i, "").trim();
  return (a.isSubagent ? "S" : (n[0] || "A")).toUpperCase();
};

const VERB: Record<string, [string, string]> = {
  edit: ["Editing", "Edit"], write: ["Writing", "Write"], read: ["Reading", "Read"],
  search: ["Searching", "Search"], run: ["Running", "Run"], delegate: ["Delegating", "Delegate"],
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const verbIng = (a?: string) => (a ? VERB[a]?.[0] ?? cap(a) : "Working");
export const verb = (a?: string) => (a ? VERB[a]?.[1] ?? cap(a) : "Touch");
export const baseName = (p: string) => p.split("/").pop() || p;

/** Agents worth drawing: active, or inactive for up to 10 minutes (faded). */
export function visibleAgents(agents: AgentPresence[], now = clock()): AgentPresence[] {
  return agents.filter((a) => a.active || now - Date.parse(a.ts) < 10 * 60_000);
}

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

function useTick(ms: number) {
  const [, set] = useState(0);
  useEffect(() => { const t = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(t); }, [ms]);
}

/** Compact list of agents at work. Click an agent to follow it; click a move to focus that file. */
export function AgentTracker({ agents, accent, followId, onFollow, onFocusFile }: {
  agents: AgentPresence[]; accent: string; followId: string | null;
  onFollow: (id: string | null) => void; onFocusFile: (path: string) => void;
}) {
  useTick(5000);
  const now = clock();
  const list = agents.filter((a) => a.active).sort((a, b) => b.ts.localeCompare(a.ts));
  return (
    <div className="map-agents" aria-label="Agents">
      <h3>Agents</h3>
      {list.length === 0 ? (
        <p className="map-agents-empty">No agents working right now</p>
      ) : (
        <ul>
          {list.map((a) => {
            const moves = a.trail.slice(-5);
            const following = followId === a.id;
            return (
              <li key={a.id} className={following ? "following" : ""}>
                <button className="map-agent-head" onClick={() => onFollow(following ? null : a.id)} title={following ? "Stop following" : "Follow this agent"}>
                  <i style={{ background: agentColor(a, accent) }} />
                  <span className="map-agent-name">{shortName(a, 40)}</span>
                  <time>{ago(a.ts, now)}</time>
                </button>
                <p className="map-agent-now">
                  {verbIng(a.action)}{a.file ? <> <b>{baseName(a.file)}</b></> : null}
                  {following && <span className="map-agent-following"> · following</span>}
                </p>
                {moves.length > 1 && (
                  <p className="map-agent-route">
                    {moves.map((m, i) => (
                      <span key={i}>
                        {i > 0 && <span className="arrow">→</span>}
                        <button onClick={() => onFocusFile(m.file)}>{verb(m.action)} {baseName(m.file)}</button>
                      </span>
                    ))}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- canvas layer ----------
export type AgentAnim = { x: number; y: number; fromX: number; fromY: number; t0: number; file: string; alpha: number };
type Pt = { x: number; y: number; r: number };
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const GLIDE_MS = 650;

export function drawAgents(opts: {
  ctx: CanvasRenderingContext2D; scale: number; agents: AgentPresence[]; anim: Map<string, AgentAnim>;
  resolve: (file: string) => Pt | undefined; accent: string; font: string; hoverFile: string | null; followId: string | null;
  resolveId: (file: string) => string | undefined;
}) {
  const { ctx, scale, agents, anim, resolve, accent, font, hoverFile, followId, resolveId } = opts;
  const t = performance.now();
  const now = clock();

  // Fan out agents sharing a file.
  const groups = new Map<string, AgentPresence[]>();
  for (const a of agents) {
    if (!a.file) continue;
    const key = resolveId(a.file);
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
      if (!st) { st = { x: tx, y: ty, fromX: tx, fromY: ty, t0: -1e9, file: key, alpha: 0 }; anim.set(a.id, st); }
      if (st.file !== key) { st.fromX = st.x; st.fromY = st.y; st.t0 = t; st.file = key; }
      const p = Math.min(1, (t - st.t0) / GLIDE_MS);
      const e = ease(p);
      st.x = st.fromX + (tx - st.fromX) * e;
      st.y = st.fromY + (ty - st.fromY) * e;
      const idle = now - Date.parse(a.ts);
      const target = a.active ? 1 : Math.max(0, 0.35 * (1 - (idle - 2 * 60_000) / (8 * 60_000)));
      st.alpha += (target - st.alpha) * 0.08;
      if (st.alpha < 0.01) return;

      const color = agentColor(a, accent);

      // Trail through its last distinct files, newest strongest.
      const files: string[] = [];
      for (const m of a.trail) { const id = resolveId(m.file); if (id && files[files.length - 1] !== id) files.push(id); }
      const pts = files.slice(-7).map((f) => resolve(f)).filter((x): x is Pt => !!x);
      if (pts.length) pts[pts.length - 1] = { x: st.x, y: st.y, r: 0 }; // end at the marker
      if (pts.length > 1) {
        ctx.lineCap = "round";
        for (let k = 0; k < pts.length - 1; k++) {
          const a0 = pts[k], a1 = pts[k + 1];
          const w = (k + 1) / (pts.length - 1);
          ctx.globalAlpha = st.alpha * (0.1 + 0.55 * w);
          ctx.strokeStyle = color;
          ctx.lineWidth = (1.2 + 1.6 * w) / scale;
          // gentle curve
          const mx = (a0.x + a1.x) / 2, my = (a0.y + a1.y) / 2;
          const dx = a1.x - a0.x, dy = a1.y - a0.y;
          ctx.beginPath();
          ctx.moveTo(a0.x, a0.y);
          ctx.quadraticCurveTo(mx - dy * 0.15, my + dx * 0.15, a1.x, a1.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(a0.x, a0.y, 2.8 / scale, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        }
      }

      // Marker
      if (a.active) {
        const q = ((t + i * 400) % 1800) / 1800;
        ctx.globalAlpha = st.alpha * (1 - q) * 0.45;
        ctx.beginPath(); ctx.arc(st.x, st.y, (9 + q * 12) / scale, 0, Math.PI * 2);
        ctx.strokeStyle = color; ctx.lineWidth = 1.6 / scale; ctx.stroke();
      }
      ctx.globalAlpha = st.alpha;
      ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 1;
      ctx.beginPath(); ctx.arc(st.x, st.y, 9 / scale, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      ctx.lineWidth = 2 / scale; ctx.strokeStyle = "#fff"; ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${10 / scale}px ${font}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(initial(a), st.x, st.y + 0.5 / scale);

      if (scale > 1.6 || hoverFile === key || followId === a.id) {
        const label = `${shortName(a, 28)} · ${verbIng(a.action)}`;
        ctx.font = `600 ${12 / scale}px ${font}`;
        ctx.textAlign = "left";
        const lx = st.x + 13 / scale, ly = st.y;
        ctx.lineWidth = 3.5 / scale; ctx.strokeStyle = "rgba(251,251,253,0.95)";
        ctx.strokeText(label, lx, ly);
        ctx.fillStyle = color;
        ctx.fillText(label, lx, ly);
      }
      ctx.globalAlpha = 1;
    });
  }
}

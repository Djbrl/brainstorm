// Owner: camera. The minimap: the whole project in the top-right corner, like a picture in picture, while the camera
// follows one agent up close. Its folders, every agent where it is now, and the part the camera shows. Click or drag on
// it to look there; its buttons switch which agent the camera follows. Shown on a small map (the Claude app's browser
// pane) unless turned off, on a big one only if turned on: M flips it (prefs.ts).
import { useEffect, useRef, type RefObject } from "react";
import type { AgentPresence } from "@contract";
import { agentColor, initial, shortName, type AgentAnim } from "./agents";
import type { Camera } from "./camera";
import type { Graph } from "./graph";
import { mapStyle } from "./themes";
import "./minimap.css";

const W = 208, H = 132;   // the picture, in CSS pixels
const PAD = 8;
const FPS_MS = 66;        // about 15 frames a second: agents glide, nothing needs more

export function Minimap({ graphRef, anim, drawnRef, cam, subject, agents, followId, accent, onTrack, onLook, onHide }: {
  graphRef: RefObject<Graph>;
  anim: RefObject<Map<string, AgentAnim>>;
  /** The agents the map draws this frame (where each one is comes from `anim`). */
  drawnRef: RefObject<AgentPresence[]>;
  cam: RefObject<Camera>;
  /** The replay's marker, while it shows (replay/layer.ts), or null. */
  subject: () => { x: number; y: number } | null;
  /** The agents you can follow from here, in order (the open thread's: main first). */
  agents: AgentPresence[];
  followId: string | null;
  accent: string;
  onTrack: (id: string) => void;
  /** Look at a point of the map (graph units), as a hand move; `ms` 0 while dragging. */
  onLook: (x: number, y: number, ms: number) => void;
  onHide: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Where the picture puts the map: graph point (x, y) is at (ox + x·k, oy + y·k). Set by each frame, read by clicks.
  const fit = useRef({ k: 1, ox: 0, oy: 0 });
  const followRef = useRef(followId); followRef.current = followId;
  const accentRef = useRef(accent); accentRef.current = accent;
  const subjectRef = useRef(subject); subjectRef.current = subject;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = W * dpr; el.height = H * dpr;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < FPS_MS || document.hidden) return;
      last = t;
      const g = graphRef.current, st = mapStyle(), cs = getComputedStyle(el);
      const ink = cs.getPropertyValue("--ink").trim() || "#121214", quiet = cs.getPropertyValue("--cool").trim() || "#c7cbd6";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!g?.nodes.length) return;
      // The whole map: every circle that shows, folders and files.
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of g.nodes) {
        if (n.x === undefined || n.y === undefined || (!n.dir && n.up)) continue;   // a folder's files are inside it
        x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r);
      }
      if (x0 === Infinity) return;
      const k = Math.min((W - 2 * PAD) / Math.max(1, x1 - x0), (H - 2 * PAD) / Math.max(1, y1 - y0));
      const ox = (W - (x1 - x0) * k) / 2 - x0 * k, oy = (H - (y1 - y0) * k) / 2 - y0 * k;
      fit.current = { k, ox, oy };
      const X = (x: number) => ox + x * k, Y = (y: number) => oy + y * k;

      // Folders: the top two levels as circles, the top one's names when they fit.
      ctx.lineWidth = 1;
      for (const n of g.folders) {
        if (n.x === undefined || n.y === undefined) continue;
        const depth = n.up ? (n.up.up ? 2 : 1) : 0;
        if (depth > 1) continue;
        const r = n.r * k;
        if (r < 2) continue;
        ctx.globalAlpha = depth ? 0.12 : 0.2;
        ctx.strokeStyle = ink;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = depth ? 0.02 : 0.035;
        ctx.fillStyle = ink; ctx.fill();
      }
      // Files: a dot each, in the colour the map gave them (recency), quiet when it hasn't drawn them yet.
      ctx.globalAlpha = 0.85;
      for (const n of g.nodes) {
        if (n.dir || n.x === undefined || n.y === undefined) continue;
        const r = Math.max(0.7, Math.min(2.2, n.r * k));
        ctx.fillStyle = n.css ?? quiet;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `600 9px ${cs.getPropertyValue("--font-body") || "sans-serif"}`;
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillStyle = ink;
      for (const n of g.folders) {
        if (n.up || n.x === undefined || n.y === undefined || n.r * k < 18) continue;
        const name = n.id.replace(/\/+$/, "").split("/").pop() ?? "";
        ctx.globalAlpha = 0.55;
        ctx.fillText(name.length > 14 ? name.slice(0, 13) + "…" : name, X(n.x), Math.max(10, Y(n.y - n.r) - 1));
      }

      // What the camera shows: its frame, and the rest of the picture veiled. Nothing while it shows the whole map.
      const c = cam.current, v = c?.view(), s = c?.safe.current;
      if (v && s) {
        const hw = s.w / 2 / v.k, hh = s.h / 2 / v.k;
        const rx = X(v.x - hw), ry = Y(v.y - hh), rw = 2 * hw * k, rh = 2 * hh * k;
        if (rx > 1 || ry > 1 || rx + rw < W - 1 || ry + rh < H - 1) {
          ctx.globalAlpha = 0.07; ctx.fillStyle = ink;
          ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(rx, ry, rw, rh); ctx.fill("evenodd");
          ctx.globalAlpha = 0.9; ctx.strokeStyle = accentRef.current; ctx.lineWidth = 1.5;
          ctx.strokeRect(rx + 0.75, ry + 0.75, Math.max(2, rw - 1.5), Math.max(2, rh - 1.5));
        }
      }

      // Every agent the map draws, where it is now; the one followed bigger, ringed.
      const halo = st.halo;
      for (const a of drawnRef.current ?? []) {
        const p = anim.current?.get(a.id);
        if (!p || p.alpha < 0.05) continue;
        const on = a.id === followRef.current, r = on ? 4.6 : 3.4;
        ctx.globalAlpha = Math.max(0.35, p.alpha);
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), r + 1.5, 0, Math.PI * 2); ctx.fillStyle = halo; ctx.fill();
        ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), r, 0, Math.PI * 2); ctx.fillStyle = agentColor(a, accentRef.current); ctx.fill();
        if (on) { ctx.lineWidth = 1.5; ctx.strokeStyle = agentColor(a, accentRef.current); ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), r + 3.5, 0, Math.PI * 2); ctx.stroke(); }
      }
      // A replay's marker, where the thread is in its past.
      const m = subjectRef.current();
      if (m) {
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 5.5, 0, Math.PI * 2); ctx.fillStyle = halo; ctx.fill();
        ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 4, 0, Math.PI * 2); ctx.fillStyle = accentRef.current; ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graphRef, anim, drawnRef, cam]);

  // Click or drag: the camera looks there (gliding on the click, at once while dragging).
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), f = fit.current;
      return { x: (e.clientX - r.left - f.ox) / f.k, y: (e.clientY - r.top - f.oy) / f.k };
    };
    let dragging = false;
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      dragging = true; el.setPointerCapture(e.pointerId);
      const p = at(e); onLookRef.current(p.x, p.y, 450);
    };
    const move = (e: PointerEvent) => { if (dragging && e.buttons) { const p = at(e); onLookRef.current(p.x, p.y, 0); } };
    const up = () => { dragging = false; };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => { el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
  }, []);
  const onLookRef = useRef(onLook); onLookRef.current = onLook;

  const followed = agents.find((a) => a.id === followId);
  return (
    <section className="minimap" aria-label="Minimap: the whole project">
      <canvas ref={canvas} style={{ width: W, height: H }} role="img"
        aria-label="The whole project, the agents on it and the part the camera shows. Click to look there." />
      <button className="mm-hide" onClick={onHide} aria-label="Hide the minimap (M)" title="Hide (M)">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
      </button>
      {agents.length > 0 && (
        <div className="mm-agents" role="group" aria-label="Follow an agent">
          {agents.map((a) => {
            const on = a.id === followId, color = agentColor(a, accent);
            return (
              <button key={a.id} className={on ? "on" : ""} style={{ ["--c" as string]: color }} onClick={() => onTrack(a.id)}
                aria-pressed={on} title={`${on ? "Following" : "Follow"} ${a.isSubagent ? shortName(a, 40) : "the main agent"} (A: the next one)`}>
                <i aria-hidden="true">{initial(a)}</i>
              </button>
            );
          })}
          <span className="mm-who">{followed ? (followed.isSubagent ? shortName(followed, 26) : "Main agent") : "Not following"}</span>
        </div>
      )}
    </section>
  );
}

/** The agents you can follow from the minimap: the open thread's (main first, then its subagents), or else everyone on
 *  the map at work or lately (main agents first). At most `max`, in an order that doesn't change as they work. */
export function trackable(drawn: AgentPresence[], max = 6): AgentPresence[] {
  const byId = (a: AgentPresence, b: AgentPresence) => a.id.localeCompare(b.id);
  return [...drawn.filter((a) => !a.isSubagent).sort(byId), ...drawn.filter((a) => a.isSubagent).sort(byId)].slice(0, max);
}


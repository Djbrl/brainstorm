// Owner: camera. The Readmap: a second, small camera in the top-right corner, like a picture in picture. The big camera
// follows an agent's edits; this one follows what it reads, by itself: it glides to the file the agent last read, close
// enough to read its name and its neighbours' (files read are often far from where the agent writes, out of the big
// camera's view). Several files read together (within a few seconds of the last one) are framed together if their names
// still read at that zoom; else it shows the last one, the others ringed fainter where they're in the picture. Its
// buttons below pick the agent: the big camera follows it, the Readmap its reads. With none picked, it watches the one
// that read last. Nothing read: the whole project, with the big camera's frame. A click shows that place on the big
// map. Shown unless turned off (its ×, or M; a Readmap button brings it back), on any map but a phone's.
import { useEffect, useRef, type MouseEvent, type RefObject } from "react";
import type { AgentPresence } from "@contract";
import { agentColor, baseName, initial, lastReadAt, readsWithTimes, shortName, type AgentAnim } from "./agents";
import type { Camera } from "./camera";
import type { Graph, GNode } from "./graph";
import { mapStyle } from "./themes";
import { useLiveSelector } from "../lib/live";
import { folderOf } from "./replay/Peek";
import { Icon } from "./replay/ReplayBar";
import "./replay/peek.css";
import "./readmap.css";

// The picture, in CSS pixels: small beside a small map; on a big one as wide as the file window under it (replay/Peek),
// the two one column on the right.
const SMALL = { w: 208, h: 132 }, BIG = { w: 358, h: 196 };
const GLIDE = 0.28;          // seconds for the camera to (nearly) reach a new file
const READ_FLASH_MS = 1500;  // a read as it happens (the map's line of sight lasts as long: agents.tsx)
const PAST_ALPHA = 0.38;     // the replay's marker (the thread in its past), beside the agents where they are now
const NAMES_MAX = 7;         // file names besides the ones read
const TOGETHER_MS = 15_000;  // reads this close to the last one are one look around (several files read at once)
const READABLE = 3.5;        // a file's radius in the picture (px) from which its name goes under it

type View = { x: number; y: number; k: number };
export type ReadmapReads = {
  resolveId: (file: string) => string | undefined; at: (id: string) => GNode | undefined; whose: (a: AgentPresence) => boolean;
  /** Looking back through a thread: the files read at that moment (node ids, newest first), which it shows instead
   *  (none: the whole project); null when not looking back. */
  past: string[] | null;
};

export function Readmap({ graphRef, anim, drawnRef, cam, subject, reads, agents, followId, accent, big, onTrack, onLook, onHide }: {
  graphRef: RefObject<Graph>;
  anim: RefObject<Map<string, AgentAnim>>;
  /** The agents the map draws this frame (where each one is comes from `anim`). */
  drawnRef: RefObject<AgentPresence[]>;
  cam: RefObject<Camera>;
  /** The replay's marker, while it shows (replay/layer.ts), or null. */
  subject: () => { x: number; y: number } | null;
  /** The map's resolver and nodes, and whose reads count (the open thread's agents, or on the project overview only
   *  the one followed); null when reads are hidden (R). */
  reads: () => ReadmapReads | null;
  /** The agents you can follow from here, in order (the open thread's: main first). */
  agents: AgentPresence[];
  followId: string | null;
  accent: string;
  /** A big map: the picture as wide as the file window (replay/Peek) under it. */
  big: boolean;
  onTrack: (id: string) => void;
  /** Show a point of the map (graph units) on the big map, as a hand move. */
  onLook: (x: number, y: number, ms: number) => void;
  onHide: () => void;
}) {
  const { w: W, h: H } = big ? BIG : SMALL;
  const canvas = useRef<HTMLCanvasElement>(null);
  // Its header says what it shows, as the file window's does: "Read", the file, its folder.
  const verbEl = useRef<HTMLSpanElement>(null), fileEl = useRef<HTMLElement>(null), dirEl = useRef<HTMLSpanElement>(null);
  const roots = useLiveSelector((s) => (s.map ? [s.map.root, ...(s.map.formerRoots ?? [])].join("\n") : ""));
  const rootsRef = useRef(roots); rootsRef.current = roots;
  const followRef = useRef(followId); followRef.current = followId;
  const accentRef = useRef(accent); accentRef.current = accent;
  const subjectRef = useRef(subject); subjectRef.current = subject;
  const readsRef = useRef(reads); readsRef.current = reads;
  // The Readmap's own camera (graph point (x, y) in the middle, k pixels per graph unit), and what it shows now: the
  // file read (its id) or the whole map (null). A click goes there.
  const view = useRef<View | null>(null);
  const lastReads = useRef(new Map<string, { n: GNode; at: number }[]>());   // per agent, what it read last
  const shows = useRef<{ id: string | null; x: number; y: number }>({ id: null, x: 0, y: 0 });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = W * dpr; el.height = H * dpr;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0, last = 0, settled = false, sig = "";
    let idx = { g: -1 as number, m: new Map<string, GNode>() };   // the map's nodes by id, made again when it changes
    // The theme's colours and font, read again twice a second (a theme switch), not every frame (that's a style flush).
    let tok = { ink: "", quiet: "", font: "", at: -1e9 };
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden) return;
      const g = graphRef.current, st = mapStyle(), A0 = anim.current, c0 = cam.current?.view(), m0 = subjectRef.current();
      // Every frame while something in it moves (its own glide, an agent's, the big camera's frame, a read's ring), as
      // smooth as the big map; nothing at all while it all stands still.
      let s = `${g?.id}|${document.documentElement.dataset.theme}|${followRef.current}|${c0 ? `${c0.x.toFixed(1)},${c0.y.toFixed(1)},${c0.k.toFixed(3)}` : ""}|${m0 ? `${m0.x.toFixed(1)},${m0.y.toFixed(1)}` : ""}`;
      for (const a of drawnRef.current ?? []) {
        const p = A0?.get(a.id);
        s += `|${a.id}:${a.ts}:${a.trail.length}:${p ? `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.alpha.toFixed(2)},${p.flashes.length}` : ""}`;
      }
      const flashing = [...(A0?.values() ?? [])].some((p) => p.flashes.some((f) => t - f.t0 < READ_FLASH_MS));
      if (settled && !flashing && s === sig) { last = t; return; }
      sig = s;
      const dt = Math.min(0.1, (t - last) / 1000); last = t;
      if (t - tok.at > 500) {
        const cs = getComputedStyle(el);
        tok = { ink: cs.getPropertyValue("--ink").trim() || "#121214", quiet: cs.getPropertyValue("--cool").trim() || "#c7cbd6", font: cs.getPropertyValue("--font-body") || "sans-serif", at: t };
      }
      const { ink, quiet, font } = tok;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!g?.nodes.length) return;
      const whole = wholeView(g, W, H);
      if (!whole) return;

      // ---- what to show: the file the watched agent read last, or the whole map ----
      const R = readsRef.current(), drawn = drawnRef.current ?? [], A = anim.current;
      let who: AgentPresence | undefined, read: GNode | undefined, others: GNode[] = [], together: GNode[] = [];
      if (R?.past) {
        // A replay: what was read at that moment, all of it together.
        const nodes = R.past.map((id) => R.at(id)).filter((n): n is GNode => n?.x !== undefined && n.y !== undefined);
        read = nodes[0]; others = nodes.slice(1); together = nodes;
      } else if (R) {
        // The agent followed (its button below, A, the sidebar): its reads, even none yet. Else whoever read last (its
        // marker may be off the map: its reads still count).
        who = drawn.find((a) => a.id === followRef.current && R.whose(a))
          ?? drawn.filter((a) => R.whose(a) && lastReadAt(a) > 0).sort((a, b) => lastReadAt(b) - lastReadAt(a))[0];
        if (who) {
          let list = readsWithTimes(who, R.resolveId, A?.get(who.id)?.file)
            .map((r) => ({ n: R.at(r.id), at: r.at })).filter((r): r is { n: GNode; at: number } => r.n?.x !== undefined && r.n.y !== undefined);
          // Its trail keeps its last dozen moves: after a run of edits its reads have left it, and the Readmap stays on
          // what it read last.
          if (list.length) lastReads.current.set(who.id, list); else list = lastReads.current.get(who.id) ?? [];
          read = list[0]?.n; others = list.slice(1).map((r) => r.n);
          together = list.filter((r) => list[0].at - r.at <= TOGETHER_MS).map((r) => r.n);
        }
      }
      let want: View = whole;
      if (read) {
        // Close enough to read its name: the folder it's in fills the picture if its files still read there, else the
        // file and what's right around it.
        const f = read.up;
        const kf = f ? Math.min((W - 24) / (2 * f.r), (H - 30) / (2 * f.r)) : 0;
        want = { x: read.x!, y: read.y!, k: Math.max(whole.k, Math.min(14, read.r * kf >= 5 ? kf : 7 / Math.max(0.5, read.r))) };
        // Read together with others: all of them, if every one still reads at that zoom (room left for the names).
        if (together.length > 1) {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, rMin = Infinity;
          for (const n of together) { x0 = Math.min(x0, n.x! - n.r); x1 = Math.max(x1, n.x! + n.r); y0 = Math.min(y0, n.y! - n.r); y1 = Math.max(y1, n.y! + n.r); rMin = Math.min(rMin, n.r); }
          const kb = Math.min(14, (W - 56) / Math.max(1, x1 - x0), (H - 40) / Math.max(1, y1 - y0));
          if (rMin * kb >= READABLE) want = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k: Math.max(whole.k, Math.min(kb, want.k)) };
          else together = [read];
        }
      }
      shows.current = read ? { id: read.id, x: read.x!, y: read.y! } : { id: null, x: 0, y: 0 };
      // The camera glides there (in log zoom, so near and far zooms take the same time).
      const v = view.current ?? (view.current = { ...want });
      const e = 1 - Math.exp(-dt / GLIDE);
      v.x += (want.x - v.x) * e; v.y += (want.y - v.y) * e; v.k = Math.exp(Math.log(v.k) + (Math.log(want.k) - Math.log(v.k)) * e);
      settled = Math.hypot(want.x - v.x, want.y - v.y) * v.k < 0.5 && Math.abs(Math.log(want.k / v.k)) < 0.01;
      const k = v.k, X = (x: number) => W / 2 + (x - v.x) * k, Y = (y: number) => H / 2 + (y - v.y) * k;
      const inView = (n: GNode, m = 0) => { const r = n.r * k; return X(n.x!) + r > -m && X(n.x!) - r < W + m && Y(n.y!) + r > -m && Y(n.y!) - r < H + m; };
      const close = !!read;

      // ---- folders: circles ----
      for (const n of g.folders) {
        if (n.x === undefined || n.y === undefined || !inView(n)) continue;
        const r = n.r * k;
        if (r < 2 || (!close && n.up?.up)) continue;
        ctx.globalAlpha = close ? 0.14 : n.up ? 0.12 : 0.2; ctx.strokeStyle = ink; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 0.03; ctx.fillStyle = ink; ctx.fill();
      }
      // ---- files ----
      ctx.globalAlpha = 0.9;
      for (const n of g.nodes) {
        if (n.dir || n.x === undefined || n.y === undefined || !inView(n)) continue;
        const r = close ? Math.max(1, n.r * k) : Math.max(0.7, Math.min(2.2, n.r * k));
        ctx.fillStyle = n.css ?? quiet;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), r, 0, Math.PI * 2); ctx.fill();
      }

      // ---- the files read: a ring on each in the agent's colour (the last one strongest), and a ring that swells on a
      // read as it happens ----
      const color = who ? agentColor(who, accentRef.current) : accentRef.current, now = performance.now();
      ctx.strokeStyle = color; ctx.lineWidth = 1.6;
      others.forEach((n, j) => {
        if (!inView(n, 8)) return;
        ctx.globalAlpha = together.includes(n) ? 0.85 : 0.55 - j * 0.12;   // read together with the last one: as strong
        ctx.beginPath(); ctx.arc(X(n.x!), Y(n.y!), Math.max(3, n.r * k + 2.5), 0, Math.PI * 2); ctx.stroke();
      });
      const ring = read ? Math.max(4, read.r * k + 3) : 0;
      if (read) {
        ctx.globalAlpha = 1; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(X(read.x!), Y(read.y!), ring, 0, Math.PI * 2); ctx.stroke();
      }
      const wst = who ? A?.get(who.id) : undefined;
      if (wst && R) for (const fl of wst.flashes) {
        const id = R.resolveId(fl.file), n = id ? R.at(id) : undefined, q = (now - fl.t0) / READ_FLASH_MS;
        if (!n || n.x === undefined || n.y === undefined || q < 0 || q >= 1) continue;
        ctx.globalAlpha = 1 - q; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(X(n.x), Y(n.y), Math.max(4, n.r * k + 3) + q * 10, 0, Math.PI * 2); ctx.stroke();
        settled = false;
      }

      // ---- names: up close, the file read (bold, in its colour) and the files around it that fit; far out, the top
      // folders ----
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.lineJoin = "round";
      const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const label = (text: string, x: number, y: number, size: number, weight: number, fill: string, alpha: number) => {
        ctx.font = `${weight} ${size}px ${font}`;
        const w = ctx.measureText(text).width, b = { x0: x - w / 2 - 2, y0: y - 1, x1: x + w / 2 + 2, y1: y + size + 1 };
        if (b.x0 < 2 || b.x1 > W - 2 || b.y0 < 2 || b.y1 > H - 2 || taken.some((o) => o.x0 < b.x1 && b.x0 < o.x1 && o.y0 < b.y1 && b.y0 < o.y1)) return false;
        taken.push(b);
        ctx.globalAlpha = alpha; ctx.lineWidth = 3; ctx.strokeStyle = st.halo; ctx.strokeText(text, x, y);
        ctx.fillStyle = fill; ctx.fillText(text, x, y);
        return true;
      };
      const folderName = (n: GNode) => n.id.replace(/\/+$/, "").split("/").pop() ?? "";
      if (read) {
        const rx = X(read.x!), ry = Y(read.y!), name = baseName(read.file?.path ?? read.id);
        if (!label(name, rx, ry + ring + 2, 11, 700, color, 1)) label(name, rx, ry - ring - 14, 11, 700, color, 1);
        const near = g.nodes.filter((n) => !n.dir && n !== read && n.x !== undefined && n.r * k >= 3.5 && inView(n))
          .sort((a, b) => Math.hypot(a.x! - read!.x!, a.y! - read!.y!) - Math.hypot(b.x! - read!.x!, b.y! - read!.y!));
        let named = 0;
        for (const n of [...together.filter((o) => o !== read), ...others.filter((o) => inView(o) && !together.includes(o)), ...near.filter((n) => !others.includes(n))]) {
          if (named >= NAMES_MAX) break;
          const mine = others.includes(n);
          if (label(baseName(n.file?.path ?? n.id), X(n.x!), Y(n.y!) + n.r * k + (mine ? 4 : 2), 9.5, mine ? 650 : 500, mine ? color : ink, mine ? 0.9 : 0.6)) named++;
        }
        for (const n of g.folders) {
          if (n.x === undefined || n.y === undefined || !inView(n) || n.r * k < 30 || n.r * k > W) continue;
          label(folderName(n), X(n.x), Math.max(4, Y(n.y - n.r) + 3), 9, 600, ink, 0.45);
        }
      } else {
        // The folders the agent is in (the one followed, else the one that moved last): its own, then the one above it,
        // named in its colour inside their circles' tops, before anything else takes the room. Then the top folders,
        // above their circles, and the next level's where they fit.
        if (idx.g !== g.id) idx = { g: g.id, m: new Map(g.nodes.map((n) => [n.id, n])) };
        const busy = drawn.filter((a) => A?.get(a.id)).sort((a, b) => Number(b.active) - Number(a.active) || (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
        const lead = busy.find((a) => a.id === followRef.current) ?? busy[0];
        const here = lead ? idx.m.get(A!.get(lead.id)!.file) : undefined;
        const mine = new Set<GNode>();
        let named = 0;
        for (let f = here?.dir ? here : here?.up; f && named < 2; f = f.up) {
          if (f.x === undefined || f.y === undefined || f.r * k < 7) continue;
          mine.add(f);
          const top = !f.up;
          if (label(folderName(f), X(f.x), top ? Math.max(3, Y(f.y - f.r) - 12) : Math.max(3, Y(f.y - f.r) + 2), 9.5, 700, agentColor(lead!, accentRef.current), 1)) named++;
        }
        for (const n of g.folders) {
          if (n.up || mine.has(n) || n.x === undefined || n.y === undefined || n.r * k < 18) continue;
          label(folderName(n), X(n.x), Math.max(3, Y(n.y - n.r) - 12), 9, 600, ink, 0.55);
        }
        for (const n of g.folders) {
          if (!n.up || n.up.up || mine.has(n) || n.x === undefined || n.y === undefined || n.r * k < 16) continue;
          label(folderName(n), X(n.x), Math.max(3, Y(n.y - n.r) + 2), 8.5, 600, ink, 0.42);
        }
        // The big camera's frame, the rest veiled (not while it shows the whole map).
        const c = cam.current, bv = c?.view(), s = c?.safe.current;
        if (bv && s) {
          const hw = s.w / 2 / bv.k, hh = s.h / 2 / bv.k;
          const rx = X(bv.x - hw), ry = Y(bv.y - hh), rw = 2 * hw * k, rh = 2 * hh * k;
          if (rx > 1 || ry > 1 || rx + rw < W - 1 || ry + rh < H - 1) {
            ctx.globalAlpha = 0.07; ctx.fillStyle = ink;
            ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.rect(rx, ry, rw, rh); ctx.fill("evenodd");
            ctx.globalAlpha = 0.9; ctx.strokeStyle = accentRef.current; ctx.lineWidth = 1.5;
            ctx.strokeRect(rx + 0.75, ry + 0.75, Math.max(2, rw - 1.5), Math.max(2, rh - 1.5));
          }
        }
      }

      // ---- a replay's marker, where the thread was at that moment: the same blue, faint, under the agents where they are
      // now (at the newest moment the two meet, the agent on top) ----
      const mk = subjectRef.current();
      if (mk) {
        ctx.globalAlpha = PAST_ALPHA;
        ctx.beginPath(); ctx.arc(X(mk.x), Y(mk.y), 4.6, 0, Math.PI * 2); ctx.fillStyle = accentRef.current; ctx.fill();
      }
      // ---- agents: those in the picture where they are; up close, the one watched, off the picture, is an arrow on the
      // edge pointing where it is ----
      for (const a of drawn) {
        const p = A?.get(a.id);
        if (!p || p.alpha < 0.05) continue;
        const ax = X(p.x), ay = Y(p.y), c = agentColor(a, accentRef.current), on = a.id === (who?.id ?? followRef.current);
        if (ax > -4 && ax < W + 4 && ay > -4 && ay < H + 4) {
          ctx.globalAlpha = p.alpha > 0.5 ? 1 : Math.max(0.3, p.alpha);   // solid where it is now (faint: another agent, while one is followed)
          ctx.beginPath(); ctx.arc(ax, ay, (on ? 4.6 : 3.4) + 1.5, 0, Math.PI * 2); ctx.fillStyle = st.halo; ctx.fill();
          ctx.beginPath(); ctx.arc(ax, ay, on ? 4.6 : 3.4, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill();
        } else if (close && on) {
          const ang = Math.atan2(ay - H / 2, ax - W / 2), m = 9;
          const s = Math.min((W / 2 - m) / Math.max(1e-6, Math.abs(Math.cos(ang))), (H / 2 - m) / Math.max(1e-6, Math.abs(Math.sin(ang))));
          const ex = W / 2 + Math.cos(ang) * s, ey = H / 2 + Math.sin(ang) * s;
          ctx.globalAlpha = 0.95; ctx.fillStyle = c;
          ctx.beginPath();
          ctx.moveTo(ex + Math.cos(ang) * 6, ey + Math.sin(ang) * 6);
          ctx.lineTo(ex + Math.cos(ang + 2.4) * 6, ey + Math.sin(ang + 2.4) * 6);
          ctx.lineTo(ex + Math.cos(ang - 2.4) * 6, ey + Math.sin(ang - 2.4) * 6);
          ctx.closePath(); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // What it shows, in its header: what was read, the file (or how many), its folder. Nothing over the whole project.
      const verb = read ? (R?.past ? "Read at this step" : `${who?.isSubagent ? `${shortName(who, 14)} read` : "Read"}`) : "";
      const file = read ? (together.length > 1 ? `${together.length} files` : baseName(read.file?.path ?? read.id)) : "";
      const dir = read?.file?.path ? folderOf(read.file.path, rootsRef.current) : "";
      for (const [el2, text] of [[verbEl.current, verb], [fileEl.current, file], [dirEl.current, dir]] as const) {
        if (el2 && el2.textContent !== text) el2.textContent = text;
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [graphRef, anim, drawnRef, cam, W, H]);

  // A click: the big map shows that place (the file read, or the point clicked on the whole map).
  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    const s = shows.current, v = view.current;
    if (s.id) { onLook(s.x, s.y, 600); return; }
    if (!v) return;
    const r = e.currentTarget.getBoundingClientRect();
    onLook(v.x + (e.clientX - r.left - W / 2) / v.k, v.y + (e.clientY - r.top - H / 2) / v.k, 600);
  };

  return (
    <section className={`readmap${big ? " big" : ""}`} aria-label="Readmap: the file the agent is reading" style={{ width: W + 2 }}>
      <header className="peek-head mm-head">
        <span className="peek-verb" ref={verbEl} />
        <span className="peek-file"><strong ref={fileEl} /><span ref={dirEl} /></span>
        {agents.length > 0 && (
          <span className="mm-agents" role="group" aria-label="Follow an agent">
            {agents.map((a) => {
              const on = a.id === followId, color = agentColor(a, accent);
              return (
                <button key={a.id} className={on ? "on" : ""} style={{ ["--c" as string]: color }} onClick={() => onTrack(a.id)}
                  aria-pressed={on} title={`${on ? "Following" : "Follow"} ${a.isSubagent ? shortName(a, 40) : "the main agent"} (A: the next one)`}>
                  <i aria-hidden="true">{initial(a)}</i>
                </button>
              );
            })}
          </span>
        )}
        <button className="peek-close" onClick={onHide} aria-label="Hide the Readmap (M)" title="Hide (M)">{Icon.close}</button>
      </header>
      <canvas ref={canvas} style={{ width: W, height: H }} role="img" onClick={onClick}
        aria-label="The file the agent read last, up close, with the files around it. Click to show it on the map." />
    </section>
  );
}

/** The view that shows the whole map in the picture. */
function wholeView(g: Graph, W: number, H: number): View | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of g.nodes) {
    if (n.x === undefined || n.y === undefined || (!n.dir && n.up)) continue;   // a folder's files are inside it
    x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r);
  }
  if (x0 === Infinity) return null;
  const k = Math.min((W - 16) / Math.max(1, x1 - x0), (H - 16) / Math.max(1, y1 - y0));
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k };
}

/** The agents you can follow from the Readmap: the open thread's (main first, then its subagents), or else everyone on
 *  the map at work or lately (main agents first). At most `max`, in an order that doesn't change as they work. */
export function trackable(drawn: AgentPresence[], max = 6): AgentPresence[] {
  const byId = (a: AgentPresence, b: AgentPresence) => a.id.localeCompare(b.id);
  return [...drawn.filter((a) => !a.isSubagent).sort(byId), ...drawn.filter((a) => a.isSubagent).sort(byId)].slice(0, max);
}

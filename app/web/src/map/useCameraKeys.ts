// The camera's keys, registered in the shortcuts registry (switch/shortcuts.ts: map.move, map.zoom, center,
// follow.again, follow.stop). Moved out of useMapCamera.ts.
import { useEffect, useRef, type RefObject } from "react";
import type { ThreadReplay } from "../lib/nav";
import { keyRules, useShortcut, windowOpen } from "../switch/shortcuts";
import type { ThreadLayerApi } from "./thread/ThreadLayer";
import type { Camera } from "./camera";
import type { AgentAnim } from "./agents";

export function useCameraKeys({ camRef, replayRef, followRef, setFollowId, anim, replay, free, taken, followAgain }: {
  camRef: RefObject<Camera>; replayRef: RefObject<ThreadLayerApi>;
  followRef: RefObject<string | null>; setFollowId: (id: string | null) => void;
  anim: RefObject<Map<string, AgentAnim>>; replay: ThreadReplay | null;
  /** The camera is yours now (a hand move): no automatic re-frame. */
  free: () => void;
  /** Whether the camera is yours (the director lets it be), and giving it back to the director. */
  taken: () => boolean; followAgain: () => void;
}) {
  const freeRef = useRef(free); freeRef.current = free;
  // The arrow keys glide the map while they're held (two at once go diagonally); with Shift, ↑ and ↓ zoom in and out
  // instead (+ and − too, = and _ without Shift); all easing in and out: the map without a mouse or trackpad. In the
  // replay player ← → step through it, so only Shift ↑ ↓ zoom there; none in the Track's list (there they scroll it).
  // One loop, only while a key is held or a glide eases out. Moving the map hands the camera to you, as a drag does
  // (the director lets go until you follow again: F, Esc or the pill). The key presses come through the registry; their releases (and the window losing
  // focus) are listened to here, since the registry hands out presses only.
  const keyDown = useRef<(e: KeyboardEvent) => boolean>(() => false);
  useEffect(() => {
    const DIR: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const ZOOM: Record<string, number> = { "+": 1, "=": 1, "-": -1, "_": -1 };
    const SPEED = 700, EASE = 0.09; // screen px per second; seconds to (nearly) reach the speed or stop
    const ZOOM_RATE = 1.5;          // held: the zoom grows or shrinks by e^1.5 (4.5×) a second
    const held = new Set<string>();
    const vel = { x: 0, y: 0, z: 0 };
    let shift = false, raf = 0, last = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      let dx = 0, dy = 0, dz = 0;
      for (const k of held) {
        if (shift && (k === "ArrowUp" || k === "ArrowDown")) dz += k === "ArrowUp" ? 1 : -1;
        else if (DIR[k]) { dx += DIR[k][0]; dy += DIR[k][1]; }
        else dz += ZOOM[k] ?? 0;
      }
      const n = Math.hypot(dx, dy) || 1;
      const f = 1 - Math.exp(-dt / EASE);
      vel.x += ((dx / n) * SPEED - vel.x) * f;
      vel.y += ((dy / n) * SPEED - vel.y) * f;
      vel.z += (Math.sign(dz) * ZOOM_RATE - vel.z) * f;
      if (!held.size && Math.hypot(vel.x, vel.y) < 8 && Math.abs(vel.z) < 0.02) { raf = 0; vel.x = vel.y = vel.z = 0; return; }
      if (vel.x || vel.y) camRef.current.nudge(vel.x * dt, vel.y * dt);
      if (vel.z) camRef.current.zoomBy(Math.exp(vel.z * dt));
      raf = requestAnimationFrame(tick);
    };
    keyDown.current = (e: KeyboardEvent) => {
      if (e.key === "Shift") { shift = true; return false; }
      const d = DIR[e.key];
      const z = e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown") ? (e.key === "ArrowUp" ? 1 : -1) : ZOOM[e.key];
      if ((!d && !z) || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (!z && replayRef.current.playable)) return false;
      if (keyRules.keepsArrows(e.target)) return false;
      e.preventDefault();
      shift = e.shiftKey;
      if (held.has(e.key)) return true; // the key's own repeats: the loop is already gliding
      held.add(e.key);
      freeRef.current();
      // A tap still moves a little: start at half speed rather than from rest (a zoom at full speed: a tap is a step).
      if (z) { if (Math.abs(vel.z) < ZOOM_RATE) vel.z = z * ZOOM_RATE; }
      else {
        if (Math.abs(vel.x) < SPEED / 2 && d[0]) vel.x = d[0] * SPEED / 2;
        if (Math.abs(vel.y) < SPEED / 2 && d[1]) vel.y = d[1] * SPEED / 2;
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
      return true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") { shift = false; held.delete("+"); held.delete("_"); } // + and _ need Shift: no key-up of their own may come
      held.delete(e.key);
      if (e.key === "=") held.delete("+"); if (e.key === "-") held.delete("_");
    };
    const release = () => { held.clear(); shift = false; }; // the window lost focus: no key-up will come
    addEventListener("keyup", onUp);
    addEventListener("blur", release);
    return () => { keyDown.current = () => false; removeEventListener("keyup", onUp); removeEventListener("blur", release); cancelAnimationFrame(raf); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useShortcut("map.move", (e) => !!e && keyDown.current(e));
  useShortcut("map.zoom", (e) => !!e && keyDown.current(e));
  // C centres the camera on the agent once, without locking: the replay's marker, the agent you follow, the open thread's
  // agent, or else the agent that moved last. Zoomed far out, it comes in a little so the agent reads.
  useShortcut("center", () => {
    const agents = anim.current;
    const newest = () => { let best: AgentAnim | undefined; for (const a of agents.values()) if (!best || a.lastTs > best.lastTs) best = a; return best; };
    const at = replayRef.current.subject()
      ?? (followRef.current ? agents.get(followRef.current) : undefined)
      ?? (replay ? agents.get(replay.sessionId) : undefined)
      ?? (replay ? undefined : newest());
    if (!at) return false;
    freeRef.current();
    const k = camRef.current.view()?.k ?? 1;
    camRef.current.lookAt(at.x, at.y, Math.max(k, 1.6), 600);
  });
  // F: follow again, the director has the camera back.
  useShortcut("follow.again", () => { if (windowOpen() || !taken()) return false; followAgain(); });
  // Esc gives the camera back to the director if you had taken it, else stops following an agent, before it steps back
  // out of anything else (the registry tries it before "back"). A window open over the map (Settings, Find a thread, a
  // picture) takes that Esc for itself.
  useShortcut("follow.stop", (e) => {
    if ((e && (e.defaultPrevented || keyRules.inField(e.target))) || windowOpen()) return false;
    if (taken()) { e?.preventDefault(); followAgain(); return; }
    if (!followRef.current) return false;
    e?.preventDefault();
    setFollowId(null);
  });
}

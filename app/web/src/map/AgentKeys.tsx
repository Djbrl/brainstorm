// The agents on the map, by keyboard: one invisible button per agent marker, over the canvas. Tab and Shift+Tab move
// between them (a ring shows on the marker that has focus), Enter follows it, and focus does what hovering its file
// does (its name shows). While one has focus the buttons keep to their markers; else they rest, and the map with them.
import { useEffect, useRef, useState, type RefObject } from "react";
import type { AgentPresence } from "@contract";
import type { Camera } from "./camera";
import type { AgentAnim } from "./agents";
import "./agent-keys.css";

export function AgentKeys({ agents, anim, cam, onFollow, onHover }: {
  agents: AgentPresence[]; anim: RefObject<Map<string, AgentAnim>>; cam: RefObject<Camera>;
  onFollow: (id: string) => void;
  /** The file its marker stands on, as a hover would (null: let go). */
  onHover: (file: string | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<string | null>(null);
  /** Where agent `id` is on screen (CSS pixels in the map), or null. */
  const at = (id: string) => {
    const st = anim.current.get(id), c = cam.current, v = c.view(), s = c.safe.current;
    return st && v ? { x: s.w / 2 + (st.x - v.x) * v.k, y: s.h / 2 + (st.y - v.y) * v.k, st } : null;
  };
  useEffect(() => {
    if (!focused) return;
    let raf = 0;
    const place = () => {
      for (const el of box.current?.children ?? []) {
        const p = at((el as HTMLElement).dataset.id ?? "");
        // Kept inside the map (a focused button off its edge would scroll the layer), the camera brings it in.
        const s = cam.current.safe.current;
        if (p) (el as HTMLElement).style.transform = `translate(${Math.max(0, Math.min(s.w, p.x))}px, ${Math.max(0, Math.min(s.h, p.y))}px)`;
      }
      raf = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps

  const revealing = useRef(false);
  const onFocus = (id: string) => {
    setFocused(id);
    if (revealing.current) { cam.current.stop(); revealing.current = false; }   // the agent before's trip in
    const p = at(id);
    if (!p) return;
    onHover(p.st.file);
    // Off the screen: bring it in (just enough), so its ring shows. That's looking around by hand: the director lets
    // go ("Follow again" brings it back, as Enter on the agent does).
    const s = cam.current.safe.current;
    if (p.x < s.left || p.x > s.w - s.right || p.y < s.top || p.y > s.h - s.bottom) { cam.current.touch(); cam.current.reveal(p.st.x, p.st.y, 20, 400); revealing.current = true; }
  };
  const onBlur = (e: React.FocusEvent) => {
    if (box.current?.contains(e.relatedTarget as Node)) return;
    setFocused(null);
    onHover(null);
  };
  if (!agents.length) return null;
  return (
    <div className="agent-keys" ref={box} role="group" aria-label="Agents on the map">
      {agents.map((a) => (
        <button key={a.id} data-id={a.id} className="agent-key" aria-label={`Follow ${a.name}`}
          onFocus={() => onFocus(a.id)} onBlur={onBlur} onClick={() => onFollow(a.id)} />
      ))}
    </div>
  );
}

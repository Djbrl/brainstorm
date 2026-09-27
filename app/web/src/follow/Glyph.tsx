// Owner: C. Tiny inline SVG glyphs per step kind.
import type { StepKind } from "@contract";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function Glyph({ kind, tool, size = 16 }: { kind: StepKind; tool?: string; size?: number }) {
  const s = { width: size, height: size, viewBox: "0 0 16 16" };
  switch (kind) {
    case "prompt": // person
      return <svg {...s}><circle cx="8" cy="5.5" r="2.6" {...P} /><path d="M3 13.5c.8-2.4 2.7-3.6 5-3.6s4.2 1.2 5 3.6" {...P} /></svg>;
    case "text": // speech
      return <svg {...s}><path d="M3 4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5A1.5 1.5 0 0 1 11.5 11H7l-3 2.3V11h0A1.5 1.5 0 0 1 3 9.5z" {...P} /></svg>;
    case "thinking": // spark
      return <svg {...s}><path d="M8 2.5v2.2M8 11.3v2.2M2.5 8h2.2M11.3 8h2.2M4.1 4.1l1.5 1.5M10.4 10.4l1.5 1.5M4.1 11.9l1.5-1.5M10.4 5.6l1.5-1.5" {...P} /></svg>;
    case "edit": // pencil
      return <svg {...s}><path d="M10.2 3.3l2.5 2.5L6 12.5l-3.2.7.7-3.2z" {...P} /><path d="M9 4.5l2.5 2.5" {...P} /></svg>;
    default:
      if (tool === "Bash") // terminal
        return <svg {...s}><path d="M3.5 5l3 3-3 3M8.5 11.5h4" {...P} /></svg>;
      if (tool === "Read" || tool === "Grep" || tool === "Glob" || tool === "WebSearch") // lens
        return <svg {...s}><circle cx="7" cy="7" r="3.8" {...P} /><path d="M10 10l3 3" {...P} /></svg>;
      if (tool === "Task" || tool === "Agent") // branch
        return <svg {...s}><circle cx="4.5" cy="4" r="1.5" {...P} /><circle cx="4.5" cy="12" r="1.5" {...P} /><circle cx="11.5" cy="8" r="1.5" {...P} /><path d="M4.5 5.5v5M4.5 7.5c0 .5 1.5.5 5.5.5" {...P} /></svg>;
      return <svg {...s}><path d="M9.8 2.8a3 3 0 0 0-3.4 4L2.8 10.4a1.2 1.2 0 0 0 1.7 1.7l3.6-3.6a3 3 0 0 0 4-3.4l-1.8 1.8-1.6-.3-.3-1.6z" {...P} /></svg>; // wrench
  }
}

export function RiskIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16"><path d="M8 2.5l6 10.5H2z" {...P} /><path d="M8 7v2.6M8 11.3v.1" {...P} /></svg>;
}

export function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" {...P} /></svg>;
}

export function FileIcon() {
  return <svg width="12" height="12" viewBox="0 0 16 16"><path d="M4 2.5h5l3 3v8H4z" {...P} /><path d="M9 2.5v3h3" {...P} /></svg>;
}

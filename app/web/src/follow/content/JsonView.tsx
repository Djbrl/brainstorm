// A collapsible JSON tree: small things open, big things folded, long strings clipped.
import { useState } from "react";

const LONG = 220;

function Str({ s }: { s: string }) {
  const [all, setAll] = useState(false);
  if (s.includes("\n") && s.length > 60) {
    return (
      <span className="jv-block">
        <pre>{all || s.length <= 1200 ? s : `${s.slice(0, 1200)}…`}</pre>
        {s.length > 1200 && !all && <button className="jv-more" onClick={() => setAll(true)}>Show all</button>}
      </span>
    );
  }
  return (
    <span className="jv-str">
      “{all || s.length <= LONG ? s : `${s.slice(0, LONG)}…`}”
      {s.length > LONG && !all && <button className="jv-more" onClick={() => setAll(true)}>more</button>}
    </span>
  );
}

function Leaf({ v }: { v: unknown }) {
  if (v === null) return <span className="jv-lit">null</span>;
  if (typeof v === "string") return /^https?:\/\/\S+$/.test(v) ? <a className="jv-link" href={v} target="_blank" rel="noreferrer noopener">{v}</a> : <Str s={v} />;
  if (typeof v === "number") return <span className="jv-num">{v}</span>;
  if (typeof v === "boolean") return <span className="jv-lit">{String(v)}</span>;
  return <span className="jv-lit">{String(v)}</span>;
}

const isBranch = (v: unknown): v is Record<string, unknown> | unknown[] => !!v && typeof v === "object";
const sizeOf = (v: Record<string, unknown> | unknown[]) => (Array.isArray(v) ? v.length : Object.keys(v).length);

function Node({ name, v, depth }: { name?: string; v: unknown; depth: number }) {
  const branch = isBranch(v);
  const n = branch ? sizeOf(v) : 0;
  const [open, setOpen] = useState(() => (depth < 2 && n <= 14) || (depth < 4 && n <= 4));
  const key = name !== undefined && <span className="jv-key">{name}</span>;
  if (!branch) return <div className="jv-row">{key}<Leaf v={v} /></div>;
  const arr = Array.isArray(v);
  if (n === 0) return <div className="jv-row">{key}<span className="jv-lit">{arr ? "empty list" : "empty"}</span></div>;
  const entries: [string, unknown][] = arr ? v.map((x, i) => [String(i + 1), x]) : Object.entries(v);
  return (
    <div className="jv-node">
      <button className="jv-row jv-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <svg className="jv-chev" width="10" height="10" viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {key}
        <span className="jv-count">{arr ? `${n} item${n === 1 ? "" : "s"}` : `${n} field${n === 1 ? "" : "s"}`}</span>
      </button>
      {open && <div className="jv-kids">{entries.slice(0, 200).map(([k, x]) => <Node key={k} name={k} v={x} depth={depth + 1} />)}{entries.length > 200 && <div className="jv-row jv-lit">…and {entries.length - 200} more</div>}</div>}
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  if (!isBranch(value)) return <div className="jv"><Leaf v={value} /></div>;
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((x, i) => [String(i + 1), x]) : Object.entries(value);
  return <div className="jv">{entries.slice(0, 200).map(([k, x]) => <Node key={k} name={k} v={x} depth={1} />)}</div>;
}

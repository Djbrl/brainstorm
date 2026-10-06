// A prompt in the step panel: the person's words first, as they wrote them (Markdown, addresses as links), with what
// Claude Code or its host added to their turn as small chips below ("Artifact view", "Command: /compact"); a chip
// opens to show what it carried. Pasted text stays where it was pasted, folded.
import { useEffect, useMemo, useState } from "react";
import { Markdown } from "../ask/Markdown";
import { parseJson } from "./content/parse";
import { JsonView } from "./content/JsonView";
import { childTags, parsePrompt, type Block } from "./prompt";
import "./prompt.css";

const Chev = () => (
  <svg className="pb-chev" width="9" height="9" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);

const human = (k: string) => { const s = k.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); };

/** Child tags as an object for the JSON tree: `<usage><tool_uses>66</tool_uses></usage>` → { Usage: { "Tool uses": "66" } }. */
function asFields(body: string, depth = 0): Record<string, unknown> | null {
  const kids = childTags(body);
  if (!kids.size) return null;
  let rest = body;
  for (const k of kids.keys()) rest = rest.replace(new RegExp(`<${k}(\\s[^>]*)?>[\\s\\S]*?</${k}>`), "");
  if (rest.trim().length > 80) return null; // mostly prose with a tag or two in it
  const out: Record<string, unknown> = {};
  for (const [k, v] of kids) out[human(k)] = (depth < 3 && asFields(v, depth + 1)) || v.trim();
  if (rest.trim()) out.Note = rest.trim();
  return out;
}

/** What a chip carried: a JSON tree when it's JSON (or a JSON line with a note after it), fields for child tags, else text. */
function BlockBody({ b }: { b: Block }) {
  const body = b.body.trim();
  const shown = useMemo(() => {
    const json = parseJson(body);
    if (json !== undefined) return { json };
    const nl = body.indexOf("\n");
    const head = nl === -1 ? undefined : parseJson(body.slice(0, nl));
    if (head !== undefined) return { json: head, note: body.slice(nl + 1).trim() };
    const fields = asFields(body);
    if (fields) return { json: fields };
    return { text: body };
  }, [body]);
  const command = b.attrs.command;
  return (
    <div className="pb-detail">
      {command && <pre className="pb-cmd">$ {command}</pre>}
      {shown.json !== undefined && <JsonView value={shown.json} />}
      {shown.note && <p className="pb-note">{shown.note}</p>}
      {shown.text ? <div className="pb-text"><Markdown text={shown.text} /></div>
        : shown.json === undefined && !command && <p className="pb-note">Nothing in it.</p>}
    </div>
  );
}

function Paste({ b, initial }: { b: Block; initial: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="pb-paste">
      <button className={`pb-chip${open ? " on" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}><Chev />{b.name}</button>
      {open && <div className="pb-detail"><div className="pb-text"><Markdown text={b.body} /></div></div>}
    </div>
  );
}

export function PromptBody({ text }: { text: string }) {
  const p = useMemo(() => parsePrompt(text), [text]);
  const typed = p.parts.some((x) => x.t === "text");
  const nothingElse = !p.parts.length;
  // With nothing typed, the first chip starts open: the panel shows what this turn was.
  const [open, setOpen] = useState<number[]>(() => (nothingElse && p.blocks.length ? [0] : []));
  useEffect(() => setOpen(nothingElse && p.blocks.length ? [0] : []), [p, nothingElse]);
  const toggle = (i: number) => setOpen((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i].sort((a, b) => a - b)));
  return (
    <div className="pb">
      {p.parts.map((part, i) => part.t === "text"
        ? <Markdown key={i} text={part.text} />
        : <Paste key={i} b={part.block} initial={!typed} />)}
      {p.blocks.length > 0 && (
        <div className="pb-context">
          <div className="pb-chips">
            {p.blocks.map((b, i) => (
              <button key={i} className={`pb-chip${open.includes(i) ? " on" : ""}`} onClick={() => toggle(i)} aria-expanded={open.includes(i)}
                title={b.tag === "command" || b.tag === "bash" || b.tag === "claude-md" ? undefined : `Added to your message by the agent or the app you use it in (<${b.tag}>)`}>
                <Chev /><span>{b.name}</span>
              </button>
            ))}
          </div>
          {open.map((i) => p.blocks[i] && <BlockBody key={i} b={p.blocks[i]} />)}
        </div>
      )}
    </div>
  );
}

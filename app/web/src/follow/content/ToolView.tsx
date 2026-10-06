// The body of a tool step in the step panel, shaped per tool: a terminal for commands, numbered code for
// reads, one row per browser action with its screenshots, links for searches, and fields or a JSON tree for the rest.
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Step } from "@contract";
import { Markdown } from "../../ask/Markdown";
import { useNav } from "../../lib/nav";
import { highlightLines, langOf, renderPieces, useGrammar, usePalette } from "../../lib/highlight";
import { basename, displayLabel } from "../format";
import { JsonView } from "./JsonView";
import { UrlLink } from "../../lib/links";
import { HtmlPreview, isHtml, PAGE_MARKUP, ViewSwitch } from "./HtmlPreview";
import { Lightbox } from "./Lightbox";
import { cleanResult, formatCommand, hostOf, humanKey, parseJson, parseNumbered, parseSearch, parseShell, splitBatch, splitTabContext, type Tab } from "./parse";
import "./content.css";

type Input = Record<string, unknown>;
const obj = (v: unknown): Input => (v && typeof v === "object" && !Array.isArray(v) ? (v as Input) : {});
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const MARKDOWN = /(^|\n)(#{1,4} |[-*] |\d+\. |> )|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/;

/**
 * Show at most `max` lines, with a button for the rest; colour-coded when `lang` names a grammar (lib/highlight.ts):
 * a script a browser step ran, the script inside a command, a file read without line numbers.
 */
function Clip({ text, max = 40, className, lang }: { text: string; max?: number; className?: string; lang?: string }) {
  const [all, setAll] = useState(false);
  const lines = text.split("\n");
  const shown = all || lines.length <= max ? text : lines.slice(0, max).join("\n");
  const hasGrammar = useGrammar(shown.length < 200_000 ? lang : undefined);
  const { palette } = usePalette();
  const coloured = useMemo(() => (hasGrammar ? highlightLines(shown, lang) : null), [hasGrammar, shown, lang]);
  return (
    <>
      <pre className={className}>{coloured ? coloured.map((l, i) => <Fragment key={i}>{renderPieces(l, palette)}{i < coloured.length - 1 ? "\n" : ""}</Fragment>) : shown}</pre>
      {!all && lines.length > max && <button className="cv-more" onClick={() => setAll(true)}>Show all {lines.length.toLocaleString()} lines</button>}
    </>
  );
}

function Block({ title, aside, children }: { title?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="cv-block">
      {(title || aside) && <div className="cv-head"><span className="cv-title">{title}</span>{aside && <span className="cv-aside">{aside}</span>}</div>}
      {children}
    </section>
  );
}

/** Any result text: a JSON tree if it's JSON, Markdown if it reads like Markdown, else plain lines. */
export function Output({ text, title = "Result" }: { text: string; title?: ReactNode }) {
  const clean = cleanResult(text);
  if (!clean) return null;
  const json = parseJson(clean);
  if (json !== undefined) return <Block title={title}><JsonView value={json} /></Block>;
  if (MARKDOWN.test(clean) && clean.length > 120) return <Block title={title}><div className="cv-md"><Markdown text={clean} /></div></Block>;
  return <Block title={title}><Clip text={clean} className="cv-plain" /></Block>;
}

/** A tool's input as labelled fields: short values inline, long text as a block, nested values as a JSON tree. */
export function Fields({ input, skip = [] }: { input: unknown; skip?: string[] }) {
  if (typeof input === "string") return <Clip text={input} className="cv-plain" />;
  const entries = Object.entries(obj(input)).filter(([k, v]) => !skip.includes(k) && v !== undefined && v !== null && v !== "");
  if (!entries.length) return null;
  return (
    <dl className="cv-fields">
      {entries.map(([k, v]) => {
        const long = typeof v === "string" && (v.length > 90 || v.includes("\n"));
        return (
          <div key={k} className={`cv-field${long || (v && typeof v === "object") ? " wide" : ""}`}>
            <dt>{humanKey(k)}</dt>
            <dd>
              {typeof v === "string"
                ? long ? (MARKDOWN.test(v) ? <div className="cv-md"><Markdown text={v} /></div> : <Clip text={v} max={14} className="cv-plain" />)
                  : /^https?:\/\/\S+$/.test(v) ? <a href={v} target="_blank" rel="noreferrer noopener">{v}</a> : v
                : v && typeof v === "object" ? <JsonView value={v} /> : <span className="cv-lit">{String(v)}</span>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

// ---------- terminal ----------

/** The grammar for a script inside a command (formatCommand's names). */
const SCRIPT_LANG: Record<string, string> = { Python: "python", JavaScript: "javascript", Shell: "bash" };

export function Command({ command }: { command: string }) {
  const { lines, scripts } = formatCommand(command);
  return (
    <>
      <pre className="cv-term cv-cmd">
        {lines.map((line, i) => (
          <div key={i} className="cv-line">
            {i === 0 && <span className="cv-prompt">$ </span>}
            {i > 0 && <span className="cv-indent">  </span>}
            {line.map((t, j) => /^⟨script \d+⟩$/.test(t.t)
              ? <span key={j} className="sh-ref">{scripts.length > 1 ? `(script ${t.t.replace(/\D/g, "")} below)` : "(below)"}</span>
              : <span key={j} className={`sh-${t.k}`}>{t.t}</span>)}
          </div>
        ))}
      </pre>
      {scripts.map((s, i) => (
        <Block key={i} title={scripts.length > 1 ? `${s.lang} (script ${i + 1})` : s.lang}>
          <Clip text={s.body} max={30} className="cv-code" lang={SCRIPT_LANG[s.lang]} />
        </Block>
      ))}
    </>
  );
}

function Terminal({ input, result, title }: { input: Input; result?: Step; title: string }) {
  const command = str(input.command) ?? "";
  const r = result ? parseShell(result.text ?? "") : null;
  const failed = r?.exitCode !== undefined && r.exitCode !== 0;
  const json = r ? parseJson(r.output) : undefined;
  return (
    <>
      {str(input.description) && str(input.description) !== title && <p className="cv-why">{str(input.description)}</p>}
      <Command command={command} />
      {r && (
        <Block
          title="Output"
          aside={r.background ? <span className="cv-chip">Running in the background</span>
            : failed ? <span className="cv-chip fail">Failed · exit code {r.exitCode}</span>
            : null}
        >
          {r.background ? <p className="cv-muted">It keeps running after this step; its output arrives later.</p>
            : json !== undefined ? <JsonView value={json} />
            : r.output.trim() ? <Clip text={r.output} className={`cv-term cv-out${failed ? " fail" : ""}`} />
            : <p className="cv-muted">{failed ? "No output." : "Done, no output."}</p>}
        </Block>
      )}
    </>
  );
}

// ---------- files and searches ----------

/** Numbered lines (a read, a new file), the first 80 with a button for the rest. */
/**
 * Numbered lines of a file, colour-coded by its language (`path`'s extension: lib/highlight.ts) once the grammar is in;
 * the first 80, or all of them on request. Very long files stay plain.
 */
export function Code({ start, lines, path }: { start: number; lines: string[]; path?: string }) {
  const [all, setAll] = useState(false);
  const max = 80;
  const shown = useMemo(() => (all ? lines : lines.slice(0, max)), [all, lines]);
  const width = String(start + lines.length).length;
  const lang = shown.length <= 3000 ? langOf(path) : undefined;
  const hasGrammar = useGrammar(lang);
  const { palette } = usePalette();
  const coloured = useMemo(() => (hasGrammar ? highlightLines(shown.join("\n"), lang) : null), [hasGrammar, shown, lang]);
  return (
    <>
      <pre className="cv-code cv-numbered" style={{ ["--gutter" as string]: `${width + 1}ch` }}>
        {shown.map((l, i) => <div key={i}><span className="cv-ln">{start + i}</span>{coloured?.[i]?.length ? renderPieces(coloured[i], palette) : l || " "}</div>)}
      </pre>
      {!all && lines.length > max && <button className="cv-more" onClick={() => setAll(true)}>Show all {lines.length} lines</button>}
    </>
  );
}

function ReadView({ input, result }: { input: Input; result?: Step }) {
  const { openFile } = useNav();
  const path = str(input.file_path) ?? str(input.path) ?? "";
  const text = cleanResult(result?.text ?? "");
  const numbered = parseNumbered(text);
  const offset = Number(input.offset) || 0, limit = Number(input.limit) || 0;
  const range = numbered ? `Lines ${numbered.start}–${numbered.start + numbered.lines.length - 1}` : offset || limit ? `From line ${offset || 1}` : null;
  // An HTML file read from its top (a page, not a stretch of its CSS): shown as the page first, its code a click away.
  const page = isHtml(path) && !!numbered && numbered.start === 1 && PAGE_MARKUP.test(text);
  const [view, setView] = useState<"page" | "code">("page");
  return (
    <Block title={<button className="cv-file" onClick={() => openFile(path)} title={`${path}\nShow on the map`}>{basename(path)}</button>}
      aside={page ? <ViewSwitch view={view} onView={setView} /> : range}>
      {!result ? <p className="cv-muted">Reading…</p>
        : page && view === "page" ? <HtmlPreview html={numbered!.lines.join("\n")} />
        : numbered ? <Code start={numbered.start} lines={numbered.lines} path={path} />
        : text ? <Clip text={text} className="cv-code" lang={langOf(path)} />
        : IMAGE.test(path) ? <Shots resultId={result.id} label="Image" />
        : <p className="cv-muted">Empty file.</p>}
    </Block>
  );
}

function SearchFiles({ input, result }: { input: Input; result?: Step }) {
  const { openFile } = useNav();
  const text = cleanResult(result?.text ?? "");
  const lines = text.split("\n").filter(Boolean);
  const head = /^Found \d+ (files?|matches?|lines?)/.test(lines[0] ?? "") ? lines.shift() : undefined;
  const paths = lines.length && lines.every((l) => l.startsWith("/") && !/:\d+:/.test(l));
  return (
    <>
      <Fields input={input} skip={["output_mode", "-n", "head_limit"]} />
      {result && (
        <Block title="Found" aside={head?.replace(/^Found /, "") ?? (paths ? `${lines.length} files` : null)}>
          {!lines.length ? <p className="cv-muted">{text || "Nothing found."}</p>
            : paths ? (
              <ul className="cv-files">{lines.slice(0, 200).map((p) => (
                <li key={p}><button className="cv-file" onClick={() => openFile(p)} title={`${p}\nShow on the map`}>{basename(p)}</button><span className="cv-dir">{p.slice(0, -basename(p).length).replace(/\/$/, "")}</span></li>
              ))}</ul>
            ) : <Clip text={lines.join("\n")} className="cv-code" />}
        </Block>
      )}
    </>
  );
}

function WebSearchView({ input, result }: { input: Input; result?: Step }) {
  const parsed = result ? parseSearch(cleanResult(result.text ?? "")) : null;
  return (
    <>
      <p className="cv-query">“{str(input.query)}”</p>
      {parsed ? (
        <>
          <Block title="Results" aside={`${parsed.links.length} links`}>
            <ul className="cv-links">{parsed.links.map((l) => (
              <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer noopener" title={l.url}>{l.title}</a><UrlLink url={l.url} max={56} className="cv-src" /></li>
            ))}</ul>
          </Block>
          {parsed.summary && <Output text={parsed.summary} title="What it found" />}
        </>
      ) : result && <Output text={result.text ?? ""} />}
    </>
  );
}

function WebFetchView({ input, result }: { input: Input; result?: Step }) {
  const url = str(input.url) ?? "";
  return (
    <>
      {/^https?:\/\//.test(url) ? <UrlLink url={url} max={52} className="cv-fetch" /> : <p className="cv-why">{url}</p>}
      {str(input.prompt) && <Block title="Looking for"><p className="cv-why">{str(input.prompt)}</p></Block>}
      {result && <Output text={result.text ?? ""} title="What it found" />}
    </>
  );
}

// ---------- browsers ----------

const BROWSER = /^mcp__(Claude_Browser|claude-in-chrome)__/;
const SHOT_TOOLS = /^mcp__(Claude_Browser|claude-in-chrome|Claude_Code_iOS_Simulator|computer-use)__/;

/** One browser action in words, plus code when it ran a script. */
function describe(name: string, input: Input): { verb: string; detail?: ReactNode; code?: string } {
  const n = name.replace(/_mcp$/, "");
  const ref = str(input.ref), coord = Array.isArray(input.coordinate) ? `(${(input.coordinate as number[]).join(", ")})` : undefined;
  const target = ref ?? coord;
  switch (n) {
    case "navigate": return { verb: input.url === "back" ? "Go back" : input.url === "forward" ? "Go forward" : "Open", detail: str(input.url) && input.url !== "back" && input.url !== "forward" ? <a href={str(input.url)} target="_blank" rel="noreferrer noopener">{str(input.url)}</a> : undefined };
    case "preview_start": return { verb: "Open a preview", detail: str(input.url) ?? str(input.name) };
    case "javascript_tool": return { verb: "Run a script", code: str(input.text) };
    case "find": return { verb: "Look for", detail: `“${str(input.query) ?? ""}”` };
    case "get_page_text": return { verb: "Read the page text" };
    case "read_page": return { verb: "Read the page", detail: str(input.filter) === "interactive" ? "buttons and fields" : undefined };
    case "form_input": return { verb: "Fill in", detail: `${ref ?? "a field"} with “${String(input.value ?? "")}”` };
    case "read_console_messages": return { verb: "Read the console", detail: input.onlyErrors ? "errors only" : undefined };
    case "read_network_requests": return { verb: "Read network requests", detail: str(input.urlPattern) };
    case "resize_window": return { verb: "Resize the window", detail: str(input.preset) ?? (input.width ? `${input.width}×${input.height}` : undefined) };
    case "tabs_create": return { verb: "Open a new tab" };
    case "tabs_close": return { verb: "Close a tab" };
    case "tabs_select": return { verb: "Switch tab" };
    case "tabs_context": return { verb: "List tabs" };
    case "preview_stop": return { verb: "Stop the preview" };
    case "preview_logs": return { verb: "Read the server logs", detail: str(input.search) };
    case "computer": {
      const a = str(input.action) ?? "";
      if (a === "screenshot") return { verb: "Take a screenshot" };
      if (a === "zoom") return { verb: "Zoom in" };
      if (/click/.test(a)) return { verb: a === "double_click" ? "Double-click" : a === "right_click" ? "Right-click" : a === "triple_click" ? "Select" : "Click", detail: target };
      if (a === "type") return { verb: "Type", detail: `“${str(input.text) ?? ""}”` };
      if (a === "key") return { verb: "Press", detail: str(input.text) };
      if (a === "scroll") return { verb: `Scroll ${str(input.scroll_direction) ?? ""}`.trim(), detail: target };
      if (a === "scroll_to") return { verb: "Scroll to", detail: target };
      if (a === "hover") return { verb: "Hover", detail: target };
      if (a === "wait") return { verb: "Wait", detail: input.duration ? `${input.duration} s` : undefined };
      if (a === "left_click_drag") return { verb: "Drag", detail: target };
      return { verb: humanKey(a || "computer") };
    }
    default: return { verb: humanKey(n) };
  }
}

/** Screenshots the tool returned, served by the local app (none in hosted replays: the images just don't load). */
/** A file read as a picture: Claude Code passes the image itself to the model, kept like a screenshot (server shots/). */
export const IMAGE = /\.(png|jpe?g|gif|webp|bmp)$/i;

/**
 * The pictures a tool returned (screenshots, an image read), loaded from the local server only when shown, one after
 * the other (a probe asks for the next until there's none).
 */
export function Shots({ resultId, label = "Screenshot" }: { resultId: string; label?: string }) {
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const [big, setBig] = useState<number | null>(null);   // the picture open large (Lightbox), if any
  useEffect(() => { setCount(0); setDone(false); setBig(null); }, [resultId]);
  const src = (i: number) => `/api/tasks/shot/${encodeURIComponent(resultId)}/${i}`;
  return (
    <>
      {count > 0 && (
        <div className={`cv-shots${count > 1 ? " many" : ""}`}>
          {Array.from({ length: count }, (_, i) => (
            <button key={i} className="cv-shot" onClick={() => setBig(i)} title="Open large"><img src={src(i)} alt={`${label} ${i + 1}`} decoding="async" /></button>
          ))}
        </div>
      )}
      {big !== null && big < count && (
        <Lightbox srcs={Array.from({ length: count }, (_, i) => src(i))} at={big} label={label} onAt={setBig} onClose={() => setBig(null)} />
      )}
      {!done && count < 12 && <img className="cv-probe" src={src(count)} alt="" onLoad={() => setCount((c) => c + 1)} onError={() => setDone(true)} />}
    </>
  );
}

function PageChip({ tab }: { tab?: Tab }) {
  if (!tab?.url && !tab?.title) return null;
  return (
    <a className="cv-page" href={tab.url} target="_blank" rel="noreferrer noopener" title={tab.url}>
      <svg width="12" height="12" viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M2 6h12" stroke="currentColor" strokeWidth="1.6" /></svg>
      <span className="t">{tab.title || hostOf(tab.url ?? "")}</span>
      {tab.url && <span className="u">{hostOf(tab.url)}</span>}
    </a>
  );
}

/** What a browser action returned, minus the noise (screenshot sizes, "navigated to …"). */
function ActionResult({ text, failed }: { text: string; failed?: boolean }) {
  const body = cleanResult(text)
    .replace(/^(Successfully captured )?screenshot[^\n]*$/gim, "")
    .replace(/^zoom: region crop not yet supported[^\n]*$/gim, "")
    .replace(/^(navigated|Navigated) to \S+\s*$/gm, "")
    .replace(/^(waited|Waited for) [^\n]*$/gm, "")
    .trim();
  if (!body) return null;
  if (failed) return <p className="cv-err">{body}</p>;
  const json = parseJson(body);
  if (json !== undefined) return <JsonView value={json} />;
  if (body.length <= 60 && !body.includes("\n")) return <p className="cv-returned">Returned <code>{body}</code></p>;
  return <Clip text={body} max={12} className="cv-plain small" />;
}

function BrowserView({ tool, input, result }: { tool: string; input: Input; result?: Step }) {
  const name = tool.replace(BROWSER, "");
  const batch = name === "browser_batch" && Array.isArray(input.actions);
  const actions: { name: string; input: Input }[] = batch
    ? (input.actions as unknown[]).map((a) => ({ name: String(obj(a).name ?? ""), input: obj(obj(a).input) }))
    : [{ name, input }];
  const text = result?.text ?? "";
  const isError = !!obj(result?.input).isError || /^(navigation to \S+ was denied|Navigation to this domain is not allowed)/i.test(text);
  const parts = batch ? splitBatch(text) : [{ label: name, text, failed: isError || undefined }];
  const lastTab = splitTabContext(text.slice(Math.max(0, text.lastIndexOf("\nTab Context:")))).tab;
  return (
    <>
      <ol className="cv-actions">
        {actions.map((a, i) => {
          const d = describe(a.name, a.input);
          const part = parts[i];
          const { body } = splitTabContext(part?.text ?? "");
          const skipped = batch && !part && parts.some((p) => p?.failed);
          return (
            <li key={i} className={`cv-action${part?.failed ? " failed" : ""}${skipped ? " skipped" : ""}`}>
              <div className="cv-act"><b>{d.verb}</b>{d.detail && <span className="cv-act-detail">{d.detail}</span>}{skipped && <span className="cv-chip">didn't run</span>}</div>
              {d.code && <Clip text={d.code} max={12} className="cv-code small" lang="javascript" />}
              {result && part && <ActionResult text={body} failed={part.failed} />}
            </li>
          );
        })}
      </ol>
      {result && <PageChip tab={lastTab} />}
    </>
  );
}

// ---------- agents and the rest ----------

function AgentView({ input, result }: { input: Input; result?: Step }) {
  const text = cleanResult(result?.text ?? "");
  const launched = /^Async agent launched successfully/.test(text);
  return (
    <>
      <div className="cv-chips">
        {str(input.subagent_type) && <span className="cv-chip">{str(input.subagent_type)}</span>}
        {str(input.model) && <span className="cv-chip">{str(input.model)}</span>}
        {input.run_in_background === true && <span className="cv-chip">in the background</span>}
      </div>
      {str(input.prompt) && <Fold title="Instructions"><div className="cv-md"><Markdown text={str(input.prompt)!} /></div></Fold>}
      {result && (launched ? <p className="cv-muted">Started. Its report arrives later as a message.</p> : <Output text={text} title="Report" />)}
    </>
  );
}

function Fold({ title, children, open: initial = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <section className="cv-block">
      <button className="cv-fold" onClick={() => setOpen(!open)} aria-expanded={open}>
        <svg className="cv-chev" width="10" height="10" viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        {title}
      </button>
      {open && children}
    </section>
  );
}

function MessageView({ input, result }: { input: Input; result?: Step }) {
  const ok = parseJson(result?.text);
  return (
    <>
      {str(input.to) && <p className="cv-why">To <b>{str(input.to)}</b>{str(input.summary) ? `: ${str(input.summary)}` : ""}</p>}
      {str(input.message) && <div className="cv-md cv-letter"><Markdown text={str(input.message)!} /></div>}
      {result && (obj(ok).success === true ? <p className="cv-muted">Delivered.</p> : <Output text={result.text ?? ""} />)}
    </>
  );
}

function QuestionsView({ input, result }: { input: Input; result?: Step }) {
  const qs = Array.isArray(input.questions) ? (input.questions as Input[]) : [];
  return (
    <>
      {qs.map((q, i) => (
        <Block key={i} title={str(q.question)}>
          <ul className="cv-options">{(Array.isArray(q.options) ? (q.options as Input[]) : []).map((o, j) => (
            <li key={j}><b>{str(o.label)}</b>{str(o.description) && <span>{str(o.description)}</span>}</li>
          ))}</ul>
        </Block>
      ))}
      {result && <Output text={result.text ?? ""} title="Answer" />}
    </>
  );
}

function TodosView({ input }: { input: Input }) {
  const todos = Array.isArray(input.todos) ? (input.todos as Input[]) : [];
  return (
    <ul className="cv-todos">{todos.map((t, i) => (
      <li key={i} className={str(t.status)}><span className="box" />{str(t.content) ?? str(t.subject)}</li>
    ))}</ul>
  );
}

/** The body of a tool call: its input and result, shaped by tool. */
export function ToolView({ step, result }: { step: Step; result?: Step }) {
  const tool = step.tool ?? "";
  const input = obj(step.input);
  const resultId = result?.id;
  let body: ReactNode;
  if (tool === "Bash") body = <Terminal input={input} result={result} title={displayLabel(step)} />;
  else if (tool === "Read") body = <ReadView input={input} result={result} />;
  else if (tool === "Grep" || tool === "Glob") body = <SearchFiles input={input} result={result} />;
  else if (tool === "WebSearch") body = <WebSearchView input={input} result={result} />;
  else if (tool === "WebFetch") body = <WebFetchView input={input} result={result} />;
  else if (BROWSER.test(tool)) body = <BrowserView tool={tool} input={input} result={result} />;
  else if (tool === "Agent" || tool === "Task") body = <AgentView input={input} result={result} />;
  else if (tool === "SendMessage" || tool === "SubagentHandback") body = <MessageView input={input} result={result} />;
  else if (tool === "AskUserQuestion") body = <QuestionsView input={input} result={result} />;
  else if (tool === "TodoWrite") body = <TodosView input={input} />;
  else if (tool === "ToolSearch") body = <p className="cv-why">Loaded {String(input.query ?? "").replace(/^select:/, "").split(",").join(", ")}</p>;
  else body = (
    <>
      <Fields input={step.input} />
      {result && <Output text={result.text ?? ""} />}
    </>
  );
  return (
    <div className="cv">
      {body}
      {resultId && SHOT_TOOLS.test(tool) && <Shots resultId={resultId} />}
    </div>
  );
}

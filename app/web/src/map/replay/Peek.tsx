// Owner: peek. A small window over the map with the file the agent is reading or writing at the replay cursor, while you
// follow a thread live or replay it: the change as a diff (a new file as numbered lines), or the part of a file it read.
// It reuses the step panel's renderers (Diff with its styles, editPair, the numbered Code) and hides while that panel is
// open, since it shows the same step in full. Between files (the agent talking, running commands) it keeps the last
// file it touched, quieter and in the past tense ("Edited"), rather than blinking out and back every few moments.
//
// Cheap on purpose: the outer part reads only the open thread and the pref; the body reads the cursor and the thread,
// works out which step to show (a short scan back from the cursor), and the window itself re-renders only when that
// step, its result or "now or before" changes. The diff is computed in the viewer's worker.
import { memo, useDeferredValue, useEffect, useMemo, useRef } from "react";
import type { Step } from "@contract";
import { Diff } from "../../lib/Diff";
import { useLiveSelector } from "../../lib/live";
import { useNavActions, useNavState, useReplayCursor } from "../../lib/nav";
import { repoBase, repoRelative } from "../../lib/paths";
import { THEMES, useTheme } from "../../lib/theme";
import { actionOf, useThread, type Thread } from "../../lib/thread";
import { diffStyles, editPair } from "../../follow/StepDetail";
import { Code, IMAGE, Shots } from "../../follow/content/ToolView";
import { cleanResult, parseNumbered } from "../../follow/content/parse";
import { basename, stepFile } from "../../follow/format";
import { setShowFile, useShowFile } from "../prefs";
import { Icon } from "./ReplayBar";
import "../../follow/follow.css";
import "./peek.css";

const LOOK_BACK = 400;   // beats scanned back from the cursor for the last file touched
const BIG = 240;         // lines (before + after) above which an edit shows its new text instead of a diff

/** The step to show at the cursor: the last edit or read at or before it, and whether it is the cursor's own moment. */
type Moment = { step: Step; result?: Step; now: boolean };

function momentAt(thread: Thread, index: number): Moment | null {
  const beats = thread.beats;
  const at = Math.min(index, beats.length - 1);
  for (let i = at; i >= 0 && i > at - LOOK_BACK; i--) {
    const b = beats[i];
    if (b.action === "other") continue;
    // The beat's own file step: its (last) edit, or its last read.
    let step: Step | undefined;
    for (let j = b.steps.length - 1; j >= 0; j--) if (actionOf(b.steps[j]) === b.action) { step = b.steps[j]; break; }
    if (!step) continue;
    // A read's result: folded into its beat (light detail), or one of the next beats (every step).
    let result: Step | undefined;
    const id = step.toolUseId;
    if (id) {
      result = b.steps.find((s) => s.kind === "tool_result" && s.toolUseId === id);
      for (let k = i + 1; !result && k < beats.length && k <= i + 30; k++) {
        const s = beats[k].steps.find((x) => x.kind === "tool_result" && x.toolUseId === id);
        if (s) result = s;
      }
    }
    // Still its moment while only its own results came after it (every-step detail).
    let now = true;
    for (let k = i + 1; k <= at && now; k++) now = beats[k].step.kind === "tool_result";
    return { step, result, now };
  }
  return null;
}

/** "Editing" now, "Edited" once the agent has moved on. */
function verbOf(step: Step, now: boolean): string {
  if (step.kind !== "edit") return now ? "Reading" : "Read";
  const pair = editPair(step);
  const writes = step.tool === "Write" || (!!pair && !pair.before && !!pair.after);
  return writes ? (now ? "Writing" : "Wrote") : now ? "Editing" : "Edited";
}

/** The folder in quiet text: from the repo root (or a root it had before it moved) when the file is in it, else the
 *  last few folders. */
function folderOf(path: string, roots: string): string {
  let rel: string | null = null;
  for (const root of roots ? roots.split("\n") : []) if ((rel = repoRelative(path, repoBase(root))) !== null) break;
  const dir = (rel ?? path).split("/").slice(0, -1);
  if (rel !== null) return dir.join("/");
  return dir.length > 3 ? `…/${dir.slice(-3).join("/")}` : dir.join("/");
}

const peekStyles = diffStyles;

const lines = (t: string) => (t ? t.split("\n") : []);

/** The body: the change (or the new file), or the part of the file that was read. */
function Body({ step, result }: { step: Step; result?: Step }) {
  // The hook outside find(): called inside it, it ran once per theme until the match, a different number of times per
  // theme, and switching theme broke React's hook order (a blank page).
  const theme = useTheme();
  const dark = THEMES.find((t) => t.id === theme)?.dark ?? false;
  const pair = useMemo(() => (step.kind === "edit" ? editPair(step) : null), [step]);
  if (step.kind === "edit") {
    if (!pair) return <p className="peek-muted">No change recorded for this edit.</p>;
    const big = lines(pair.before).length + lines(pair.after).length > BIG;
    if (!pair.before || big) return <Code key={step.id} start={1} lines={lines(pair.after)} path={step.filePath} />;
    return (
      <div className="sd-diff">
        <Diff oldValue={pair.before} newValue={pair.after} splitView={false} showDiffOnly extraLinesSurroundingDiff={2} hideSummary
          useDarkTheme={dark} styles={peekStyles} path={step.filePath} />
      </div>
    );
  }
  if (!result) return <p className="peek-muted">Reading…</p>;
  const text = cleanResult(result.text ?? "");
  const numbered = parseNumbered(text);
  if (numbered) return <Code key={step.id} start={numbered.start} lines={numbered.lines} path={step.filePath} />;
  if (text) return <Code key={step.id} start={1} lines={lines(text)} path={step.filePath} />;
  // An image or a PDF comes back as a picture for the model, not text: nothing to show here, but it isn't empty.
  if (IMAGE.test(step.filePath ?? "")) return <div className="peek-image"><Shots key={result.id} resultId={result.id} label="Image" path={step.filePath} /></div>;
  return <p className="peek-muted">{/\.pdf$/i.test(step.filePath ?? "") ? "A PDF: open the step to see what was read." : "Empty file."}</p>;
}

/** What a read covered: "Lines 40–120". */
function rangeOf(step: Step, result?: Step): string | null {
  if (step.kind === "edit") {
    const pair = editPair(step);
    if (!pair || !pair.before) return pair ? `${lines(pair.after).length} lines` : null;
    return null;
  }
  const n = result ? parseNumbered(cleanResult(result.text ?? "")) : null;
  if (n) return `Lines ${n.start}–${n.start + n.lines.length - 1}`;
  const i = step.input && typeof step.input === "object" ? (step.input as Record<string, unknown>) : {};
  return Number(i.offset) ? `From line ${Number(i.offset)}` : null;
}

const Window = memo(function Window({ sessionId, step, result, now, roots }: Moment & { sessionId: string; roots: string }) {
  const { openStep } = useNavActions();
  const path = stepFile(step) ?? "";
  const pair = step.kind === "edit" ? editPair(step) : null;
  const stat = pair && pair.before ? { add: lines(pair.after).length, del: lines(pair.before).length } : null;
  const range = rangeOf(step, result);
  const scroll = useRef<HTMLDivElement>(null);

  // A new step: back to the top, then to its first changed line once the diff has drawn (it renders after its worker).
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    el.scrollTop = 0;
    if (step.kind !== "edit") return;
    let done = false;
    const find = () => {
      if (done) return;
      const hit = el.querySelector<HTMLElement>('[class*="-diff-added"], [class*="-diff-removed"]');
      if (!hit) return;
      done = true;
      const top = hit.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTop = Math.max(0, top - 28);
    };
    find();
    const mo = new MutationObserver(find);
    mo.observe(el, { childList: true, subtree: true });
    const stop = setTimeout(() => mo.disconnect(), 1500);
    return () => { done = true; mo.disconnect(); clearTimeout(stop); };
  }, [step]);

  return (
    <section className={`map-peek${now ? "" : " past"}`} aria-label="The file the agent is working on" aria-live="off">
      <header className="peek-head">
        <span className={`peek-verb${step.kind === "edit" ? " edit" : ""}`}>{verbOf(step, now)}</span>
        <button className="peek-file" onClick={() => openStep(sessionId, step.id)} title={`${path}\nOpen this step in full`}>
          <strong>{basename(path)}</strong>
          <span>{folderOf(path, roots)}</span>
        </button>
        {stat ? <span className="peek-stat"><span className="add">+{stat.add}</span><span className="del">−{stat.del}</span></span>
          : range && <span className="peek-stat">{range}</span>}
        <button className="peek-close" onClick={() => setShowFile(false)} aria-label="Hide this window"
          title="Hide. Settings brings it back">{Icon.close}</button>
      </header>
      <div className="peek-body" ref={scroll}>
        <Body step={step} result={result} />
      </div>
    </section>
  );
});

const sameMoment = (a: Moment | null, b: Moment | null) => a === b || (!!a && !!b && a.step === b.step && a.result === b.result && a.now === b.now);

function PeekBody({ sessionId, detail }: { sessionId: string; detail: Thread["detail"] }) {
  const thread = useThread(sessionId, detail);
  const index = useReplayCursor((c) => c.index);
  // The map's root and former roots, as one string so the selector compares by value.
  const roots = useLiveSelector((s) => (s.map ? [s.map.root, ...(s.map.formerRoots ?? [])].join("\n") : ""));
  const found = thread && thread.sessionId === sessionId && thread.beats.length ? momentAt(thread, index) : null;
  // Keep the same object while the moment is the same, so the window (memo) doesn't render again.
  const last = useRef<Moment | null>(null);
  if (!sameMoment(last.current, found)) last.current = found;
  // At 4× the cursor moves several times a second: the window catches up when the browser has a moment.
  const moment = useDeferredValue(last.current);
  if (!moment) return null; // before its first file: the talk card or the map tells the story
  return <Window sessionId={sessionId} roots={roots} {...moment} />;
}

/** Mounted by MapView. Shown while a thread on the map is followed live or replayed, unless turned off in Settings. */
export function Peek() {
  const on = useShowFile();
  const { replay, step, lens } = useNavState();
  if (!on || !replay || step || lens !== "map" || !(replay.live || replay.mode === "play")) return null;
  return <PeekBody sessionId={replay.sessionId} detail={replay.detail} />;
}

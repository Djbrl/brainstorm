// Owned by the lead. A thread in chapters: each message the person typed starts one, and the agent's work up to the
// next message belongs to it. People remember a thread by what they asked, so the step list and the player's
// timeline are cut there. Messages Claude Code puts in the person's place (a subagent handing back, a hook's context,
// a background task finishing) are steps inside a chapter, not chapters.
import type { Step } from "@contract";
import type { Beat, Thread } from "./thread";
import { stripInjected } from "../follow/format";

export type Chapter = {
  index: number;
  /** What the person asked (one line), or a stand-in for work before their first message. */
  title: string;
  first: number;          // first beat index (the prompt's beat when there is one)
  last: number;           // last beat index, inclusive
  hasPrompt: boolean;     // false: the work before the first message
  at: string;             // when it started
  end: string;            // its last step
  ms: number;             // working time (pauses over 30 minutes left out)
  files: number;          // files it changed
  failed: number;         // failed tool calls
};

/** Text Claude Code writes in the person's turn: not something they typed. */
const INJECTED = /^\s*(Another Claude session sent a message|\[SYSTEM NOTIFICATION|<task-notification|<system-reminder|You are operating in a git worktree|This session is being continued|Caveat: The messages below|\[Request interrupted)/i;

export function isPersonPrompt(s: Step): boolean {
  if (s.kind !== "prompt" || s.isSubagent) return false;
  const text = stripInjected(s.text);
  return !!text && !INJECTED.test(s.text ?? "") && !INJECTED.test(text);
}

/** A step written in the person's turn that isn't theirs, named for what it is. */
export function injectedLabel(s: Step): string | undefined {
  if (s.kind !== "prompt" || s.isSubagent || isPersonPrompt(s)) return undefined;
  const t = s.text ?? "";
  if (/Subagent hand-back/i.test(t)) return "A subagent reported back";
  if (/Another Claude session sent a message/i.test(t)) return "A message from another session";
  if (/task-notification|SYSTEM NOTIFICATION/i.test(t)) return "A background task finished";
  if (/git worktree/i.test(t)) return "Started in a git worktree";
  if (/session is being continued/i.test(t)) return "Earlier conversation, summarized";
  return "A note from Claude Code";
}

const oneLine = (t: string, max = 160) => { const l = t.replace(/\s+/g, " ").trim(); return l.length > max ? `${l.slice(0, max - 1).trimEnd()}…` : l; };

const chaptersSeen = new WeakMap<Thread, Chapter[]>();

/** The thread's chapters. Worked out once per thread (the Track and the player's bar both ask): don't change them. */
export function chaptersOf(thread: Thread): Chapter[] {
  let out = chaptersSeen.get(thread);
  if (!out) chaptersSeen.set(thread, (out = cutChapters(thread)));
  return out;
}

function cutChapters(thread: Thread): Chapter[] {
  const out: Chapter[] = [];
  const add = (b: Beat, hasPrompt: boolean) => out.push({
    index: out.length, title: hasPrompt ? oneLine(stripInjected(b.step.text)) : "Before your first message",
    first: b.index, last: b.index, hasPrompt, at: b.step.ts, end: b.step.ts, ms: 0, files: 0, failed: 0,
  });
  // Working time: activeMs over the chapter's steps in beat order, added up as they come.
  let changed = new Set<string>(), prev = 0, first = true;
  const close = () => { if (out.length) out[out.length - 1].files = changed.size; };
  for (const b of thread.beats) {
    const starts = b.kind === "prompt" && isPersonPrompt(b.step);
    if (starts || !out.length) { close(); add(b, starts); changed = new Set(); first = true; }
    const c = out[out.length - 1];
    c.last = b.index;
    c.failed += b.failed;
    const lastStep = b.steps[b.steps.length - 1] ?? b.step;
    if (lastStep.ts > c.end) c.end = lastStep.ts;
    for (const s of b.steps) {
      if (s.kind === "edit" && s.filePath) changed.add(s.filePath);
      const t = stepTime(s);
      if (!first) { const d = t - prev; if (d > 0 && d < BREAK_MS) c.ms += d; }
      prev = t; first = false;
    }
  }
  close();
  return out;
}

/** The chapter holding a beat. */
export const chapterAt = (chapters: Chapter[], beat: number) => chapters.find((c) => beat >= c.first && beat <= c.last) ?? chapters[chapters.length - 1];

export const BREAK_MS = 30 * 60_000;

/** Time spent working, not the span: a thread resumed the next day isn't 30 hours long. Pauses over 30 minutes don't count. */
export function activeMs(steps: { ts: string }[]): number {
  let ms = 0;
  let prev = steps.length ? stepTime(steps[0]) : 0;
  for (let i = 1; i < steps.length; i++) {
    const t = stepTime(steps[i]);
    const d = t - prev;
    if (d > 0 && d < BREAK_MS) ms += d;
    prev = t;
  }
  return ms;
}

/** A step's time in ms (Date.parse), parsed once per step. */
const parsed = new WeakMap<object, { ts: string; ms: number }>();
export function stepTime(s: { ts: string }): number {
  let p = parsed.get(s);
  if (!p || p.ts !== s.ts) parsed.set(s, (p = { ts: s.ts, ms: Date.parse(s.ts) }));
  return p.ms;
}

/** "4 min", "1 h 20 min". */
export function duration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (!Number.isFinite(min) || min < 1) return "under a minute";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`;
}

/** "worked 4 min": active time (activeMs), the one duration the app shows for a thread or a chapter. */
export const worked = (ms: number) => `worked ${duration(ms)}`;

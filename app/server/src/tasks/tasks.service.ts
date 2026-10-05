import { Injectable } from "@nestjs/common";
import { existsSync, statSync } from "node:fs";
import { basename, relative } from "node:path";
import { ListenerService, withoutPastes } from "../listener/listener.service";
import { CallPairer } from "../listener/pairing";
import { CoworkTracker } from "../cowork/classify";
import type { CoworkEvent, Step, TaskArtifact, TaskBeat, TaskDetail, TaskFileKind, TaskFrame, TaskKind, TaskListItem, TaskOutside, TaskSourceFile, TaskSourceSite, TaskStep } from "../types";
import { ShotsService } from "./shots.service";
import { commandFiles, explainFfmpeg, fileKind } from "./commands";
import { commandLabel, toolLabel } from "../shared/labels";

// Owned by the lead. Tells any agent session as a task: the goal, how the agent did it (its own explanations,
// then the calls in plain words), what it made, where it got things, and a filmstrip of its tools' screenshots.

const LIVE_MS = 2 * 60 * 1000;
const SHOT_MISS_MS = 30 * 1000;
const PREVIEW: Set<TaskFileKind> = new Set(["image", "video", "audio", "pdf", "doc", "data"]);
const FAILED = /^\s*(<tool_use_error>|error\b)|was denied or failed|is not allowed|permission_required|timed out after|^\s*exit code [1-9]/i;

/** A step as the step list shows it (web follow/format isVisible): the one step count for a thread, in every view.
 * Tool results belong to their call; empty thinking and empty replies aren't steps. */
const shownStep = (s: Step) => s.kind !== "tool_result" && !(s.kind === "thinking" && !s.text?.trim()) && !(s.kind === "text" && !s.text?.trim() && !s.label);

const short = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

/** A prompt without Claude Code's wrapper tags (slash commands keep their name). */
function cleanPrompt(text: string): string {
  const command = /<command-name>([^<]*)/.exec(text)?.[1]?.trim();
  const args = /<command-args>([^<]*)/.exec(text)?.[1]?.trim();
  if (command) return `${command}${args ? " " + args : ""}`;
  return withoutPastes(text)
    .replace(/<bash-input>([\s\S]*?)(<\/bash-input>|$)/g, "$ $1") // a command run with ! in Claude Code
    .replace(/<(bash-stdout|bash-stderr)>[\s\S]*?(<\/\1>|$)/g, "")
    .replace(/<(local-command-caveat|local-command-stdout|local-command-stderr|system-reminder|command-message|task-notification|bash-notification|user-prompt-submit-hook)>[\s\S]*?(<\/\1>|$)/g, "")
    .replace(/<\/?[a-z_-]+(\s[^>]*)?>/g, "")
    .replace(/^\[Image[:#][^\]]*\]\s*$/gm, "") // Claude Code's note on an image a tool returned, not a request
    .trim();
}

function toolName(tool: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  return mcp ? mcp[2].replace(/_mcp$/, "").replace(/_/g, " ") : tool;
}

@Injectable()
export class TasksService {
  private cache = new Map<string, { key: string; detail: TaskDetail }>();

  /** Shots asked for and not found, by `stepId:idx` → when to look again, so a missing one doesn't rescan the logs on every request. */
  private missedShots = new Map<string, number>();

  constructor(private listener: ListenerService, private shots: ShotsService) {}

  /** A screenshot a tool returned. The step panel asks for them by result step id without opening the task first, so
   * on a miss this reads what's new in that step's session logs (only new bytes) and looks once more. */
  shot(stepId: string, idx: number): { media: string; data: Uint8Array } | undefined {
    const hit = this.shots.get(stepId, idx);
    if (hit) return hit;
    const key = `${stepId}:${idx}`;
    const now = Date.now();
    if ((this.missedShots.get(key) ?? 0) > now) return undefined;
    // A step's screenshots are stored together: if some are here, this one doesn't exist (the step panel probes one past the last).
    const sessionId = this.shots.has(stepId) ? undefined : this.listener.getStep(stepId)?.sessionId;
    if (sessionId) {
      this.shots.scan(sessionId);
      const found = this.shots.get(stepId, idx);
      if (found) { this.missedShots.delete(key); return found; }
    }
    if (this.missedShots.size > 2000) for (const [k, until] of this.missedShots) if (until <= now) this.missedShots.delete(k);
    this.missedShots.set(key, now + SHOT_MISS_MS);
    return undefined;
  }

  list(): TaskListItem[] {
    return this.listener.listSessions().map((s) => {
      const d = this.detail(s.id);
      return d && d.beats.some((b) => b.steps.length) ? { sessionId: d.sessionId, goal: d.goal, startedAt: d.startedAt, lastAt: d.lastAt, live: d.live, kind: d.kind, counts: d.counts } : null;
    }).filter((x): x is TaskListItem => !!x);
  }

  detail(sessionId: string): TaskDetail | undefined {
    const session = this.listener.getSession(sessionId);
    if (!session) return undefined;
    this.shots.scan(sessionId);
    const steps = this.listener.listSteps(sessionId);
    const shots = this.shots.forSession(sessionId);
    const key = `${steps.length}:${[...shots.values()].reduce((a, b) => a + b, 0)}:${Math.floor(Date.now() / LIVE_MS)}`;
    const hit = this.cache.get(sessionId);
    if (hit?.key === key) return hit.detail;
    const detail = this.build(sessionId, session.cwd, session.title, steps, shots);
    this.cache.set(sessionId, { key, detail });
    return detail;
  }

  /** Paths a task may serve previews of: what it made and the files it used. */
  allowedFile(sessionId: string, path: string): TaskFileKind | undefined {
    const d = this.detail(sessionId);
    return d?.made.find((a) => a.path === path)?.kind ?? d?.files.find((f) => f.path === path)?.kind;
  }

  private build(sessionId: string, cwd: string, title: string, steps: Step[], shots: Map<string, number>): TaskDetail {
    const tracker = new CoworkTracker(sessionId);
    const eventsByCall = new Map<string, CoworkEvent[]>();
    const beats: TaskBeat[] = [];
    const frames: TaskFrame[] = [];
    const taskSteps = new Map<string, TaskStep>();
    const made = new Map<string, TaskArtifact>();
    const usedFiles = new Map<string, string>(); // path → via
    const prompts: string[] = [];
    const pairer = new CallPairer();
    const src = (path: string) => `/api/tasks/${encodeURIComponent(sessionId)}/file?path=${encodeURIComponent(path)}`;
    const beat = () => beats[beats.length - 1] ?? (beats.push({ id: "start", ts: steps[0]?.ts ?? "", steps: [] }), beats[0]);
    const rel = (p: string) => (cwd && p.startsWith(cwd + "/") ? relative(cwd, p) : p.replace(/^\/Users\/[^/]+/, "~"));
    const addMade = (path: string, ts: string, via: string, stepId: string) => {
      if (/[$*?`]/.test(path)) return; // a shell variable or glob, not a file name
      const a = made.get(path);
      if (a) { a.edits++; a.lastTs = ts; a.stepId = stepId; a.via = via; return; }
      made.set(path, { path, name: basename(path), kind: fileKind(path), exists: false, firstTs: ts, firstStepId: stepId, lastTs: ts, edits: 1, via, stepId });
    };

    for (const st of steps) {
      if (st.kind === "prompt" && !st.isSubagent) {
        const text = cleanPrompt(st.text ?? "");
        if (!text) continue;
        prompts.push(text);
        beats.push({ id: st.id, ts: st.ts, prompt: text, steps: [] });
        continue;
      }
      if (st.kind === "text" && !st.isSubagent) {
        beats.push({ id: st.id, ts: st.ts, text: st.text ?? "", steps: [] });
        continue;
      }
      if (st.kind === "tool_call" || st.kind === "edit") {
        pairer.call(st);
        const tool = st.tool ?? "";
        const input = (st.input ?? {}) as Record<string, any>;
        let detail: string | undefined;
        let explain: string[] | undefined;
        if (tool === "Bash" && typeof input.command === "string") {
          detail = short(input.command, 400);
          const ex = explainFfmpeg(input.command);
          if (ex.length) explain = ex;
        } else if (st.filePath) detail = rel(st.filePath);
        else if (typeof input.url === "string") detail = input.url;
        else if (typeof input.query === "string") detail = input.query;
        else if (typeof input.pattern === "string") detail = input.pattern;
        // The agent's own one-line description of a command reads best; generic "Run: <command>" labels repeat the detail.
        const own = typeof input.description === "string" && input.description.trim() ? input.description.trim() : undefined;
        const generic = !st.label || /^Run: /.test(st.label);
        const label = own ?? (generic ? (tool === "Bash" ? commandLabel(String(input.command ?? "")) : toolLabel(tool, input)) : st.label!);
        const ts: TaskStep = { id: st.id, ts: st.ts, tool: toolName(tool), label, ...(detail ? { detail } : {}), ...(explain ? { explain } : {}), ...(st.isSubagent ? { subagent: true } : {}) };
        taskSteps.set(st.id, ts);
        beat().steps.push(ts);
        if (st.kind === "edit" && st.filePath) addMade(st.filePath, st.ts, tool, st.id);
        if (tool === "NotebookEdit" && typeof input.notebook_path === "string") addMade(input.notebook_path, st.ts, tool, st.id);
        if (tool === "Read" && st.filePath && fileKind(st.filePath) !== "code") usedFiles.set(st.filePath, "Read");
        continue;
      }
      if (st.kind !== "tool_result") continue;
      const call = pairer.result(st);
      if (!call) continue;
      const failed = !!(st.input as { isError?: boolean } | undefined)?.isError || FAILED.test((st.text ?? "").slice(0, 300));
      const ts = taskSteps.get(call.id);
      if (ts && failed) { ts.failed = true; ts.error = short((st.text ?? "").replace(/<\/?tool_use_error>/g, ""), 500); }
      const events = tracker.handle(call, st);
      if (events.length) {
        eventsByCall.set(call.id, events);
        if (ts) {
          const whats = [...new Set(events.map((e) => e.what))];
          const where = events[events.length - 1];
          ts.label = short(whats.join(" → "), 120);
          ts.detail = where.title && where.title !== where.site ? `${where.site} · ${where.title}` : where.page;
        }
      }
      if (call.tool === "Bash" && !failed) {
        const cmd = String((call.input as { command?: string } | undefined)?.command ?? "");
        const files = commandFiles(cmd, cwd);
        for (const o of files.outputs) addMade(o.path, call.ts, o.via, call.id);
        for (const i of files.inputs) if (!/[$*?`]/.test(i)) usedFiles.set(i, "input");
      }
      const n = shots.get(st.id) ?? 0;
      for (let k = 0; k < n; k++) {
        const ev = eventsByCall.get(call.id);
        const last = ev?.[ev.length - 1];
        if (ts && ts.frame === undefined) ts.frame = frames.length;
        frames.push({
          stepId: st.id, callId: call.id, idx: k, ts: st.ts, beat: Math.max(0, beats.length - 1),
          caption: ts?.label ?? toolName(call.tool ?? ""), ...(last ? { page: last.title && last.title !== last.site ? `${last.site} · ${last.title}` : last.page } : {}),
          src: `/api/tasks/shot/${encodeURIComponent(st.id)}/${k}`,
        });
      }
    }
    for (const call of pairer.pending()) {
      const events = tracker.handle(call, undefined);
      if (events.length) eventsByCall.set(call.id, events);
    }

    // What it made: files that still exist first, newest first.
    const madeList = [...made.values()].map((a) => {
      let bytes: number | undefined;
      let exists = false;
      try { const s = statSync(a.path); exists = s.isFile(); bytes = s.size; } catch { /* gone */ }
      return { ...a, exists, ...(bytes !== undefined ? { bytes } : {}), ...(exists && PREVIEW.has(a.kind) ? { src: src(a.path) } : {}) };
    }).filter((a) => a.exists || a.kind !== "other").sort((a, b) => Number(b.exists) - Number(a.exists) || b.lastTs.localeCompare(a.lastTs)).slice(0, 300);

    const all = [...eventsByCall.values()].flat();
    const outside: TaskOutside[] = all.filter((e) => e.change && !e.failed && e.change.confidence !== "maybe")
      .map((e) => ({ verb: e.change!.verb, what: e.what, site: e.site, ...(e.title ? { title: e.title } : {}), ts: e.ts, stepId: e.stepId, confidence: e.change!.confidence }));

    // Where it got things: websites (pages and searches), then the files it used.
    const sites = new Map<string, TaskSourceSite>();
    for (const e of all) {
      if (e.area !== "web" || e.failed || !(e.action === "visit" || e.action === "read" || e.action === "search")) continue;
      const s = sites.get(e.site) ?? sites.set(e.site, { site: e.site, visits: 0, pages: [], searches: [] }).get(e.site)!;
      s.visits++;
      if (e.page.startsWith("search:")) { const q = e.title ?? e.page.slice(7); if (!s.searches.includes(q)) s.searches.push(q); continue; }
      const p = s.pages.find((x) => x.page === e.page);
      if (p) { p.visits++; if (e.title) p.title = e.title; }
      else s.pages.push({ page: e.page, visits: 1, ...(e.title ? { title: e.title } : {}), url: `https://${e.page}` });
    }
    const web = [...sites.values()].sort((a, b) => b.visits - a.visits);
    for (const s of web) s.pages.sort((a, b) => b.visits - a.visits);
    const files: TaskSourceFile[] = [...usedFiles.keys()].filter((p) => !made.has(p)).slice(0, 100).map((p) => {
      const exists = existsSync(p);
      const kind = fileKind(p);
      return { path: p, name: basename(p), kind, exists, ...(exists && PREVIEW.has(kind) ? { src: src(p) } : {}) };
    });

    const codeMade = madeList.filter((a) => a.kind === "code").length;
    const mediaMade = madeList.filter((a) => a.kind === "image" || a.kind === "video" || a.kind === "audio").length;
    const docsMade = madeList.filter((a) => a.kind === "doc" || a.kind === "pdf").length;
    const webEvents = all.filter((e) => e.area === "web").length;
    const kind: TaskKind = mediaMade ? "media" : webEvents > Math.max(5, codeMade * 3) ? "web" : docsMade > codeMade ? "docs" : codeMade ? "code" : webEvents ? "web" : "mixed";
    const lastAt = steps[steps.length - 1]?.ts ?? "";

    return {
      sessionId, cwd, goal: short(prompts[0] ?? title, 300), prompts,
      startedAt: steps[0]?.ts ?? "", lastAt, live: !!lastAt && Date.now() - Date.parse(lastAt) < LIVE_MS, kind,
      counts: { steps: steps.filter(shownStep).length, frames: frames.length, made: madeList.length, sources: web.reduce((n, s) => n + s.pages.length + s.searches.length, 0) + files.length },
      beats, frames, made: madeList, outside, web, files,
    };
  }
}

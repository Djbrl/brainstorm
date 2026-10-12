// The Markdown export of a thread (Share → Markdown): what was asked, files by module, what failed, step by step.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ProjectMap, Session, Step } from "../shared/contract";
import { threadMarkdown } from "./markdown";

const R = "/work/acme-shop";
const session: Session = { id: "t1", cwd: R, title: "Fix the cart rounding", startedAt: "2026-10-01T09:00:00.000Z", lastEventAt: "2026-10-01T10:25:00.000Z", status: "idle", harness: "claude" };
let n = 0;
const s = (p: Partial<Step>): Step => ({ id: `s${++n}`, sessionId: "t1", seq: n, ts: "2026-10-01T09:00:00.000Z", kind: "text", ...p });
const map: ProjectMap = {
  root: R, edges: [],
  modules: [{ id: "src/cart", summary: "The shopping cart." }, { id: "docs" }],
  files: [
    { path: `${R}/src/cart/total.ts`, module: "src/cart", lines: 40, summary: "Adds up the cart." },
    { path: `${R}/src/cart/round.ts`, module: "src/cart", lines: 12 },
    { path: `${R}/docs/notes.md`, module: "docs", lines: 5 },
  ],
} as ProjectMap;

const steps: Step[] = [
  s({ kind: "edit", tool: "Edit", filePath: `${R}/docs/notes.md` }), // before the first request
  s({ kind: "prompt", text: "Round the cart total to cents" }),
  s({ kind: "prompt", text: "<task-notification>a subagent finished</task-notification>" }), // not a request
  s({ kind: "tool_call", tool: "Read", filePath: `${R}/src/cart/total.ts`, toolUseId: "u1" }),
  s({ kind: "tool_call", tool: "Grep", toolUseId: "u2" }),
  s({ kind: "edit", tool: "Edit", filePath: `${R}/src/cart/total.ts`, label: "Rounds the sum", toolUseId: "u3" }),
  s({ kind: "edit", tool: "Write", filePath: `${R}/src/cart/round.ts`, toolUseId: "u4" }),
  s({ kind: "edit", tool: "Edit", filePath: `${R}/src/cart/total.ts`, toolUseId: "u5" }),
  s({ kind: "tool_call", tool: "Bash", input: { command: "npm test", description: "Run the tests" }, toolUseId: "u6" }),
  s({ kind: "tool_result", toolUseId: "u6", text: "Error: expected 10.01 to equal 10", isError: true }),
  s({ kind: "tool_call", tool: "Task", input: { description: "Check other totals" }, toolUseId: "u7" }),
  s({ kind: "text", text: "a subagent's reply", isSubagent: true }),
  s({ kind: "text", text: "Done: the total is rounded to cents." }),
  s({ kind: "prompt", text: "Thanks" }),
];

test("the report: header, counts, requests, files by module, failures and each request's work", () => {
  const md = threadMarkdown(session, steps, map);
  const has = (line: string) => assert.ok(md.split("\n").includes(line), `missing: ${line}\n\n${md}`);
  has("# Fix the cart rounding");
  assert.match(md, /^Recorded with \[Rundown\]\(https:\/\/[^)]+\) · 1 October 2026, \d\d:\d\d to \d\d:\d\d \(1 h 25\)$/m);
  has("2 requests · 4 edits to 3 files · 1 command · 1 failed tool call · 1 steps by subagents");
  has("1. Round the cart total to cents");
  has("2. Thanks");
  has("### `src/cart`");
  has("The shopping cart.");
  has("- `src/cart/total.ts` · 2 edits · Adds up the cart.");
  has("- `src/cart/round.ts` · 1 edit");
  has("- `docs/notes.md` · 1 edit");
  has("## What failed");
  has("### 1. Before the first request");
  has("### 2. Round the cart total to cents");
  has("- Edited `src/cart/total.ts` · Rounds the sum");
  has("- Wrote `src/cart/round.ts`");
  has("- Ran `npm test` · Run the tests");
  has("- Delegated to a subagent: Check other totals");
  has("- Read or searched 2 times");
  assert.match(md, /^- \*\*Failed:\*\* Bash `npm test`: .*expected 10\.01 to equal 10/m);
  has("> Done: the total is rounded to cents.");
  assert.ok(!md.includes("task-notification") && !md.includes("a subagent's reply"));
  assert.ok(md.indexOf("### `src/cart`") < md.indexOf("### `docs`"), "the module with more files first");
});

test("without a map, paths are relative to the thread's folder and files are 'other files'; an empty thread is short", () => {
  const md = threadMarkdown(session, steps, null);
  assert.ok(md.includes("### `other files`") && md.includes("- `src/cart/round.ts` · 1 edit"), md);
  const empty = threadMarkdown({ ...session, title: "" }, [], null);
  assert.equal(empty.split("\n")[0], "# Untitled thread");
  assert.ok(!empty.includes("## "), empty);
});

test("backticks in a command can't break out of its code span", () => {
  const md = threadMarkdown(session, [s({ kind: "prompt", text: "go" }), s({ kind: "tool_call", tool: "Bash", input: { command: "echo `whoami`" } })], null);
  assert.ok(md.includes("- Ran `echo 'whoami'`"), md);
});

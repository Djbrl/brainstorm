// Checks and times the thread model (lib/thread, lib/paths, lib/chapters, lib/words) on a big synthetic thread.
// It builds today's modules and a reference copy of them from git (REF, default the commit before the perf work), runs
// both on the same 10k-step thread and 20k-file map, and fails if any result differs. Then it times what the app does:
// N components asking for the thread after one new step, and resolver builds per "file" message.
// Run from app/web: `node scripts/perf-thread.mjs` (STEPS=10000 FILES=20000 COMPONENTS=8 REF=<commit> to change).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(WEB, "src");
const REF = process.env.REF ?? "2d1de72";
const STEPS = Number(process.env.STEPS ?? 10_000);
const FILES = Number(process.env.FILES ?? 20_000);
const COMPONENTS = Number(process.env.COMPONENTS ?? 8);
const LIB = ["thread.ts", "paths.ts", "chapters.ts", "words.ts"];

// ---- Build the modules for node: React hooks stay, the live store is a stub (only `clock` is used at module level).
const tmp = realpathSync(mkdtempSync(join(tmpdir(), "perf-thread-")));
const refSrc = join(tmp, "ref", "src");
mkdirSync(join(refSrc, "lib"), { recursive: true });
for (const f of LIB) writeFileSync(join(refSrc, "lib", f), execFileSync("git", ["show", `${REF}:app/web/src/lib/${f}`], { cwd: WEB }));

const stub = {
  name: "stub-live",
  setup(b) {
    b.onResolve({ filter: /(^|\/)live$/ }, () => ({ path: "live", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const clock = () => Date.now(); export const useLive = () => { throw new Error('no store in node'); };", loader: "js" }));
    // The reference copy only holds lib/*: anything else it imports comes from today's src.
    b.onResolve({ filter: /^\.\.?\// }, (a) => {
      if (!a.importer.startsWith(refSrc)) return undefined;
      const p = resolve(a.resolveDir, a.path);
      for (const ext of ["", ".ts", ".tsx"]) if (existsSync(p + ext) && !(p + ext).endsWith("/lib")) return { path: p + ext };
      const real = join(SRC, p.slice(refSrc.length));
      for (const ext of [".ts", ".tsx"]) if (existsSync(real + ext)) return { path: real + ext };
      return undefined;
    });
  },
};
async function bundle(src, out) {
  await build({
    stdin: { contents: LIB.map((f) => `export * as ${f.replace(".ts", "")} from "./lib/${f}";`).join("\n"), resolveDir: src, loader: "ts" },
    bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "error", nodePaths: [join(WEB, "node_modules")],
    alias: { "@contract": join(WEB, "../server/src/types.ts"), "@shared": join(WEB, "../server/src/shared") },
    plugins: [stub],
  });
  return import(pathToFileURL(out).href);
}
const now = await bundle(SRC, join(tmp, "now.mjs"));
const ref = await bundle(refSrc, join(tmp, "ref.mjs"));
rmSync(tmp, { recursive: true, force: true });

// ---- Synthetic data: a seeded random thread and map.
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ROOT = "/r/repo", OLD = "/old/repo";
function makeMap(n = FILES) {
  const files = [];
  for (let i = 0; i < n; i++) files.push({ path: `${ROOT}/m${i % 40}/d${i % 300}/f${i}.ts`, module: `m${i % 40}`, lines: 10 + (i % 500), lastChangedAt: i % 7 ? new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString() : undefined });
  return { root: ROOT, files, edges: [], modules: [], formerRoots: [OLD] };
}
function makeSteps(n = STEPS, map = makeMap(2000)) {
  const steps = [];
  let t = Date.UTC(2026, 9, 1, 8);
  let callId = 0;
  const pending = [];
  const repoFile = () => {
    const f = pick(map.files).path, rel = f.slice(ROOT.length + 1);
    const r = rnd();
    return r < 0.6 ? f : r < 0.75 ? `${ROOT}/.claude/worktrees/w${Math.floor(rnd() * 3)}/${rel}` : r < 0.85 ? `${OLD}/${rel}` : r < 0.92 ? `${ROOT}/missing/${Math.floor(rnd() * 50)}.ts` : `/tmp/scratch/${Math.floor(rnd() * 20)}.md`;
  };
  const sub = () => (rnd() < 0.25 ? { isSubagent: true, agentId: `a${Math.floor(rnd() * 3)}` } : {});
  const push = (s) => {
    const r = rnd();
    t += r < 0.002 ? 3 * 3600_000 : r < 0.01 ? 0 : Math.floor(rnd() * 20_000);
    steps.push({ id: `s${steps.length}`, sessionId: "S", seq: steps.length, ts: new Date(t).toISOString(), ...s });
  };
  const call = (s) => { const id = rnd() < 0.9 ? `tu${callId++}` : undefined; push({ ...s, toolUseId: id }); pending.push({ id, sub: s.isSubagent, write: s.tool === "Write" }); };
  const result = () => {
    const c = pending.splice(rnd() < 0.8 ? 0 : Math.floor(rnd() * pending.length), 1)[0];
    if (!c) return;
    const r = rnd();
    const text = c.write && r < 0.5 ? "File created successfully at: x" : r < 0.06 ? "Error: something broke" : r < 0.09 ? "<tool_use_error>String to replace not found</tool_use_error>" : r < 0.1 ? "Exit code 2" : `ok ${"x".repeat(Math.floor(rnd() * 400))}`;
    push({ kind: "tool_result", text, toolUseId: c.id, ...(c.sub && { isSubagent: true }), ...(rnd() < 0.01 && { input: { isError: true } }) });
  };
  while (steps.length < n) {
    const r = rnd();
    if (pending.length && rnd() < 0.45) { result(); continue; }
    const who = sub();
    if (r < 0.02) push({ kind: "prompt", text: pick(["Fix the login bug please", "Now add tests for it. Make sure they pass.", "<system-reminder>x</system-reminder>", "[Request interrupted by user]", "Another Claude session sent a message: hi", "Subagent hand-back: done", "<task-notification>done</task-notification>"]) });
    else if (r < 0.03) push({ kind: "prompt", text: "Brief for the subagent", isSubagent: true, agentId: "a1" });
    else if (r < 0.15) push({ kind: "text", text: pick(["Done.", "Let me look at the parser first. Then I'll fix the tests.", "I updated a.ts and b.ts to use the new API, which removes the old shim.", "", "Now"]), ...(rnd() < 0.2 && { label: "Explains the plan" }), ...who });
    else if (r < 0.22) push({ kind: "thinking", text: rnd() < 0.3 ? "" : "Hmm, the cache key must include the resolver.", ...who });
    else if (r < 0.42) call({ kind: "tool_call", tool: pick(["Read", "Read", "NotebookRead"]), filePath: repoFile(), ...who });
    else if (r < 0.47) call({ kind: "tool_call", tool: "Read", ...who });
    else if (r < 0.62) call({ kind: "edit", tool: pick(["Edit", "Write", "MultiEdit"]), filePath: repoFile(), diff: { before: "a", after: "b" }, ...who });
    else if (r < 0.75) call({ kind: "tool_call", tool: "Bash", input: { command: "npm test", description: rnd() < 0.5 ? "Run the tests" : undefined }, ...(rnd() < 0.3 && { label: "Run: npm test" }), ...who });
    else if (r < 0.8) call({ kind: "tool_call", tool: pick(["Grep", "Glob", "WebSearch", "ToolSearch"]), input: { pattern: "foo" }, ...who });
    else if (r < 0.83) call({ kind: "tool_call", tool: pick(["Agent", "Task"]), input: { description: "Explore the code" } });
    else if (r < 0.88) call({ kind: "tool_call", tool: pick(["mcp__claude-in-chrome__computer", "mcp__Claude_Browser__navigate", "playwright_click"]), input: {}, ...who });
    else call({ kind: "tool_call", tool: pick(["TodoWrite", "mcp__foo__bar", "Skill"]), input: {}, ...who });
  }
  return steps;
}

// ---- Canonical forms (steps by id, Maps as entries) for deep comparison.
const ids = (l) => l.map((s) => s.id);
const canonBeat = (b) => ({ ...b, step: b.step.id, steps: ids(b.steps) });
const canonThread = (t) => t && ({ ...t, beats: t.beats.map(canonBeat), touched: [...t.touched], stepBeat: [...t.stepBeat] });
const sameThread = (a, b, msg) => assert.deepStrictEqual(canonThread(a), canonThread(b), msg);

const map = makeMap();
const steps = makeSteps(STEPS, map);
const queries = [...steps.filter((s) => s.filePath).map((s) => s.filePath), undefined, "", ROOT, `${ROOT}/`, `${ROOT}/.claude/worktrees/x`, "/elsewhere/a.ts", ...map.files.slice(0, 500).map((f) => f.path)];
const ms = (f, n = 1) => { const t0 = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - t0) / n; };
const fmt = (x) => `${x.toFixed(2)} ms`;
let checks = 0;

if (process.env.PROFILE) {
  const r = now.paths.makeFileResolver(map);
  for (let k = 0; k < 3; k++) console.log("build", ms(() => now.thread.buildThread("S", steps.slice(), r), 5).toFixed(2));
  const memo = new Map(); const rm = (a) => { if (!memo.has(a)) memo.set(a, r(a)); return memo.get(a); };
  for (let k = 0; k < 3; k++) console.log("build memo-resolver", ms(() => now.thread.buildThread("S", steps.slice(), rm), 5).toFixed(2));
  console.log("resolver build", ms(() => now.paths.makeFileResolver({ ...map, files: map.files.slice() }), 5).toFixed(2));
  console.log("chapters", ms(() => now.chapters.chaptersOf(now.thread.buildThread("S", steps, r)), 5).toFixed(2));
  console.log("numbers", ms(() => now.words.threadNumbers(steps, map), 5).toFixed(2));
  process.exit(0);
}
// ---- 1. Identical results.
{
  const rRef = ref.paths.makeFileResolver(map), rNow = now.paths.makeFileResolver(map);
  for (const q of queries) assert.equal(rNow(q), rRef(q), `resolver: ${q}`);
  assert.equal(now.paths.makeFileResolver(null)("/x"), null);
  checks++;
  for (const detail of ["light", "full"]) {
    const a = ref.thread.buildThread("S", steps, rRef, detail), b = now.thread.buildThread("S", steps, rNow, detail);
    sameThread(b, a, `thread ${detail}`);
    assert.deepStrictEqual(now.chapters.chaptersOf(b), ref.chapters.chaptersOf(a), `chapters ${detail}`);
    checks += 2;
  }
  for (const m of [map, null]) assert.deepStrictEqual(now.words.threadNumbers(steps, m), ref.words.threadNumbers(steps, m)), checks++;
  assert.equal(now.chapters.activeMs(steps), ref.chapters.activeMs(steps)); checks++;
  assert.equal(now.chapters.activeMs([{ ts: "x" }, { ts: "2026-01-01T00:00:00Z" }]), ref.chapters.activeMs([{ ts: "x" }, { ts: "2026-01-01T00:00:00Z" }])); checks++;
}

// ---- 2. Growing live thread: every prefix, one new step at a time (as the store appends), equals a fresh build.
{
  const small = makeSteps(1500, makeMap(300));
  const smallMap = makeMap(300);
  for (const detail of ["light", "full"]) {
    let list = [];
    const rNow = now.paths.makeFileResolver(smallMap), rRef = ref.paths.makeFileResolver(smallMap);
    let prev = null;
    for (const s of small) {
      list = [...list, s];
      const b = now.thread.buildThread("S", list, rNow, detail);
      const a = ref.thread.buildThread("S", list, rRef, detail);
      sameThread(b, a, `prefix ${list.length} ${detail}`);
      if (prev) assert.notEqual(b, prev, "a new steps array gives a new thread");
      // The previous thread is left as it was (React may still hold it).
      if (prev) sameThread(prev, ref.thread.buildThread("S", list.slice(0, -1), rRef, detail), `previous thread kept at ${list.length - 1}`);
      assert.deepStrictEqual(now.chapters.chaptersOf(b), ref.chapters.chaptersOf(a), `chapters prefix ${list.length}`);
      if (detail === "light") assert.deepStrictEqual(now.words.threadNumbers(list, smallMap), ref.words.threadNumbers(list, smallMap), `numbers prefix ${list.length}`);
      prev = b;
      checks += 4;
    }
    // The reader labels steps after they arrive (a "step-update": one step replaced by a copy with a label). Every
    // step in turn, then two at once with a new step on top (React can batch both into one render).
    for (let i = 0; i < small.length; i++) {
      const label = pick(["Relabelled: the parser now handles empty input", "", "Done", undefined]);
      list = list.map((x, j) => (j === i ? { ...x, label, risk: ["touches auth"] } : x));
      sameThread(now.thread.buildThread("S", list, rNow, detail), ref.thread.buildThread("S", list, rRef, detail), `relabel ${i} ${detail}`);
      if (detail === "light") assert.deepStrictEqual(now.words.threadNumbers(list, smallMap), ref.words.threadNumbers(list, smallMap), `numbers relabel ${i}`), checks++;
      checks++;
    }
    list = [...list.map((x, j) => (j === 3 || j === 1200 ? { ...x, label: "Both at once" } : x)), { ...small[10], id: "extra", toolUseId: undefined }];
    sameThread(now.thread.buildThread("S", list, rNow, detail), ref.thread.buildThread("S", list, rRef, detail), `relabel and append ${detail}`);
    // A change the builder can't follow (a step's text changed): it starts again.
    list = list.map((x, j) => (j === 700 ? { ...x, text: "Changed text. It says something else now." } : x));
    sameThread(now.thread.buildThread("S", list, rNow, detail), ref.thread.buildThread("S", list, rRef, detail), `text change ${detail}`);
    checks += 2;
  }
  // Odd edits to the list: a step-update (same length, one step replaced), a reset (shorter), a jump (many new steps).
  const r = now.paths.makeFileResolver(map), rr = ref.paths.makeFileResolver(map);
  let list = steps.slice(0, 5000);
  now.thread.buildThread("S", list, r);
  const variants = [
    list.map((x, i) => (i === 4990 ? { ...x, label: "Relabelled" } : x)),
    steps.slice(0, 4000),
    steps.slice(0, 9000),
    [...steps.slice(0, 9000), { ...steps[9000], id: "new" }],
  ];
  now.words.threadNumbers(list, map);
  for (const v of variants) {
    now.thread.buildThread("S", v, r); sameThread(now.thread.buildThread("S", v, r), ref.thread.buildThread("S", v, rr), "variant");
    assert.deepStrictEqual(now.words.threadNumbers(v, map), ref.words.threadNumbers(v, map), "numbers variant");
    checks += 2;
  }
}

// ---- 3. Timings.
console.log(`\n${STEPS.toLocaleString()} steps, ${FILES.toLocaleString()} files, ${COMPONENTS} components (reference ${REF})\n`);
const row = (what, before, after) => console.log(`${what.padEnd(58)} ${fmt(before).padStart(11)} → ${fmt(after).padStart(10)}  (${(before / after).toFixed(1)}×)`);

// A "file" message: the store makes a new map (same paths, one file's fields changed). Every useThread (and the map) memo
// on state.map rebuilds its resolver.
{
  const bump = (m, i) => ({ ...m, files: m.files.map((f, j) => (j === i ? { ...f, lastChangedAt: new Date().toISOString() } : f)) });
  let m = map;
  const before = ms(() => { m = bump(m, 7); for (let c = 0; c < COMPONENTS; c++) ref.paths.makeFileResolver(m); }, 10);
  m = map; now.paths.makeFileResolver(m);
  let built = 0;
  const after = ms(() => { m = bump(m, 7); const first = now.paths.makeFileResolver(m); for (let c = 1; c < COMPONENTS; c++) if (now.paths.makeFileResolver(m) !== first) built++; }, 10);
  row(`"file" message: ${COMPONENTS} resolvers over ${FILES.toLocaleString()} files`, before, after);
  console.log(`${"".padEnd(4)}resolver builds per file message: before ${COMPONENTS}, after ${built / 10} (the same resolver comes back)`);
  m = { ...map, files: [...map.files, { path: `${ROOT}/new.ts`, module: "m", lines: 1 }] };
  assert.notEqual(now.paths.makeFileResolver(m), now.paths.makeFileResolver(map), "a new file builds a new resolver");
  assert.equal(now.paths.makeFileResolver(m)(`${ROOT}/new.ts`), `${ROOT}/new.ts`);
  const v = { ...map, files: map.files.slice() };
  assert.equal(now.paths.makeFileResolver(v, 3), now.paths.makeFileResolver({ ...v }, 3), "same structureVersion: same resolver");
  checks += 3;
}

// One new step on a live thread. Every useThread memo (COMPONENTS of them) sees new steps and builds (before) or shares
// one build (after); the Track and the bar cut chapters, the stats line and the counts work out the thread's numbers.
{
  const rRef = ref.paths.makeFileResolver(map), rNow = now.paths.makeFileResolver(map);
  const app = (lib, r, l) => {
    let t;
    for (let c = 0; c < COMPONENTS; c++) t = lib.thread.buildThread("S", l, r, "light");
    lib.chapters.chaptersOf(t); lib.chapters.chaptersOf(t);
    lib.words.threadNumbers(l, map); lib.words.threadNumbers(l, map);
  };
  const piece = (lib, r, l, what) => {
    const t0 = performance.now(); const t = lib.thread.buildThread("S", l, r, "light"); const t1 = performance.now();
    lib.chapters.chaptersOf(t); const t2 = performance.now();
    lib.words.threadNumbers(l, map); const t3 = performance.now();
    what.build += t1 - t0; what.chapters += t2 - t1; what.numbers += t3 - t2;
  };
  const N = 50;
  let i = STEPS - N - 1, list = steps.slice(0, i);
  const before = ms(() => app(ref, rRef, (list = [...list, steps[i++]])), N);
  i = STEPS - N - 1; list = steps.slice(0, i); app(now, rNow, list);
  const after = ms(() => app(now, rNow, (list = [...list, steps[i++]])), N);
  row(`one new step: ${COMPONENTS} views get the thread, chapters, numbers`, before, after);
  const pb = { build: 0, chapters: 0, numbers: 0 }, pa = { build: 0, chapters: 0, numbers: 0 };
  i = STEPS - N - 1; list = steps.slice(0, i);
  for (let k = 0; k < N; k++) piece(ref, rRef, (list = [...list, steps[i++]]), pb);
  i = STEPS - N - 1; list = steps.slice(0, i); piece(now, rNow, list, { build: 0, chapters: 0, numbers: 0 });
  for (let k = 0; k < N; k++) piece(now, rNow, (list = [...list, steps[i++]]), pa);
  for (const k of ["build", "chapters", "numbers"]) row(`${"".padEnd(4)}of which, once: ${k}`, pb[k] / N, pa[k] / N);
  // The reader labels the newest step: same length, one step replaced.
  list = steps.slice(); now.thread.buildThread("S", list, rNow);
  let j = STEPS - N;
  const relRef = ms(() => { const l = steps.map((x, q) => (q === j ? { ...x, label: "A label" } : x)); for (let c = 0; c < COMPONENTS; c++) ref.thread.buildThread("S", l, rRef, "light"); j++; }, 10);
  j = STEPS - N;
  const relNow = ms(() => { const l = list.map((x, q) => (q === j ? { ...x, label: "A label" } : x)); list = l; for (let c = 0; c < COMPONENTS; c++) now.thread.buildThread("S", l, rNow, "light"); j++; }, 10);
  row(`a step relabelled: ${COMPONENTS} views get the thread`, relRef, relNow);
  // A thread opens: nothing to reuse (another session, so a builder of its own).
  let k = 0;
  const cold = ms(() => now.thread.buildThread(`cold${k++}`, steps.slice(), rNow, "light"), 5);
  const coldRef = ms(() => ref.thread.buildThread("S", steps.slice(), rRef, "light"), 5);
  row(`a thread opens: one full build, light`, coldRef, cold);
}
console.log(`\n${checks} checks passed: same threads, chapters, numbers and file matches as ${REF}.`);

// Mapper tests: the shared ignore rule, the file selection past the cap, batching, the git readers, and live updates
// end to end on a temporary repo. Run: cd app/server && npx tsc -p . && node --test dist/mapper/
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { isIgnoredDirName, isInIgnoredDir, isMappableRel, moduleOf } from "./ignore";
import { rankScale, scoreFrom, selectFiles } from "./select";
import { Batcher, foldersToWatch } from "./watch";
import { GitLogParser } from "./git-times";
import { listProjectFiles, listProjectFilesSync, parseLsFiles } from "./list-files";
import { MapperService } from "./mapper.service";
import type { WsMessage } from "../types";

Logger.overrideLogger(false);

const hasGit = (() => { try { execFileSync("git", ["--version"], { stdio: "ignore" }); return true; } catch { return false; } })();

function tempRepo(files: Record<string, string>, git = true): string {
  const root = mkdtempSync(join(tmpdir(), "bs-mapper-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  if (git) {
    const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    g("init", "-q");
    g("add", "-A");
    g("commit", "-q", "-m", "init");
  }
  return root;
}

// ---- ignore rule ----

test("ignored folders: dot folders, dependencies, build output, caches", () => {
  for (const d of [".git", ".idea", ".venv", ".next", ".gradle", ".svelte-kit", ".nuxt", ".yarn", ".pnpm-store", ".mypy_cache", ".pytest_cache", ".tox",
    "node_modules", "vendor", "target", "Pods", "DerivedData", "tmp", "dist", "build", "__pycache__", "foo.egg-info"]) {
    assert.equal(isIgnoredDirName(d), true, d);
  }
  for (const d of ["src", "app", "packages", "lib", "test"]) assert.equal(isIgnoredDirName(d), false, d);
});

test("mappable files: source extensions outside ignored folders, no lockfiles", () => {
  assert.equal(isMappableRel("src/a.ts"), true);
  assert.equal(isMappableRel("README.md"), true);
  assert.equal(isMappableRel(".eslintrc.json"), true); // a dot file is fine, a dot folder isn't
  assert.equal(isMappableRel("src\\win\\b.tsx"), true);
  assert.equal(isMappableRel("node_modules/x/index.js"), false);
  assert.equal(isMappableRel("packages/a/node_modules/x/index.js"), false);
  assert.equal(isMappableRel(".idea/workspace.json"), false);
  assert.equal(isMappableRel("target\\debug\\build.rs"), false);
  assert.equal(isMappableRel("package-lock.json"), false);
  assert.equal(isMappableRel("src/logo.png"), false);
  assert.equal(isMappableRel("../outside.ts"), false);
});

test("watcher events: ignored folders are dropped by path alone", () => {
  assert.equal(isInIgnoredDir("node_modules"), true);
  assert.equal(isInIgnoredDir("node_modules/react/index.js"), true);
  assert.equal(isInIgnoredDir(".git/index.lock"), true);
  assert.equal(isInIgnoredDir("src/.cache"), true);
  assert.equal(isInIgnoredDir("src"), false);
  assert.equal(isInIgnoredDir("src/a.ts"), false);
  assert.equal(isInIgnoredDir(".eslintrc.json"), false);
});

test("modules are the first two folders", () => {
  assert.equal(moduleOf("a.ts"), ".");
  assert.equal(moduleOf("src/a.ts"), "src");
  assert.equal(moduleOf("packages/web/src/a.ts"), "packages/web");
  assert.equal(moduleOf("packages\\web\\src\\a.ts"), "packages/web");
});

// ---- selection past the cap ----

test("selection: everything up to the cap, in the given order", () => {
  const rels = ["b.ts", "a.ts", "src/c.ts"];
  assert.deepEqual(selectFiles(rels, 3), rels);
});

test("selection past the cap: every top-level folder shows, then a share per module, then the best files", () => {
  const rels = [
    ...[1, 2, 3, 4, 5, 6].map((i) => `web/src/x${i}.ts`),
    ...[1, 2, 3].map((i) => `api/src/y${i}.ts`),
    "docs/z1.md", "README.md",
  ];
  const score: Record<string, number> = { "api/src/y1.ts": 5 };
  for (let i = 1; i <= 6; i++) score[`web/src/x${i}.ts`] = 9 + i;
  const picked = selectFiles(rels, 6, (r) => score[r] ?? 0);
  // web, api, docs and the root each keep their best file; the room left goes to the most recent ones
  assert.deepEqual(new Set(picked), new Set(["web/src/x6.ts", "api/src/y1.ts", "docs/z1.md", "README.md", "web/src/x5.ts", "web/src/x4.ts"]));
  // a bigger cap shares half of it evenly: api gets more than its single best file
  const wider = selectFiles([...rels, ...[7, 8, 9, 10, 11, 12, 13, 14].map((i) => `web/src/x${i}.ts`)], 12, (r) => score[r] ?? 0);
  assert.ok(wider.filter((r) => r.startsWith("api/")).length >= 2, wider.join(" "));
});

test("scores: an agent's files first, then recency, imports and size, each by rank", () => {
  assert.deepEqual([...rankScale(new Map([["a", 5], ["b", 10], ["c", 0]]))], [["a", 0], ["b", 1]]);
  const rels = ["m/1.ts", "m/2.ts", "m/3.ts", "m/4.ts"];
  const touchedWins = selectFiles(rels, 2, scoreFrom({ touched: new Set(["m/1.ts"]), changedAt: new Map([["m/1.ts", 1], ["m/4.ts", 9], ["m/3.ts", 5]]) }));
  assert.deepEqual(touchedWins, ["m/1.ts", "m/4.ts"]);
  const centralWins = selectFiles(rels, 1, scoreFrom({ importedBy: new Map([["m/3.ts", 7], ["m/2.ts", 1]]) }));
  assert.deepEqual(centralWins, ["m/3.ts"]);
});

// ---- batching ----

test("batcher: one flush for everything that arrives within the delay", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const flushed: string[][] = [];
    const b = new Batcher<string>(100, (items) => flushed.push([...items]));
    b.add("a"); b.add("b"); b.add("a");
    mock.timers.tick(99);
    assert.equal(flushed.length, 0);
    b.add("c");
    mock.timers.tick(1);
    assert.deepEqual(flushed, [["a", "b", "c"]]); // at most 100 ms after the first item, not after the last
    b.add("d");
    mock.timers.tick(100);
    assert.deepEqual(flushed, [["a", "b", "c"], ["d"]]);
    b.add("e"); b.cancel();
    mock.timers.tick(200);
    assert.equal(flushed.length, 2);
  } finally { mock.timers.reset(); }
});

test("folders to watch: each file's folder and every folder up to the root", () => {
  const root = join("/r");
  const dirs = foldersToWatch(root, [join(root, "a", "b", "x.ts"), join(root, "a", "y.ts"), join(root, "z.ts")]);
  assert.deepEqual([...dirs].sort(), [root, join(root, "a"), join(root, "a", "b")].sort());
});

// ---- git readers ----

test("git log parser: newest time per wanted path, done once all are found", () => {
  const p = new GitLogParser(new Set(["a.ts", "b.ts"]));
  for (const l of ["\u0001300", "a.ts", "other.ts", "", "\u0001200", "a.ts"]) p.line(l);
  assert.equal(p.done, false);
  p.line("b.ts");
  assert.equal(p.done, true);
  assert.deepEqual([...p.times], [["a.ts", 300], ["b.ts", 200]]);
  assert.equal(p.commits, 2);
});

test("ls-files parsing: mappable paths only, tracked vs new", () => {
  const acc = { rels: [] as string[], tracked: new Set<string>(), total: 0 };
  parseLsFiles(["H src/a.ts", "? src/new.ts", "H node_modules/x.js", "H logo.png", "H yarn.lock"], acc);
  assert.deepEqual(acc.rels, ["src/a.ts", "src/new.ts"]);
  assert.deepEqual([...acc.tracked], ["src/a.ts"]);
});

test("listing a git repo follows .gitignore and the shared rule; a plain folder is walked the same way", { skip: !hasGit }, async () => {
  const files = {
    ".gitignore": "generated/\n",
    "src/a.ts": "import './b';", "src/b.ts": "", ".eslintrc.json": "{}",
    "generated/out.ts": "", "target/debug/x.js": "", ".idea/w.json": "{}", "vendor/lib.js": "",
  };
  const root = tempRepo(files);
  try {
    writeFileSync(join(root, "src", "untracked.ts"), "");
    const l = await listProjectFiles(root, 800);
    assert.equal(l.source, "git");
    assert.deepEqual(l.rels, [".eslintrc.json", "src/a.ts", "src/b.ts", "src/untracked.ts"]);
    assert.deepEqual([...(l.tracked ?? [])].sort(), [".eslintrc.json", "src/a.ts", "src/b.ts"]);
    assert.equal(l.changedAt, undefined); // under the cap: no ranking needed
    assert.deepEqual(listProjectFilesSync(root, 800).rels, l.rels);
  } finally { rmSync(root, { recursive: true, force: true }); }

  const plain = tempRepo(files, false);
  try {
    const l = await listProjectFiles(plain, 800);
    assert.equal(l.source, "walk");
    // no git: .gitignore can't apply, but the shared folder rule does
    assert.deepEqual(l.rels, [".eslintrc.json", "generated/out.ts", "src/a.ts", "src/b.ts"]);
  } finally { rmSync(plain, { recursive: true, force: true }); }
});

const gitEnv = (date?: string) => ({ ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) });

test("past the cap, the listing says when files last changed (recent commits; new files by modification time)", { skip: !hasGit }, async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 5; i++) { files[`pkg/cold/f${i}.ts`] = ""; files[`pkg/warm/f${i}.ts`] = ""; }
  const root = tempRepo(files);
  try {
    appendFileSync(join(root, "pkg/warm/f1.ts"), "// edit\n");
    execFileSync("git", ["-C", root, "commit", "-q", "-am", "warm"], { stdio: "ignore", env: gitEnv("2030-01-01T00:00:00") });
    writeFileSync(join(root, "pkg/cold/new.ts"), "");
    const l = await listProjectFiles(root, 5);
    assert.equal(l.total, 11);
    assert.equal(l.recent?.get("pkg/warm/f1.ts"), Date.parse("2030-01-01T00:00:00") / 1000);
    assert.ok((l.changedAt?.get("pkg/cold/new.ts") ?? 0) > 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("past the cap (RUNDOWN_MAX_FILES): a spread of files, totalFiles counts them all, an agent's edit joins anyway", { skip: !hasGit }, async () => {
  const files: Record<string, string> = { "README.md": "# r\n", "docs/guide.md": "# g\n" };
  for (let i = 0; i < 12; i++) files[`web/src/c${i}.ts`] = i ? "import { c } from './c0';\n" : "export const c = 0;\n";
  for (let i = 0; i < 6; i++) files[`api/src/r${i}.ts`] = "";
  const root = tempRepo(files);
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const handlers: Record<string, (p: unknown) => void> = {};
  const sent: WsMessage[] = [];
  const before = process.env.RUNDOWN_MAX_FILES;
  process.env.RUNDOWN_MAX_FILES = "8";
  const svc = new MapperService(
    { on: (ev: string, fn: (p: unknown) => void) => { handlers[ev] = fn; }, emit() {} } as never,
    { broadcast: (m: WsMessage) => sent.push(m) } as never,
    { defaultRoot: root, claudeProjectsDir: projects } as never,
  );
  try {
    svc.onModuleInit();
    const map = await svc.getMapAsync(root);
    const rels = map.files.map((f) => f.path.slice(root.length + 1));
    assert.equal(map.files.length, 8);
    assert.equal(map.totalFiles, 20);
    for (const top of ["web/", "api/", "docs/", "README.md"]) assert.ok(rels.some((r) => r.startsWith(top)), `${top} missing from ${rels.join(" ")}`);
    assert.ok(rels.includes("web/src/c0.ts"), "the file everything imports is kept");
    await new Promise((r) => setTimeout(r, 300));

    // A file the cap left out changes: it stays off the map. An agent edits one: it joins.
    const left = Object.keys(files).find((f) => !rels.includes(f) && f.startsWith("api/"))!;
    appendFileSync(join(root, left), "// changed by a checkout\n");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(svc.getCached(root)!.byPath.has(join(root, left)), false);
    handlers["file-touched"]({ path: join(root, left), sessionId: "s1", ts: new Date().toISOString() });
    appendFileSync(join(root, left), "// edited by an agent\n");
    const node = await waitFor(() => svc.getCached(root)!.byPath.get(join(root, left)));
    await waitFor(() => node.activeSessionId === "s1" || undefined);
    assert.equal(svc.getCached(root)!.map.totalFiles, 20);
  } finally {
    if (before === undefined) delete process.env.RUNDOWN_MAX_FILES; else process.env.RUNDOWN_MAX_FILES = before;
    svc.onModuleDestroy();
    rmSync(root, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  }
});

// ---- live updates, end to end ----

async function waitFor<T>(fn: () => T | undefined, ms = 10_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined && v !== false) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("live: changes are batched, imports re-resolve once, new and deleted files follow, the cap holds", async () => {
  const files: Record<string, string> = { "src/a.ts": "import { b } from './b';\n", "src/b.ts": "export const b = 1;\n" };
  for (let i = 0; i < 120; i++) files[`src/many/m${i}.ts`] = `export const m = ${i};\n`;
  const root = tempRepo(files, hasGit);
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const sent: WsMessage[] = [];
  const svc = new MapperService(
    { on() {}, emit() {} } as never,
    { broadcast: (m: WsMessage) => sent.push(m) } as never,
    { defaultRoot: root, claudeProjectsDir: projects } as never,
  );
  try {
    svc.onModuleInit();
    const map = await svc.getMapAsync(root);
    assert.equal(map.files.length, 122);
    assert.equal(map.totalFiles, 122);
    assert.deepEqual(map.edges, [{ from: join(root, "src/a.ts"), to: join(root, "src/b.ts") }]);
    await new Promise((r) => setTimeout(r, 300)); // the watch starts right after the first build

    // Two quick edits: one batch, a "file" message each, with their imports.
    sent.length = 0;
    writeFileSync(join(root, "src/b.ts"), "import { a } from './a';\nexport const b = 2;\n");
    appendFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
    await waitFor(() => sent.filter((m) => m.type === "file").length >= 2 || undefined);
    await new Promise((r) => setTimeout(r, 300));
    const fileMsgs = sent.filter((m): m is Extract<WsMessage, { type: "file" }> => m.type === "file");
    assert.deepEqual(new Set(fileMsgs.map((m) => m.file.path)), new Set([join(root, "src/a.ts"), join(root, "src/b.ts")]));
    assert.deepEqual(fileMsgs.find((m) => m.file.path === join(root, "src/b.ts"))?.edges, [{ from: join(root, "src/b.ts"), to: join(root, "src/a.ts") }]);
    assert.equal(svc.getCached(root)!.map.edges.length, 2);

    // A new file in a new folder joins the map, and an existing import can now resolve to it.
    sent.length = 0;
    mkdirSync(join(root, "src/c"));
    writeFileSync(join(root, "src/c/index.ts"), "export const c = 1;\n");
    writeFileSync(join(root, "src/a.ts"), "import { b } from './b';\nimport { c } from './c';\n");
    await waitFor(() => svc.getCached(root)!.byPath.has(join(root, "src/c/index.ts")) || undefined);
    await waitFor(() => svc.getCached(root)!.map.edges.some((e) => e.to === join(root, "src/c/index.ts")) || undefined);

    // Deleting it sends file-removed and drops the import line.
    sent.length = 0;
    unlinkSync(join(root, "src/c/index.ts"));
    await waitFor(() => sent.some((m) => m.type === "file-removed" && m.path === join(root, "src/c/index.ts")) || undefined);
    assert.equal(svc.getCached(root)!.map.edges.some((e) => e.to === join(root, "src/c/index.ts")), false);

    // A burst (a branch switch): a few "map" messages, not one message per file.
    sent.length = 0;
    for (let i = 0; i < 120; i++) appendFileSync(join(root, `src/many/m${i}.ts`), "// burst\n");
    await waitFor(() => sent.some((m) => m.type === "map") || undefined);
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(sent.filter((m) => m.type === "map").length <= 3, `${sent.filter((m) => m.type === "map").length} map messages`);
    assert.ok(sent.filter((m) => m.type === "file").length < 50, `${sent.filter((m) => m.type === "file").length} file messages`);

    // Ignored folders never reach the map.
    mkdirSync(join(root, "node_modules/x"), { recursive: true });
    writeFileSync(join(root, "node_modules/x/index.js"), "");
    mkdirSync(join(root, ".cache"));
    writeFileSync(join(root, ".cache/y.json"), "{}");
    await new Promise((r) => setTimeout(r, 400));
    assert.equal([...svc.getCached(root)!.byPath.keys()].some((p) => p.includes("node_modules") || p.includes(".cache")), false);
  } finally {
    svc.onModuleDestroy();
    rmSync(root, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  }
});

test("the map cache keeps a bounded number of roots", async () => {
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const roots = Array.from({ length: 6 }, (_, i) => tempRepo({ [`f${i}.ts`]: "" }, false));
  const svc = new MapperService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { defaultRoot: roots[0], claudeProjectsDir: projects } as never);
  try {
    for (const r of roots) svc.getMap(r);
    const kept = roots.filter((r) => svc.getCached(r));
    assert.ok(kept.length <= 4, `${kept.length} roots kept`);
    assert.ok(svc.getCached(roots[5]));
  } finally {
    svc.onModuleDestroy();
    for (const r of roots) rmSync(r, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  }
});

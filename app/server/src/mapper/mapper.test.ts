// Mapper tests: the shared ignore rule, the file selection past the cap, batching, the git readers, and live updates
// end to end on a temporary repo. Run: cd app/server && npx tsc -p . && node --test dist/mapper/
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { isIgnoredDirName, isInIgnoredDir, isMappableRel, moduleOf } from "./ignore";
import { rankScale, scoreFrom, selectFiles } from "./select";
import { Batcher, foldersToWatch } from "./watch";
import { GitLogParser } from "./git-times";
import { listProjectFiles, parseLsFiles } from "./list-files";
import { MapperService, jsImports } from "./mapper.service";
import { MAX_COUNT_BYTES, readMapped } from "./read-file";
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
  assert.equal(isMappableRel("src/vite.config.mts"), true); // ES module and CommonJS TypeScript
  assert.equal(isMappableRel("src/b.cts"), true);
  assert.equal(isMappableRel(".eslintrc.json"), true); // a dot file is fine, a dot folder isn't
  assert.equal(isMappableRel("src\\win\\b.tsx"), true);
  assert.equal(isMappableRel("node_modules/x/index.js"), false);
  assert.equal(isMappableRel("packages/a/node_modules/x/index.js"), false);
  assert.equal(isMappableRel(".idea/workspace.json"), false);
  assert.equal(isMappableRel("target\\debug\\build.rs"), false);
  assert.equal(isMappableRel("package-lock.json"), false);
  assert.equal(isMappableRel("src/logo.png"), false);
  assert.equal(isMappableRel("app.vue"), true);
  assert.equal(isMappableRel("Sources/App/ContentView.swift"), true);
  for (const f of ["Dockerfile", "docker/Dockerfile.dev", "Makefile", "CMakeLists.txt", "src/a.cxx", "include/a.hh", "Cargo.toml", "docker-compose.yml", "kernels/add.cu"]) assert.equal(isMappableRel(f), true, f);
  assert.equal(isMappableRel("pnpm-lock.yaml"), false);
  assert.equal(isMappableRel("notes.txt"), false);
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

test("listing a git repo follows .gitignore (plus .git and caches by name); a plain folder is walked the same way", { skip: !hasGit }, async () => {
  const files = {
    ".gitignore": "generated/\n",
    "src/a.ts": "import './b';", "src/b.ts": "", ".eslintrc.json": "{}",
    "generated/out.ts": "", "target/debug/x.js": "", ".idea/w.json": "{}", "vendor/lib.js": "", "node_modules/m/i.js": "",
  };
  const root = tempRepo(files);
  try {
    writeFileSync(join(root, "src", "untracked.ts"), "");
    const l = await listProjectFiles(root, 800);
    assert.equal(l.source, "git");
    // committed .idea, target and vendor files show: the repo didn't ignore them
    assert.deepEqual(l.rels, [".eslintrc.json", ".idea/w.json", "src/a.ts", "src/b.ts", "src/untracked.ts", "target/debug/x.js", "vendor/lib.js"]);
    assert.deepEqual([...(l.tracked ?? [])].sort(), [".eslintrc.json", ".idea/w.json", "src/a.ts", "src/b.ts", "target/debug/x.js", "vendor/lib.js"]);
    assert.deepEqual([...(l.ignoredDirs ?? [])], ["generated"]);
    assert.equal(l.changedAt, undefined); // under the cap: no ranking needed
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
    for (const r of roots) await svc.getMapAsync(r);
    const kept = roots.filter((r) => svc.getCached(r));
    assert.ok(kept.length <= 4, `${kept.length} roots kept`);
    assert.ok(svc.getCached(roots[5]));
  } finally {
    svc.onModuleDestroy();
    for (const r of roots) rmSync(r, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  }
});

test("imports: C/C++ includes (next to the file, then by path suffix, not system headers) and Vue/Svelte script imports", async () => {
  const root = tempRepo({
    "src/main.cpp": '#include "net/socket.h"\n#include "util.hpp"\n#include <stdio.h>\n#include <engine/core.h>\nint main() {}\n',
    "src/util.hpp": "#pragma once\n",
    "include/net/socket.h": "#pragma once\n",
    "include/engine/core.h": "#pragma once\n",
    "kernels/add.cu": '#include "../src/util.hpp"\n',
    "app.vue": "<template><Hero /></template>\n<script setup>\nimport Hero from './components/Hero.vue'\nimport { data } from './lib/site'\n</script>\n",
    "components/Hero.vue": "<template><h1/></template>\n",
    "lib/site.ts": "export const data = 1;\n",
    "Dockerfile": "FROM node:22\n",
  }, false);
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const svc = new MapperService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { defaultRoot: root, claudeProjectsDir: projects } as never);
  try {
    const map = await svc.getMapAsync(root);
    const rel = (p: string) => p.slice(root.length + 1);
    const edges = map.edges.map((e) => `${rel(e.from)} -> ${rel(e.to)}`).sort();
    assert.deepEqual(edges, [
      "app.vue -> components/Hero.vue",
      "app.vue -> lib/site.ts",
      "kernels/add.cu -> src/util.hpp",
      "src/main.cpp -> include/engine/core.h",
      "src/main.cpp -> include/net/socket.h",
      "src/main.cpp -> src/util.hpp",
    ]);
    assert.ok(map.files.some((f) => rel(f.path) === "Dockerfile"));
  } finally {
    svc.onModuleDestroy?.();
    rmSync(root, { recursive: true, force: true });
    rmSync(projects, { recursive: true, force: true });
  }
});

test("odd files a listing can name: a link to /dev/zero, a link out of the project, a FIFO, a huge sparse dump", { skip: !hasGit || process.platform === "win32" }, async () => {
  const outside = mkdtempSync(join(tmpdir(), "bs-outside-"));
  writeFileSync(join(outside, "secret.md"), "# not yours\n");
  const root = tempRepo({ "src/a.ts": 'import { b } from "./b";\n', "src/b.ts": "export const b = 1;\n", "big.md": "x\n".repeat(600_000) }, false);
  symlinkSync("/dev/zero", join(root, "src/zero.json"));
  symlinkSync("/dev/urandom", join(root, "src/rand.md"));
  symlinkSync(join(outside, "secret.md"), join(root, "src/secret.md"));
  symlinkSync(join(root, "src/b.ts"), join(root, "src/b-link.ts"));       // stays inside: kept
  execFileSync("mkfifo", [join(root, "src/pipe.md")]);
  const fd = openSync(join(root, "dump.sql"), "w"); ftruncateSync(fd, 1536 * 1024 * 1024); closeSync(fd); // 1.5 GB, sparse
  const g = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  g("init", "-q"); g("add", "src", "big.md"); g("commit", "-q", "-m", "init"); // the links committed, as a clone would bring them
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const svc = new MapperService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { defaultRoot: root, claudeProjectsDir: projects } as never);
  try {
    const rss = process.memoryUsage().rss, t0 = Date.now();
    const map = await svc.getMapAsync(root);
    const names = map.files.map((f) => f.path.slice(root.length + 1)).sort();
    assert.deepEqual(names, ["big.md", "src/a.ts", "src/b-link.ts", "src/b.ts"]);
    assert.equal(map.files.find((f) => f.path.endsWith("big.md"))!.lines, 600_001); // 1.2 MB: counted, not parsed
    assert.ok(map.edges.some((e) => e.from.endsWith("src/a.ts") && e.to.endsWith("src/b.ts")));
    assert.ok(Date.now() - t0 < 10_000, "the build finishes");
    assert.ok(process.memoryUsage().rss - rss < 200 * 1024 * 1024, "memory stays bounded");
    // The same through the live path's reader.
    for (const f of ["src/zero.json", "src/rand.md", "src/secret.md", "src/pipe.md", "dump.sql", "src/missing.ts"]) {
      assert.equal(await readMapped(join(root, f), root), null, f);
    }
    assert.ok(MAX_COUNT_BYTES < 1536 * 1024 * 1024);
    assert.equal((await readMapped(join(root, "src/b-link.ts"), root))!.content, "export const b = 1;\n");
    assert.equal((await readMapped(join(root, "src/b.ts"), root))!.content, "export const b = 1;\n");
  } finally {
    svc.onModuleDestroy();
    rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); rmSync(projects, { recursive: true, force: true });
  }
});

test("JS/TS imports: every form, over several lines, and nothing from what only looks like one", () => {
  const src = [
    'import React from "react";',
    "import type { A, B } from './types';",
    'import type Def from "./def";',
    'import type from "./named-type";',
    "import x, { y } from './xy';",
    "import z, * as zz from './z';",
    'import * as ns from "./ns";',
    "import {\n  a, // the first one\n  b,\n} from './multi';",
    'import {c}from"./tight";',
    'import "./side-effect.css";',
    'export * from "./all";',
    'export * as names from "./names";',
    "export type { T } from './t';",
    "export {\n  one,\n  two as three,\n} from './barrel';",
    'export { default } from "./default";',
    'const lazy = import("./lazy");',
    'const old = require("./old");',
    "export const notAnImport = 1;",
    "export { local };",
    "export interface I { a: string }",
    "// a comment that says import things from here",
  ].join("\n");
  assert.deepEqual(jsImports(src).sort(), ["react", "./types", "./def", "./named-type", "./xy", "./z", "./ns", "./multi", "./tight",
    "./all", "./names", "./t", "./barrel", "./default", "./side-effect.css", "./lazy", "./old"].sort());
});

test("JS/TS imports stay linear on export-heavy and unclosed files", () => {
  const time = (content: string) => { const t = process.hrtime.bigint(); jsImports(content); return Number(process.hrtime.bigint() - t) / 1e6; };
  const consts = Array.from({ length: 20_000 }, (_, i) => `export const X_${i} = ${i};`).join("\n"); // ~500 KB
  assert.ok(consts.length >= 500_000);
  time(consts); // warm up
  const ms = time(consts);
  assert.ok(ms < 50, `500 KB of export const lines: ${ms.toFixed(1)} ms`);
  for (const line of ["export interface T { a: number; b: string }", "import {", "export {", "import ", "import x, ", "export * "]) {
    const big = Array.from({ length: 20_000 }, () => line).join("\n");
    const t = time(big);
    assert.ok(t < 50, `${JSON.stringify(line)} x 20,000: ${t.toFixed(1)} ms`);
  }
});

test("live: a link to a folder outside the project, made while watching, maps nothing from it", { skip: process.platform === "win32" }, async () => {
  const outside = mkdtempSync(join(tmpdir(), "bs-outside-"));
  writeFileSync(join(outside, "secret.md"), "# not yours\n");
  const root = tempRepo({ "src/a.ts": "export const a = 1;\n" }, false);
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const svc = new MapperService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { defaultRoot: root, claudeProjectsDir: projects } as never);
  try {
    svc.onModuleInit();
    await svc.getMapAsync(root);
    await new Promise((r) => setTimeout(r, 300)); // the watch starts right after the first build
    symlinkSync(outside, join(root, "docs"));
    mkdirSync(join(root, "src/inner")); symlinkSync(join(root, "src"), join(root, "src/inner/up")); // a link inside, to a folder: not a new folder either
    writeFileSync(join(root, "src/b.ts"), "export const b = 1;\n");   // a real change, so we know the batch went through
    const mapped = () => [...svc.getCached(root)!.byPath.keys()].map((p) => p.slice(root.length + 1)).sort();
    for (let i = 0; i < 50 && !mapped().includes("src/b.ts"); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(mapped(), ["src/a.ts", "src/b.ts"]);
    assert.equal(await readMapped(join(root, "docs/secret.md"), root), null);  // through a linked folder: its real path is outside
    assert.ok(await readMapped(join(root, "src/inner/up/a.ts"), root));          // a linked folder that stays inside is fine to read
  } finally {
    svc.onModuleDestroy();
    rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); rmSync(projects, { recursive: true, force: true });
  }
});

test("presence: deleting a file or switching project cancels its 60 s 'working on it' timer", async () => {
  const root = tempRepo({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 1;\n" }, false);
  const other = tempRepo({ "x.ts": "" }, false);
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const handlers: Record<string, (p: unknown) => void> = {};
  const svc = new MapperService(
    { on: (ev: string, fn: (p: unknown) => void) => { handlers[ev] = fn; }, emit() {} } as never,
    { broadcast() {} } as never,
    { defaultRoot: root, claudeProjectsDir: projects } as never,
  );
  const timers = () => (svc as unknown as { activeClearTimers: Map<string, unknown> }).activeClearTimers;
  try {
    svc.onModuleInit();
    await svc.getMapAsync(root);
    await new Promise((r) => setTimeout(r, 300));
    const ts = new Date().toISOString();
    handlers["file-touched"]({ path: join(root, "src/a.ts"), sessionId: "s1", ts });
    handlers["file-touched"]({ path: join(root, "src/b.ts"), sessionId: "s1", ts });
    assert.equal(timers().size, 2);
    unlinkSync(join(root, "src/a.ts"));
    await waitFor(() => !svc.getCached(root)!.byPath.has(join(root, "src/a.ts")) || undefined);
    assert.deepEqual([...timers().keys()], [join(root, "src/b.ts")]);
    await svc.switchRoot(other);
    assert.equal(timers().size, 0);
    assert.equal(svc.getCached(root)!.byPath.get(join(root, "src/b.ts"))!.activeSessionId, undefined);
  } finally {
    svc.onModuleDestroy();
    for (const d of [root, other, projects]) rmSync(d, { recursive: true, force: true });
  }
});

test("a git repo follows .gitignore alone (plus .git and caches): .github, build and scripts/build show unless ignored, live too", { skip: !hasGit }, async () => {
  const root = tempRepo({
    ".gitignore": "out/\n*.gen.ts\n",
    "src/a.ts": "export const a = 1;\n",
    ".github/workflows/ci.yml": "on: push\n",
    "scripts/build/run.ts": "export {};\n",
    "build/tool.ts": "export {};\n",
  });
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  mkdirSync(join(root, "out"));
  writeFileSync(join(root, "out/bundle.js"), "");
  writeFileSync(join(root, "src/x.gen.ts"), "");
  mkdirSync(join(root, "node_modules/x"), { recursive: true });
  writeFileSync(join(root, "node_modules/x/index.js"), "");
  const svc = new MapperService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { defaultRoot: root, claudeProjectsDir: projects } as never);
  const mapped = () => [...svc.getCached(root)!.byPath.keys()].map((p) => p.slice(root.length + 1)).sort();
  try {
    svc.onModuleInit();
    await svc.getMapAsync(root);
    assert.deepEqual(mapped(), [".github/workflows/ci.yml", ".gitignore", "build/tool.ts", "scripts/build/run.ts", "src/a.ts"].filter((f) => isMappableRel(f, true)));
    assert.ok(svc.getCached(root)!.ignoredDirs!.has("out"));
    await new Promise((r) => setTimeout(r, 300));
    // Live: a new ignored folder stays off, a new .github file joins.
    mkdirSync(join(root, "out2"));
    appendFileSync(join(root, ".gitignore"), "out2/\n");
    writeFileSync(join(root, "out2/a.ts"), "");
    writeFileSync(join(root, "out/more.ts"), "");
    writeFileSync(join(root, ".github/dependabot.yml"), "version: 2\n");
    await waitFor(() => mapped().includes(".github/dependabot.yml") || undefined);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(mapped().some((f) => f.startsWith("out")), false);
  } finally {
    svc.onModuleDestroy();
    rmSync(root, { recursive: true, force: true }); rmSync(projects, { recursive: true, force: true });
  }
  // Not a git repo: the name list as before.
  const plain = tempRepo({ "src/a.ts": "", ".github/workflows/ci.yml": "", "build/tool.ts": "" }, false);
  try { assert.deepEqual((await listProjectFiles(plain, 800)).rels, ["src/a.ts"]); } finally { rmSync(plain, { recursive: true, force: true }); }
});

test("imports: .js names for .ts files, tsconfig paths and baseUrl, Python absolute and package imports, nothing from comments", async () => {
  const root = tempRepo({
    "tsconfig.json": '{\n  // aliases\n  "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["src/*"], "~lib": ["lib/index.ts"], }, },\n}\n',
    "src/a.ts": "import { b } from './b.js';\nimport { c } from '@/c';\nimport l from '~lib';\nimport u from 'src/util';\nimport r from 'react';\nimport e from '~libextra';\n// import { gone } from './gone';\n/* import { old } from './old'; */\n",
    "src/b.ts": "export const b = 1;\n", "src/c.tsx": "export const c = 1;\n", "src/util.ts": "", "src/gone.ts": "", "src/old.ts": "",
    "lib/index.ts": "export default 1;\n",
    "src/n.tsx": "import { b } from './b.jsx';\nimport { c } from './c.js';\n",
    "pkg/__init__.py": "", "pkg/core.py": "", "pkg/sub/__init__.py": "", "pkg/sub/tool.py": "",
    "app.py": 'import pkg.core\nfrom pkg.sub import tool\nimport os, json\n# from pkg import gone\n"""\nfrom pkg import old\n"""\n',
    "pkg/sub/rel.py": "from .. import core\nfrom . import tool\n",
    "main.go": "package main\n// import \"x/y\"\n",
  }, false);
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const svc = new MapperService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { defaultRoot: root, claudeProjectsDir: projects } as never);
  try {
    const map = await svc.getMapAsync(root);
    const from = (f: string) => map.edges.filter((e) => e.from === join(root, f)).map((e) => e.to.slice(root.length + 1)).sort();
    assert.deepEqual(from("src/a.ts"), ["lib/index.ts", "src/b.ts", "src/c.tsx", "src/util.ts"]);
    assert.deepEqual(from("src/n.tsx"), ["src/c.tsx"]); // b.jsx means b.tsx only
    assert.deepEqual(from("app.py"), ["pkg/core.py", "pkg/sub/__init__.py", "pkg/sub/tool.py"]);
    assert.deepEqual(from("pkg/sub/rel.py"), ["pkg/__init__.py", "pkg/core.py", "pkg/sub/__init__.py", "pkg/sub/tool.py"]);
  } finally {
    svc.onModuleDestroy();
    rmSync(root, { recursive: true, force: true }); rmSync(projects, { recursive: true, force: true });
  }
});

test("imports: an alias without * means that name only, and no tsconfig above the project is read", async () => {
  const outer = mkdtempSync(join(tmpdir(), "bs-outer-"));
  writeFileSync(join(outer, "tsconfig.json"), '{ "compilerOptions": { "baseUrl": "proj", "paths": { "@x/*": ["proj/src/*"] } } }');
  const root = join(outer, "proj");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "import b from '@x/b';\nimport c from 'src/b';\n");
  writeFileSync(join(root, "src/b.ts"), "export default 1;\n");
  const projects = mkdtempSync(join(tmpdir(), "bs-projects-"));
  const svc = new MapperService({ on() {}, emit() {} } as never, { broadcast() {} } as never, { defaultRoot: root, claudeProjectsDir: projects } as never);
  try {
    const map = await svc.getMapAsync(root);
    assert.deepEqual(map.edges.filter((e) => e.from === join(root, "src/a.ts")), []); // the outer tsconfig isn't the project's
  } finally {
    svc.onModuleDestroy();
    rmSync(outer, { recursive: true, force: true }); rmSync(projects, { recursive: true, force: true });
  }
});

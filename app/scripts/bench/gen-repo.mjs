// A fake TypeScript monorepo of N files: nested folders, 10–800 lines per file, each TS file importing 1–8 others
// (mostly nearby), a git history, file times in the past. Deterministic for a given --files and --seed.
//
//   node gen-repo.mjs --files 5000 --out /tmp/brainstorm-bench/repo-5000 [--seed 1] [--force]
//
// Writes <out>.manifest.json next to the repo (not inside it: the mapper would read it as a file).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { log, parseArgs, real, rng } from "./lib.mjs";

export const GENERATOR_VERSION = 2;

const WORDS = ["auth", "billing", "user", "session", "profile", "invoice", "order", "cart", "search", "report", "chart", "table", "form",
  "modal", "toast", "theme", "router", "store", "cache", "queue", "worker", "email", "upload", "export", "import", "audit", "team", "role",
  "permission", "token", "payment", "plan", "usage", "metric", "event", "feed", "comment", "thread", "message", "notify", "schedule",
  "calendar", "file", "folder", "tag", "filter", "sort", "page", "layout", "header", "footer", "sidebar", "menu", "button", "input", "select",
  "date", "time", "money", "locale", "config", "logger", "client", "server", "adapter", "mapper", "parser", "schema", "model", "entity",
  "repo", "service", "handler", "controller", "middleware", "guard", "hook", "context", "provider", "util", "helper", "format", "validate"];
const FOLDERS = ["components", "hooks", "utils", "services", "models", "api", "store", "routes", "lib", "core", "features", "ui", "forms",
  "tables", "charts", "i18n", "state", "domain", "infra", "adapters", "handlers", "pages", "views", "widgets", "helpers", "types", "shared",
  "internal", "common", "data", "queries", "mutations", "schemas", "workers", "jobs", "events", "fixtures", "mocks", "__tests__"];
const PACKAGES = ["core", "ui", "api-client", "auth", "billing", "analytics", "design-system", "data", "config", "logger", "events", "search",
  "notifications", "payments", "storage", "workflows", "editor", "charts", "forms", "i18n", "admin", "reports", "sync", "cli", "sdk"];
const BARE = ["react", "react-dom", "zod", "lodash", "date-fns", "@tanstack/react-query", "express", "node:fs", "node:path", "rxjs"];

const cap = (s) => s[0].toUpperCase() + s.slice(1);

/** Build the file list: folders grown at random under apps/ and packages/, 2–20 files each. */
function plan(n, R) {
  const folders = [];
  const nPkgs = Math.max(2, Math.min(PACKAGES.length, Math.round(n / 400)));
  const nApps = Math.max(1, Math.min(4, Math.round(n / 3000)));
  for (let i = 0; i < nApps; i++) folders.push({ path: `apps/${["web", "api", "admin", "mobile"][i]}/src`, depth: 0, pkg: `app${i}` });
  for (let i = 0; i < nPkgs; i++) folders.push({ path: `packages/${PACKAGES[i]}/src`, depth: 0, pkg: PACKAGES[i] });
  const files = [];
  const counts = new Map();
  const used = new Set();
  let fi = 0;
  const addFiles = (f, k) => {
    for (let i = 0; i < k && files.length < n; i++) {
      const ext = R.weighted([[".ts", 70], [".tsx", 18], [".json", 4], [".md", 4], [".css", 2], [".js", 2]]);
      let base;
      for (let t = 0; t < 20; t++) {
        const a = R.pick(WORDS), b = R.pick(WORDS);
        base = ext === ".tsx" ? cap(a) + cap(b) : R.chance(0.5) ? `${a}-${b}` : `${a}${cap(b)}`;
        if (i === 0 && R.chance(0.35) && ext === ".ts") base = "index";
        if (!used.has(`${f.path}/${base}${ext}`)) break;
        base = `${base}${++fi}`;
      }
      const path = `${f.path}/${base}${ext}`;
      used.add(path);
      const lines = Math.max(10, Math.min(800, Math.round(Math.exp(Math.log(90) + 0.8 * R.normal()))));
      files.push({ path, folder: f.path, pkg: f.pkg, ext, lines });
      counts.set(f.path, (counts.get(f.path) ?? 0) + 1);
    }
  };
  for (const f of folders) addFiles(f, R.int(2, 12));
  while (files.length < n) {
    // Grow a child folder under a random folder, shallower ones more often: depth 1–6 under each src/.
    const parent = R.weighted(folders.map((f) => [f, 1 / (1 + f.depth * 0.7)]));
    if (parent.depth >= 6) continue;
    let name = R.pick(FOLDERS);
    if (R.chance(0.4)) name = R.pick(WORDS);
    const path = `${parent.path}/${name}`;
    if (folders.some((f) => f.path === path)) continue;
    const f = { path, depth: parent.depth + 1, pkg: parent.pkg };
    folders.push(f);
    addFiles(f, R.int(2, 20));
  }
  // Root files most repos have.
  for (const [path, lines] of [["package.json", 40], ["README.md", 120], ["tsconfig.json", 30]]) {
    if (files.length >= n) files.pop();
    files.unshift({ path, folder: ".", pkg: "root", ext: path.slice(path.lastIndexOf(".")), lines });
  }
  return files;
}

/** Imports: mostly the same folder, then parent/child/sibling folders, the same package, then anywhere (shared code). */
function chooseImports(files, R) {
  const code = files.filter((f) => /\.(ts|tsx|js)$/.test(f.ext));
  const byFolder = new Map(), byPkg = new Map();
  for (const f of code) {
    (byFolder.get(f.folder) ?? byFolder.set(f.folder, []).get(f.folder)).push(f);
    (byPkg.get(f.pkg) ?? byPkg.set(f.pkg, []).get(f.pkg)).push(f);
  }
  const folderKeys = [...byFolder.keys()];
  const near = new Map(); // folder → files in parent, children and siblings
  for (const folder of folderKeys) {
    const parent = dirname(folder);
    const out = [];
    for (const g of folderKeys) if (g !== folder && (g === parent || dirname(g) === folder || dirname(g) === parent)) out.push(...byFolder.get(g));
    near.set(folder, out);
  }
  for (const f of code) {
    const k = R.int(1, 8);
    const set = new Set();
    for (let t = 0; t < k * 3 && set.size < k; t++) {
      const pool = R.weighted([[byFolder.get(f.folder), 50], [near.get(f.folder), 25], [byPkg.get(f.pkg), 15], [code, 10]]);
      if (!pool?.length) continue;
      const g = R.pick(pool);
      if (g !== f) set.add(g);
    }
    f.imports = [...set];
  }
}

function specifier(from, to) {
  let rel = relative(dirname(from.path), to.path).replace(/\.(ts|tsx|js)$/, "");
  if (rel.endsWith("/index") || rel === "index") rel = rel.slice(0, -"/index".length) || ".";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function body(f, R) {
  const out = [];
  if (/\.(ts|tsx|js)$/.test(f.ext)) {
    for (const g of f.imports ?? []) {
      const name = g.path.split("/").pop().replace(/\.\w+$/, "").replace(/[^A-Za-z0-9]/g, "") || "mod";
      out.push(R.chance(0.15) ? `export { ${name}Default } from "${specifier(f, g)}";` : `import { ${name} } from "${specifier(f, g)}";`);
    }
    if (R.chance(0.6)) out.push(`import { ${R.pick(WORDS)} } from "${R.pick(BARE)}";`);
    out.push("");
    let i = 0;
    while (out.length < f.lines) {
      const w = R.pick(WORDS), v = R.pick(WORDS);
      switch (R.int(0, 5)) {
        case 0: out.push(`/** ${cap(w)} the ${v} for the current ${R.pick(WORDS)}. */`); break;
        case 1: out.push(`export function ${w}${cap(v)}${i++}(input: ${cap(v)}Input): ${cap(w)}Result {`, `  const value = input.${v} ?? ${R.int(0, 99)};`, `  return { ok: value > ${R.int(0, 50)}, ${w}: value };`, "}"); break;
        case 2: out.push(`export interface ${cap(w)}${cap(v)}${i++} {`, `  id: string;`, `  ${v}: number;`, `  ${w}?: string;`, "}"); break;
        case 3: out.push(`const ${w}${cap(v)}${i++} = [${R.int(1, 9)}, ${R.int(10, 99)}, ${R.int(100, 999)}].map((n) => n * ${R.int(2, 7)});`); break;
        case 4: out.push(`  // TODO: handle ${v} when ${w} is missing`); break;
        default: out.push(""); break;
      }
    }
  } else if (f.ext === ".json") {
    out.push("{");
    while (out.length < f.lines - 1) out.push(`  "${R.pick(WORDS)}${out.length}": "${R.pick(WORDS)}",`);
    out.push(`  "end": true`, "}");
  } else if (f.ext === ".md") {
    out.push(`# ${cap(R.pick(WORDS))} ${R.pick(WORDS)}`, "");
    while (out.length < f.lines) out.push(`The ${R.pick(WORDS)} ${R.pick(WORDS)} keeps the ${R.pick(WORDS)} in sync with the ${R.pick(WORDS)}.`);
  } else {
    while (out.length < f.lines) out.push(`.${R.pick(WORDS)}-${R.pick(WORDS)} { margin: ${R.int(0, 24)}px; color: #${R.hex(6)}; }`);
  }
  return out.slice(0, Math.max(f.lines, (f.imports?.length ?? 0) + 2)).join("\n") + "\n";
}

const git = (cwd, args, env = {}) => execFileSync("git", ["-C", cwd, ...args], {
  stdio: ["ignore", "ignore", "pipe"], maxBuffer: 256 * 1024 * 1024,
  env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_AUTHOR_NAME: "bench", GIT_AUTHOR_EMAIL: "bench@example.invalid", GIT_COMMITTER_NAME: "bench", GIT_COMMITTER_EMAIL: "bench@example.invalid", ...env },
});

/** Generate (or reuse) the repo. Returns the manifest: { root, files: [{ path (absolute), rel, ext, lines, imports: [rel] }] }. */
export function generateRepo({ files: n, out, seed = 1, force = false }) {
  out = resolve(out);
  const manifestPath = `${out}.manifest.json`;
  if (!force && existsSync(manifestPath) && existsSync(join(out, ".git"))) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (m.version === GENERATOR_VERSION && m.count === n && m.seed === seed) {
      // Undo what a previous run's live writer changed, so every run starts from the same tree.
      try { git(out, ["checkout", "-q", "--", "."]); git(out, ["clean", "-qfd"]); } catch { /* not fatal */ }
      return m;
    }
  }
  const t0 = Date.now();
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const root = real(out);
  const R = rng(seed * 7919 + n);
  const files = plan(n, R);
  chooseImports(files, R);
  const dirs = new Set(files.map((f) => dirname(join(root, f.path))));
  for (const d of dirs) mkdirSync(d, { recursive: true });
  for (const f of files) writeFileSync(join(root, f.path), body(f, R));

  // History: everything 300 days ago, then a tenth of the files 3 days ago. File times match their last commit.
  const day = 86_400_000, now = Date.now();
  const old = new Date(now - 300 * day), recent = new Date(now - 3 * day);
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "Initial import"], { GIT_AUTHOR_DATE: old.toISOString(), GIT_COMMITTER_DATE: old.toISOString() });
  const touched = files.filter(() => R.chance(0.1));
  for (const f of touched) writeFileSync(join(root, f.path), body(f, R));
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "Recent work"], { GIT_AUTHOR_DATE: recent.toISOString(), GIT_COMMITTER_DATE: recent.toISOString() });
  const touchedSet = new Set(touched);
  for (const f of files) { const t = touchedSet.has(f) ? recent : old; utimesSync(join(root, f.path), t, t); }

  const manifest = {
    version: GENERATOR_VERSION, seed, count: files.length, root, generatedAt: new Date().toISOString(),
    edges: files.reduce((s, f) => s + (f.imports?.length ?? 0), 0),
    folders: dirs.size,
    files: files.map((f) => ({ rel: f.path, path: join(root, f.path), ext: f.ext, lines: f.lines, imports: (f.imports ?? []).map((g) => g.path) })),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  log(`repo: ${files.length} files, ${manifest.edges} imports, ${dirs.size} folders in ${root} (${Date.now() - t0} ms)`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = parseArgs();
  if (!a.files || !a.out) { console.error("usage: node gen-repo.mjs --files 5000 --out <dir> [--seed 1] [--force]"); process.exit(1); }
  const m = generateRepo({ files: Number(a.files), out: a.out, seed: Number(a.seed ?? 1), force: !!a.force });
  console.log(JSON.stringify({ root: m.root, files: m.count, edges: m.edges, folders: m.folders }));
}

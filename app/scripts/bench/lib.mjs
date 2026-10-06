// Shared helpers for the benchmark: seeded randomness, arguments, ports, paths, stats.
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { realpathSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const BENCH_DIR = dirname(fileURLToPath(import.meta.url));
export const APP_DIR = resolve(BENCH_DIR, "../..");
export const REPO_DIR = resolve(APP_DIR, "..");

/** Ports other Rundown processes and agents use on this machine: never bind them. */
export const RESERVED_PORTS = new Set([3000, 4000, 4747, 5173, 5825, 7331, 9222, 9333, 9487, 9913]);

/** mulberry32: small, fast, deterministic. */
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    /** Standard normal (Box-Muller). */
    normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    weighted: (pairs) => { // [[value, weight], ...]
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = next() * total;
      for (const [v, w] of pairs) { if ((x -= w) < 0) return v; }
      return pairs[pairs.length - 1][0];
    },
    hex: (n) => { let s = ""; for (let i = 0; i < n; i++) s += Math.floor(next() * 16).toString(16); return s; },
    uuid: () => { const h = r.hex(32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; },
  };
  return r;
}

/** `--files 1000,5000 --cpu 4 --no-build` → { files: "1000,5000", cpu: "4", build: false }. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key.startsWith("no-")) { out[camel(key.slice(3))] = false; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[camel(key)] = true;
    else { out[camel(key)] = next; i++; }
  }
  return out;
}
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
export const list = (v, dflt) => String(v ?? dflt).split(",").map((x) => x.trim()).filter(Boolean).map(Number);

/** Claude Code's project-folder naming: every character that isn't a letter, digit or "-" becomes "-". */
export const encodeRoot = (root) => resolve(root).replace(/[^A-Za-z0-9-]/g, "-");

export const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** The scratch dir, refusing anything inside this repo, ~/brainstorm or ~/.claude (the real logs). */
export function scratchDir(given) {
  const dir = resolve(given || resolve(tmpdir(), "brainstorm-bench"));
  mkdirSync(dir, { recursive: true });
  const abs = real(dir) + sep;
  const forbidden = [REPO_DIR, resolve(homedir(), "brainstorm"), resolve(homedir(), ".claude")].map((p) => real(p) + sep);
  for (const f of forbidden) if (abs.startsWith(f)) throw new Error(`scratch dir ${dir} is inside ${f}: pick one outside (default: $TMPDIR/brainstorm-bench)`);
  return real(dir);
}

/** A free TCP port on 127.0.0.1 at or after `from`, skipping the reserved ones. */
export async function freePort(from, taken = new Set()) {
  for (let p = from; p < from + 500; p++) {
    if (RESERVED_PORTS.has(p) || taken.has(p)) continue;
    const ok = await new Promise((res) => {
      const s = createServer();
      s.once("error", () => res(false));
      s.listen(p, "127.0.0.1", () => s.close(() => res(true)));
    });
    if (ok) { taken.add(p); return p; }
  }
  throw new Error(`no free port from ${from}`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}
export const round = (v, d = 1) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
export const kb = (bytes) => round(bytes / 1024, 1);
export const mb = (bytes) => round(bytes / 1024 / 1024, 1);

/** Poll `fn` until it returns a truthy value, or give up after `timeoutMs` (returns null). */
export async function waitFor(fn, { timeoutMs = 30_000, everyMs = 100 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    await sleep(everyMs);
  }
  return null;
}

export const log = (...a) => console.error(`[bench ${new Date().toISOString().slice(11, 19)}]`, ...a);

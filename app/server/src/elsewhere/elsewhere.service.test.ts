// Run: npx tsc -p . && node --test dist/
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookSignal } from "../attention/attention.service";
import { ElsewhereService } from "./elsewhere.service";

/** A Claude Code projects folder with one thread per project, and a service that sees `here` as the open workspace. */
function setup(hooks: Record<string, HookSignal & { at: number }> = {}) {
  const base = mkdtempSync(join(tmpdir(), "rd-elsewhere-"));
  const projects = join(base, "projects");
  const thread = (root: string, id: string, msAgo: number, extra = "") => {
    mkdirSync(root, { recursive: true });
    const dir = join(projects, root.replace(/[^A-Za-z0-9-]/g, "-"));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${id}.jsonl`);
    writeFileSync(file, `{"type":"user","cwd":${JSON.stringify(root)},"message":{"role":"user","content":"fix the hero"}}\n{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}\n${extra}`);
    const t = (Date.now() - msAgo) / 1000;
    utimesSync(file, t, t);
  };
  const here = join(base, "here"), there = join(base, "there");
  const listener = { scopeRoots: () => [here], getSession: () => undefined, codexRecent: () => [] };
  const attention = { hookOf: (sid: string) => hooks[sid] };
  const svc = new ElsewhereService({ claudeProjectsDir: projects } as any, listener as any, attention as any);
  return { svc, thread, here, there };
}

test("a thread at work in another project is listed, the open project's are not, nor threads at rest", () => {
  const { svc, thread, here, there } = setup();
  thread(here, "mine", 1000);
  thread(there, "busy", 5000, `{"type":"custom-title","customTitle":"Landing hero"}\n`);
  thread(there, "old", 30 * 60_000);
  const list = svc.list();
  assert.deepEqual(list.map((t) => [t.sessionId, t.state, t.project, t.title]), [["busy", "working", "there", "Landing hero"]]);
});

test("a thread a hook says waits on you stays listed while it's quiet; a finished one says it's your turn", () => {
  const now = Date.now();
  const { svc, thread, there } = setup({
    waits: { event: "PermissionRequest", session_id: "waits", at: now - 9 * 60_000 },
    done: { event: "Stop", session_id: "done", at: now - 500 },
  });
  thread(there, "waits", 10 * 60_000); // quiet for 10 minutes: nothing written since its permission prompt
  thread(there, "done", 1000);
  const by = Object.fromEntries(svc.list().map((t) => [t.sessionId, t.state]));
  assert.deepEqual(by, { waits: "needs-you", done: "your-turn" });
});

test("work after the hook spoke means the agent is going again", () => {
  const { svc, thread, there } = setup({ again: { event: "PermissionRequest", session_id: "again", at: Date.now() - 60_000 } });
  thread(there, "again", 2000);
  assert.equal(svc.list()[0]?.state, "working");
});

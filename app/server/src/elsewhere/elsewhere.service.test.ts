import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookSignal } from "../shared/contract";
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
  const listener = { scopeRoots: () => [here], getSession: () => undefined, codexRecent: () => [], isVisitor: (id: string) => id === "guest" };
  const attention = { hookOf: (sid: string) => hooks[sid] };
  const svc = new ElsewhereService({ claudeProjectsDir: projects } as any, listener as any, attention as any, listener as any);
  return { svc, thread, here, there };
}

test("a thread at work in another project is listed, the open project's are not, nor threads at rest", async () => {
  const { svc, thread, here, there } = setup();
  thread(here, "mine", 1000);
  thread(there, "busy", 5000, `{"type":"custom-title","customTitle":"Landing hero"}\n`);
  thread(there, "old", 30 * 60_000);
  const list = (await svc.list());
  assert.deepEqual(list.map((t) => [t.sessionId, t.state, t.project, t.title]), [["busy", "working", "there", "Landing hero"]]);
});

test("a thread a hook says waits on you stays listed while it's quiet; a finished one says it's your turn", async () => {
  const now = Date.now();
  const { svc, thread, there } = setup({
    waits: { event: "PermissionRequest", session_id: "waits", at: now - 9 * 60_000 },
    done: { event: "Stop", session_id: "done", at: now - 500 },
  });
  thread(there, "waits", 10 * 60_000); // quiet for 10 minutes: nothing written since its permission prompt
  thread(there, "done", 1000);
  const by = Object.fromEntries((await svc.list()).map((t) => [t.sessionId, t.state]));
  assert.deepEqual(by, { waits: "needs-you", done: "your-turn" });
});

test("work after the hook spoke means the agent is going again", async () => {
  const { svc, thread, there } = setup({ again: { event: "PermissionRequest", session_id: "again", at: Date.now() - 60_000 } });
  thread(there, "again", 2000);
  assert.equal((await svc.list())[0]?.state, "working");
});

test("a visitor (listed here because it once touched this project) still counts at work in its own project", async () => {
  const { svc, thread, there } = setup();
  thread(there, "guest", 1000);
  thread(there, "other", 1000);
  assert.deepEqual((await svc.list()).map((t) => t.sessionId).sort(), ["guest", "other"]);
});

test("a title read from another project's raw log has its secrets masked", async () => {
  const { svc, thread, there } = setup();
  const key = "sk-ant-api03-FAKEFAKEFAKEFAKE0123456789";
  thread(there, "prompted", 1000, `${JSON.stringify({ type: "last-prompt", lastPrompt: `use ${key} for the tests`, sessionId: "prompted" })}\n`);
  thread(there, "named", 1000, `${JSON.stringify({ type: "custom-title", customTitle: `key ${key}` })}\n`);
  const list = (await svc.list());
  assert.equal(list.length, 2);
  for (const t of list) assert.ok(t.title?.includes("[redacted]") && !t.title.includes("FAKEFAKE"), t.title);
});

test("a folder is listed again only when it changes; calls at the same moment share one look", async () => {
  const { svc, thread, there } = setup();
  thread(there, "busy", 1000);
  const [a, b] = await Promise.all([svc.list(), svc.list()]);
  assert.equal(a, b);
  assert.deepEqual(a.map((t) => t.sessionId), ["busy"]);
  const cached = (svc as unknown as { listings: Map<string, unknown> }).listings.size;
  assert.ok(cached >= 2);
  thread(there, "second", 500); // a new log: its folder's mtime moves, it's listed again
  assert.deepEqual((await svc.list()).map((t) => t.sessionId).sort(), ["busy", "second"]);
});

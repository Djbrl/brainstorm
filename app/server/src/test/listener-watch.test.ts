// End to end with the file watcher: history read quietly after start, live lines broadcast, other projects not watched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, appendFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { makeListener, line, jsonl, internals } from "./helpers";
import type { WsMessage } from "../shared/contract";

type Step$ = Extract<WsMessage, { type: "step" }>;
type Sess$ = Extract<WsMessage, { type: "session" }>;
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import { ConfigService } from "../core/config.service";
import { ListenerService } from "../listener/listener.service";
import { WorkspaceState } from "../core/workspace-state";
import { ClaudeSource } from "../listener/claude.source";

const until = async (cond: () => boolean, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 20)); }
};

test("boot: history quietly once listening, then live steps; other projects' folders aren't watched", async () => {
  const root = "/work/watch-repo";
  // The logs exist before the server starts: create them, then start the listener on them.
  const pre = await makeListener({ root });
  const history = join(pre.projectDir, "old.jsonl");
  writeFileSync(history, jsonl([line("prompt", { sessionId: "old", cwd: root, i: 0, text: "earlier work" }), line("tool", { sessionId: "old", cwd: root, i: 1 })]));
  const other = join(pre.cfg.claudeProjectsDir, "-somewhere-else");
  mkdirSync(join(other, "sess", "subagents"), { recursive: true });
  writeFileSync(join(other, "x.jsonl"), jsonl([line("prompt", { sessionId: "x", cwd: "/somewhere/else", i: 0 })]));
  const worktreeDir = pre.projectDir + "--claude-worktrees-feature";
  mkdirSync(worktreeDir, { recursive: true });
  writeFileSync(join(worktreeDir, "wt.jsonl"), jsonl([line("prompt", { sessionId: "wt", cwd: root + "/.claude/worktrees/feature", i: 0, text: "in a worktree" }), line("edit", { sessionId: "wt", cwd: root, i: 1 })]));
  await pre.listener.onModuleDestroy();
  pre.dbs.db.close();

  // Same folders, a new service (as at boot). makeListener would make new folders, so build it by hand.
  const sent: WsMessage[] = [];
  const bus = new BusService();
  const L = new ListenerService(new DbService(), bus, { broadcast: (m: WsMessage) => { sent.push(m); } }, new ConfigService(), new WorkspaceState());
  L.onModuleInit();
  await until(() => L.store.listSessions().length === 2);
  assert.deepEqual(L.store.listSessions().map((s) => s.id).sort(), ["old", "wt"]);
  assert.equal(L.store.listSteps("old").length, 2);
  await until(() => internals(L).ready && L.tailer.reading.size === 0);
  assert.equal(sent.filter((m) => m.type === "step").length, 0, "history isn't broadcast as live");

  const watched = Object.keys(L.watcher.getWatched());
  assert.ok(watched.some((d) => d.startsWith(pre.projectDir)));
  assert.ok(!watched.some((d) => d.startsWith(other)), "a project outside the workspace isn't descended into");

  appendFileSync(history, jsonl([line("text", { sessionId: "old", cwd: root, i: 5, text: "live now" })]));
  await until(() => sent.some((m) => m.type === "step"));
  assert.deepEqual(sent.filter((m) => m.type === "step").map((m) => (m as Step$).step.text), ["live now"]);

  // A new thread appears: live from its first line.
  writeFileSync(join(pre.projectDir, "new.jsonl"), jsonl([line("prompt", { sessionId: "new", cwd: root, i: 6, text: "brand new" })]));
  await until(() => sent.some((m) => m.type === "step" && (m as Step$).step.sessionId === "new"));
  assert.ok(sent.some((m) => m.type === "session" && (m as Sess$).session.id === "new"));

  // Another workspace: its folder is read (quietly) and watched from then on.
  const before = sent.filter((m) => m.type === "step").length;
  bus.emit("workspace", { root: "/somewhere/else" });
  await until(() => L.store.listSessions().some((s) => s.id === "x"));
  await until(() => Object.keys(L.watcher.getWatched()).some((d) => d.startsWith(other)));
  assert.equal(sent.filter((m) => m.type === "step").length, before);
  appendFileSync(join(other, "x.jsonl"), jsonl([line("text", { sessionId: "x", cwd: "/somewhere/else", i: 9, text: "over there" })]));
  await until(() => sent.some((m) => m.type === "step" && (m as Step$).step.text === "over there"));
  await L.onModuleDestroy();
  rmSync(pre.tmp, { recursive: true, force: true });
});

test("a project log folder unreadable at boot is read once its permissions are fixed (tried again later)", async (ctx) => {
  const root = "/work/locked-repo";
  const pre = await makeListener({ root });
  writeFileSync(join(pre.projectDir, "old.jsonl"), jsonl([line("prompt", { sessionId: "old", cwd: root, i: 0, text: "earlier work" }), line("tool", { sessionId: "old", cwd: root, i: 1 })]));
  await pre.listener.onModuleDestroy();
  pre.dbs.db.close();
  chmodSync(pre.projectDir, 0o000);
  const was = ClaudeSource.retryMs;
  ClaudeSource.retryMs = 100;
  ctx.after(() => { ClaudeSource.retryMs = was; chmodSync(pre.projectDir, 0o755); rmSync(pre.tmp, { recursive: true, force: true }); });

  const L = new ListenerService(new DbService(), new BusService(), { broadcast: () => {} }, new ConfigService(), new WorkspaceState());
  ctx.after(() => L.onModuleDestroy());
  L.onModuleInit();
  await until(() => internals(L).ready);
  await new Promise((r) => setTimeout(r, 300)); // a few retries while it's still locked
  assert.equal(L.store.listSessions().length, 0);
  chmodSync(pre.projectDir, 0o755);
  await until(() => L.store.listSessions().some((s) => s.id === "old"));
});

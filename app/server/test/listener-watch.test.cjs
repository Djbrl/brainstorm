// End to end with the file watcher: history read quietly after start, live lines broadcast, other projects not watched.
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFileSync, appendFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { makeListener, line, jsonl } = require("./helpers.cjs");

const until = async (cond, ms = 10_000) => {
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
  const { DbService } = require("../dist/core/db.service.js");
  const { BusService } = require("../dist/core/bus.service.js");
  const { ConfigService } = require("../dist/core/config.service.js");
  const { ListenerService } = require("../dist/listener/listener.service.js");
  const sent = [];
  const L = new ListenerService(new DbService(), new BusService(), { broadcast: (m) => sent.push(m) }, new ConfigService());
  L.onModuleInit();
  await until(() => L.listSessions().length === 2);
  assert.deepEqual(L.listSessions().map((s) => s.id).sort(), ["old", "wt"]);
  assert.equal(L.listSteps("old").length, 2);
  await until(() => L.ready && L.reading.size === 0);
  assert.equal(sent.filter((m) => m.type === "step").length, 0, "history isn't broadcast as live");

  const watched = Object.keys(L.watcher.getWatched());
  assert.ok(watched.some((d) => d.startsWith(pre.projectDir)));
  assert.ok(!watched.some((d) => d.startsWith(other)), "a project outside the workspace isn't descended into");

  appendFileSync(history, jsonl([line("text", { sessionId: "old", cwd: root, i: 5, text: "live now" })]));
  await until(() => sent.some((m) => m.type === "step"));
  assert.deepEqual(sent.filter((m) => m.type === "step").map((m) => m.step.text), ["live now"]);

  // A new thread appears: live from its first line.
  writeFileSync(join(pre.projectDir, "new.jsonl"), jsonl([line("prompt", { sessionId: "new", cwd: root, i: 6, text: "brand new" })]));
  await until(() => sent.some((m) => m.type === "step" && m.step.sessionId === "new"));
  assert.ok(sent.some((m) => m.type === "session" && m.session.id === "new"));

  // Another workspace: its folder is read (quietly) and watched from then on.
  const before = sent.filter((m) => m.type === "step").length;
  L.bus.emit("workspace", { root: "/somewhere/else" });
  await until(() => L.listSessions().some((s) => s.id === "x"));
  await until(() => Object.keys(L.watcher.getWatched()).some((d) => d.startsWith(other)));
  assert.equal(sent.filter((m) => m.type === "step").length, before);
  appendFileSync(join(other, "x.jsonl"), jsonl([line("text", { sessionId: "x", cwd: "/somewhere/else", i: 9, text: "over there" })]));
  await until(() => sent.some((m) => m.type === "step" && m.step.text === "over there"));
  await L.onModuleDestroy();
  require("node:fs").rmSync(pre.tmp, { recursive: true, force: true });
});

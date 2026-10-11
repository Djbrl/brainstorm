// What a thread is made of: its steps' ids and order, across copied, merged, replaced and odd logs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { makeListener, line, jsonl } = require("./helpers.cjs");

const stepsOf = (t, sid) => t.dbs.db.prepare(`SELECT id, seq, text FROM steps WHERE session_id = ? ORDER BY seq`).all(sid).map((r) => ({ ...r }));
const offsetOf = (t, f) => t.dbs.db.prepare(`SELECT offset FROM listener_offsets WHERE file = ?`).get(f)?.offset;

/** n one-step lines of thread `sid`, texts `${tag} 0`… */
const own = (sid, tag, n, from = 0) => Array.from({ length: n }, (_, k) => line(k === 0 && from === 0 ? "prompt" : "text", { sessionId: sid, i: from + k, text: `${tag} ${k}` }));
/** Claude Code resuming or forking a thread: its lines copied, uuids and all, under the new thread's id. */
const copy = (lines, sid) => lines.map((l) => ({ ...l, sessionId: sid }));

test("a resumed and a forked thread keep their own steps: copied lines never move between threads", async () => {
  const t = await makeListener();
  const A = own("A", "a", 7);
  const B = [...copy(A, "B"), ...own("B", "b", 5, 7)];
  const C = [...copy(B, "C"), ...own("C", "c", 3, 12)];
  const fA = join(t.projectDir, "A.jsonl"), fB = join(t.projectDir, "B.jsonl"), fC = join(t.projectDir, "C.jsonl");
  writeFileSync(fA, jsonl(A));
  writeFileSync(fB, jsonl(B));
  // History, newest first (B, then A), then C forked live.
  await t.readNow(fB, true);
  await t.readNow(fA, true);
  t.live();
  writeFileSync(fC, jsonl(C));
  await t.readNow(fC);
  const [a, b, c] = ["A", "B", "C"].map((s) => stepsOf(t, s));
  assert.deepEqual([a.length, b.length, c.length], [7, 12, 15]);
  for (const list of [a, b, c]) assert.deepEqual(list.map((s) => s.seq), list.map((_, k) => k), "in order, from 0");
  assert.deepEqual(a.map((s) => s.text), A.map((l) => l.message.content[0]?.text ?? l.message.content));
  assert.equal(new Set([...a, ...b, ...c].map((s) => s.id)).size, 34, "every id is unique");
  assert.equal(t.sent.filter((m) => m.type === "step").length, 15, "C's steps went out live");
  await t.close();
});

test("a line repeated within a thread keeps its first place; reading the log again changes nothing", async () => {
  const t = await makeListener();
  const lines = own("s1", "x", 4);
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([...lines, lines[1], ...own("s1", "y", 2, 4)]));
  await t.readNow(f, true);
  const first = stepsOf(t, "s1");
  assert.deepEqual(first.map((s) => s.text), ["x 0", "x 1", "x 2", "x 3", "y 0", "y 1"]);
  t.listener.saveOffset(f, 0);
  await t.readNow(f, true);
  assert.deepEqual(stepsOf(t, "s1"), first);
  await t.close();
});

test("a step line without a uuid is skipped, with one warning for the file", async () => {
  const t = await makeListener();
  const warned = [];
  t.listener.log.warn = (m) => warned.push(m);
  const f = join(t.projectDir, "s1.jsonl");
  const bad = (k) => { const l = line("text", { i: k, text: `bad ${k}` }); delete l.uuid; return l; };
  writeFileSync(f, jsonl([line("prompt", { i: 0, text: "go" }), bad(1), bad(2), line("text", { i: 3, text: "fine" })]));
  await t.readNow(f, true);
  assert.deepEqual(stepsOf(t, "s1").map((s) => s.text), ["go", "fine"]);
  assert.equal(warned.filter((m) => m.includes("uuid")).length, 1);
  await t.close();
});


test("Claude Code's folder names: a path over 200 characters is cut and hashed as it does; either Unicode form of the root", async () => {
  const { mkdirSync } = require("node:fs");
  const { claudeProjectDir, folderOf } = require(require("./helpers.cjs").dist("listener/moved.js"));
  assert.equal(claudeProjectDir("/Users/me/my.app"), "-Users-me-my-app");
  const long = "/work/" + "deep-folder-name/".repeat(14) + "x".repeat(6);
  assert.equal(long.length, 250);
  const name = claudeProjectDir(long);
  let h = 0; for (const c of long) h = (h * 31 + c.charCodeAt(0)) | 0;
  assert.equal(name, long.replace(/[^A-Za-z0-9]/g, "-").slice(0, 200) + "-" + Math.abs(h).toString(36));
  assert.equal(folderOf(name, long), "own");
  assert.equal(folderOf(claudeProjectDir(long + "/.claude/worktrees/w"), long), "maybe");
  assert.equal(folderOf(claudeProjectDir("/work/other"), long), false);

  for (const [root, cwd] of [[long, long], ["/work/café-app", "/work/café-app"]]) {
    const t = await makeListener({ root });
    const dir = join(t.cfg.claudeProjectsDir, claudeProjectDir(cwd));
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "s1.jsonl");
    writeFileSync(f, jsonl([line("prompt", { cwd, i: 0, text: "hello" }), line("tool", { cwd, i: 1 })]));
    const claude = t.listener.sources.find((s) => s.harness === "claude");
    assert.deepEqual(claude.list(t.listener.scope()).map((x) => x.path), [f], root);
    await t.readNow(f, true);
    assert.deepEqual(t.listener.listSessions().map((s) => s.id), ["s1"], root);
    await t.close();
  }
});

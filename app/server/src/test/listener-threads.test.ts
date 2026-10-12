// What a thread is made of: its steps' ids and order, across copied, merged, replaced and odd logs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, utimesSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { makeListener, line, jsonl, type TestListener, type LogLine } from "./helpers";

type Row = Record<string, any>;
import { claudeProjectDir, folderOf } from "../listener/moved";
import { migrate } from "../core/schema";
import { ListenerService } from "../listener/listener.service";

const stepsOf = (t: TestListener, sid: string) => t.dbs.db.prepare(`SELECT id, seq, text FROM steps WHERE session_id = ? ORDER BY seq`).all(sid).map((r) => ({ ...r })) as { id: string; seq: number; text: string }[];
const offsetOf = (t: TestListener, f: string) => (t.dbs.db.prepare(`SELECT offset FROM listener_offsets WHERE file = ?`).get(f) as { offset: number } | undefined)?.offset;

/** n one-step lines of thread `sid`, texts `${tag} 0`… */
const own = (sid: string, tag: string, n: number, from = 0) => Array.from({ length: n }, (_, k) => line(k === 0 && from === 0 ? "prompt" : "text", { sessionId: sid, i: from + k, text: `${tag} ${k}` }));
/** Claude Code resuming or forking a thread: its lines copied, uuids and all, under the new thread's id. */
const copy = (lines: LogLine[], sid: string) => lines.map((l) => ({ ...l, sessionId: sid }));

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
  t.listener.tailer.saveOffset(f, 0);
  await t.readNow(f, true);
  assert.deepEqual(stepsOf(t, "s1"), first);
  await t.close();
});

test("a step line without a uuid is skipped, with one warning for the file", async () => {
  const t = await makeListener();
  const warned: string[] = [];
  t.inner.log.warn = (m: string) => { warned.push(m); };
  const f = join(t.projectDir, "s1.jsonl");
  const bad = (k: number) => { const l = line("text", { i: k, text: `bad ${k}` }); delete l.uuid; return l; };
  writeFileSync(f, jsonl([line("prompt", { i: 0, text: "go" }), bad(1), bad(2), line("text", { i: 3, text: "fine" })]));
  await t.readNow(f, true);
  assert.deepEqual(stepsOf(t, "s1").map((s) => s.text), ["go", "fine"]);
  assert.equal(warned.filter((m) => m.includes("uuid")).length, 1);
  await t.close();
});


test("Claude Code's folder names: a path over 200 characters is cut and hashed as it does; either Unicode form of the root", async () => {
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
    const claude = t.inner.sources.find((s) => s.harness === "claude")!;
    assert.deepEqual(claude.list(t.inner.scope()).map((x) => x.path), [f], root);
    await t.readNow(f, true);
    assert.deepEqual(t.listener.store.listSessions().map((s) => s.id), ["s1"], root);
    await t.close();
  }
});

const KEY = "sk-ant-api03-abcdefghijklmnop1234";

test("titles are stored masked, from a prompt and from a rename; older titles are cleaned once; Claude rows say claude", async () => {
  const t = await makeListener();
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([line("prompt", { i: 0, text: `use ${KEY} to call the API` }), line("tool", { i: 1 })])
    + JSON.stringify({ type: "custom-title", sessionId: "s2", customTitle: `key ${KEY}` }) + "\n");
  await t.readNow(f, true);
  const titles = () => t.dbs.db.prepare(`SELECT id, title, harness FROM sessions ORDER BY id`).all().map((r) => ({ ...r })) as Row[];
  for (const r of titles()) { assert.ok(!r.title.includes(KEY), r.title); assert.equal(r.harness, "claude"); }
  // A database from before: an unmasked title, harness NULL. The next start fixes both, once.
  t.dbs.db.prepare(`UPDATE sessions SET title = ?, harness = NULL WHERE id = 's1'`).run(`old ${KEY}`);
  t.dbs.db.exec(`DELETE FROM settings WHERE key LIKE 'listener:%'; PRAGMA user_version = 0`);
  migrate(t.dbs.db);
  const again = new ListenerService(t.dbs, t.bus, { broadcast() {} }, t.cfg, t.state);
  again.onModuleInit();
  await again.watcher.close();
  const s1 = titles().find((r) => r.id === "s1")!;
  assert.ok(!s1.title.includes(KEY) && s1.title.startsWith("old "), s1.title);
  assert.equal(s1.harness, "claude");
  await again.onModuleDestroy();
  await t.close();
});

test("a time ahead of the clock counts as now; the thread goes idle as any other", async () => {
  const t = await makeListener();
  const f = join(t.projectDir, "s1.jsonl");
  const future = line("prompt", { i: 0, text: "from the future" });
  future.timestamp = "2031-01-01T00:00:00.000Z";
  writeFileSync(f, jsonl([future, line("tool", { i: 1 })]));
  const before = Date.now();
  await t.readNow(f, true);
  const s = t.listener.store.getSession("s1")!;
  assert.ok(Date.parse(s.lastEventAt) <= Date.now() && Date.parse(s.lastEventAt) >= before, s.lastEventAt);
  // Older times in another format still compare as times, not as strings.
  t.dbs.db.prepare(`UPDATE sessions SET last_event_at = ? WHERE id = 's1'`).run(new Date(Date.now() - 10 * 60_000).toISOString());
  assert.equal(t.listener.store.getSession("s1")!.status, "idle");
  t.dbs.db.prepare(`UPDATE sessions SET last_event_at = 'not a time' WHERE id = 's1'`).run();
  assert.equal(t.listener.store.getSession("s1")!.status, "idle");
  await t.close();
});

test("text after a NUL character is kept, the NUL shown as ␀, the same in the steps JSON", async () => {
  const t = await makeListener();
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([line("prompt", { i: 0, text: "go" }), line("text", { i: 1, text: "before\u0000after" })]));
  await t.readNow(f, true);
  const steps = t.listener.store.listSteps("s1");
  assert.equal(steps[1].text, "before␀after");
  assert.equal(t.listener.store.listStepsJson("s1"), JSON.stringify(steps));
  await t.close();
});

test("a command's file edits waiting for the mapper are stored, without a diff, when the server stops", async () => {
  const ROOT = "/work/demo-repo";
  const t = await makeListener({ root: ROOT });
  t.live();
  const f = join(t.projectDir, "s1.jsonl");
  writeFileSync(f, jsonl([line("prompt", { i: 0, text: "go" }),
    line("tool", { i: 1, tool: "Bash", input: { command: "echo hi > out.txt" }, id: "c1" }),
    line("result", { i: 2, input: "tu_c1", text: "" })]));
  await t.readNow(f);
  assert.equal(t.listener.store.listSteps("s1").filter((s) => s.kind === "edit").length, 0, "still waiting");
  await t.listener.onModuleDestroy();
  const edits = t.listener.store.listSteps("s1").filter((s) => s.kind === "edit");
  assert.deepEqual(edits.map((e) => e.filePath), [`${ROOT}/out.txt`]);
  assert.equal(edits[0].diff, undefined);
  await t.close();
});

/** Wait for the backfill (history read) to end. */
async function backfilled(L: TestListener["listener"]) {
  await new Promise((r) => setImmediate(r));
  while (L.tailer.historyEnd.size || L.tailer.reading.size) await new Promise((r) => setTimeout(r, 10));
}

test("history reads a thread's own log and its subagents' together, in time order, whichever file is newer", async () => {
  for (const newer of ["main", "subagent"]) {
    const t = await makeListener();
    const L = t.listener;
    const main = join(t.projectDir, "S.jsonl");
    const sub = join(t.projectDir, "S", "subagents", "agent-a1.jsonl");
    mkdirSync(join(t.projectDir, "S", "subagents"), { recursive: true });
    const side = (l: LogLine) => ({ ...l, isSidechain: true, agentId: "a1" });
    writeFileSync(main, jsonl([line("prompt", { sessionId: "S", i: 0, text: "main ask" }), line("tool", { sessionId: "S", i: 2, tool: "Task" }), line("text", { sessionId: "S", i: 5, text: "final answer" })]));
    writeFileSync(sub, jsonl([side(line("prompt", { sessionId: "S", i: 1, text: "SUBAGENT-BRIEF look at the API" })), side(line("text", { sessionId: "S", i: 3, text: "sub 3" })), side(line("text", { sessionId: "S", i: 4, text: "sub 4" }))]));
    const old = new Date(Date.now() - 3600_000);
    utimesSync(newer === "main" ? sub : main, old, old);
    t.inner.backfillForNewFilter();
    await backfilled(L);
    const steps = L.store.listSteps("S");
    assert.deepEqual(steps.map((s) => s.text ?? s.tool), ["main ask", "SUBAGENT-BRIEF look at the API", "Task", "sub 3", "sub 4", "final answer"], newer);
    assert.deepEqual(steps.map((s) => s.seq), [0, 1, 2, 3, 4, 5]);
    const s = L.store.getSession("S")!;
    assert.equal(s.title, "main ask");
    assert.equal(s.startedAt, steps[0].ts);
    const notices = t.sent.filter((m) => m.type === "steps-stored");
    assert.deepEqual(notices.at(-1), { type: "steps-stored", sessionId: "S", lastSeq: 5 }, "the pages are told the thread's last seq");
    await t.close();
  }
});

test("a log cut short or replaced: its steps go, it's read from the start; steps that come back keep their seq", async () => {
  const t = await makeListener();
  const f = join(t.projectDir, "s1.jsonl");
  const lines = own("s1", "x", 5);
  writeFileSync(f, jsonl(lines));
  await t.readNow(f, true);
  // Cut short to two lines, and one more written: the cut ones go, the two kept keep 0 and 1, the new one comes after.
  writeFileSync(f, jsonl([...lines.slice(0, 2), ...own("s1", "y", 1, 5)]));
  await t.readNow(f);
  assert.deepEqual(stepsOf(t, "s1").map((s) => [s.text, s.seq]), [["x 0", 0], ["x 1", 1], ["y 0", 5]]);
  assert.equal(offsetOf(t, f), statSync(f).size);
  // Replaced by another file, longer, with another first line: read from its start, nothing of the old one left.
  const tmp = f + ".new";
  writeFileSync(tmp, jsonl(own("s1", "z", 8, 10)));
  renameSync(tmp, f);
  await t.readNow(f);
  assert.deepEqual(stepsOf(t, "s1").map((s) => s.text), ["z 0", "z 1", "z 2", "z 3", "z 4", "z 5", "z 6", "z 7"]);
  // Same inode, same size, another first line (rewritten in place).
  const before = stepsOf(t, "s1");
  const again = own("s1", "w", 8, 20).map((l) => ({ ...l, timestamp: l.timestamp }));
  writeFileSync(f, jsonl(again));
  await t.readNow(f);
  assert.ok(stepsOf(t, "s1").every((s) => s.text.startsWith("w")), "the rewritten log's steps only");
  assert.ok(Math.min(...stepsOf(t, "s1").map((s) => s.seq)) > Math.max(...before.map((s) => s.seq)), "new steps, new seqs");
  await t.close();
});

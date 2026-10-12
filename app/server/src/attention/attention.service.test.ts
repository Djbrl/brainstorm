// Attention on a mocked clock: Date and the service's sweep timer (set for the next deadline) are node:test's mock timers, so "quiet for
// 3 hours" is a jump of the clock and a sweep is the real timer firing, not a call into the service's private sweep().
import "reflect-metadata";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import type { Attention, Step, WsMessage } from "../shared/contract";
import { AttentionService } from "./attention.service";

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const NOW = Date.parse("2026-10-01T12:00:00.000Z");

function setup(ctx: TestContext, visible = ["a", "b"]) {
  ctx.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  process.env.RUNDOWN_DATA_DIR = mkdtempSync(join(tmpdir(), "bs-attention-"));
  const dbs = new DbService();
  const sent: Attention[] = [];
  const bus = new BusService();
  const gateway = { broadcast: (m: WsMessage) => { if (m.type === "attention") sent.push(m.attention); } };
  let listed = 0;
  const listener = { listSessions: () => { listed++; return visible.map((id) => ({ id })); } };
  const att = new AttentionService(bus, gateway as any, listener as any, dbs);
  att.onModuleInit(); // the bus wiring and the sweep timer (a mock one)
  ctx.after(() => att.onModuleDestroy());
  const session = (id: string, at: string) => dbs.db.prepare(`INSERT OR REPLACE INTO sessions (id, cwd, title, started_at, last_event_at) VALUES (?, '/r', 't', ?, ?)`).run(id, at, at);
  let seq = 0;
  const store = (s: Partial<Step> & { sessionId: string; kind: Step["kind"]; ts: string }) => {
    const id = s.id ?? `st${seq}`;
    dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, text, tool, input, tool_use_id, is_subagent, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.sessionId, seq++, s.ts, s.kind, s.text ?? null, s.tool ?? null, s.input ? JSON.stringify(s.input) : null, s.toolUseId ?? null, s.isSubagent ? 1 : 0, s.agentId ?? null);
    return { ...s, id, seq: seq - 1 } as Step;
  };
  // The sweep runs at the next moment a thread can change by itself (a deadline timer): this fires it once.
  const nextSweep = () => (att as unknown as { timerAt: number }).timerAt;
  return { att, sent, store, session, listed: () => listed, /** The sweep timer fires once. */
    sweep: () => ctx.mock.timers.tick(Number.isFinite(nextSweep()) ? Math.max(0, nextSweep() - Date.now()) : 0),
    /** The clock jumps (no sweep runs on the way). */
    later: (ms: number) => ctx.mock.timers.setTime(Date.now() + ms),
    bus };
}

test("catch-up reads the newest 600 steps, oldest first", (ctx) => {
  const { att, store, session } = setup(ctx);
  session("a", iso(5_000));
  store({ sessionId: "a", kind: "prompt", text: "go", ts: iso(60_000) });
  for (let i = 0; i < 700; i++) {
    store({ sessionId: "a", kind: "tool_call", tool: "Bash", toolUseId: `t${i}`, ts: iso(50_000) });
    store({ sessionId: "a", kind: "tool_result", text: "ok", toolUseId: `t${i}`, ts: iso(50_000) });
  }
  store({ sessionId: "a", kind: "text", text: "Done.", ts: iso(10_000) });
  const t = (att as any).tracker("a");
  assert.equal(t.pending.pending().length, 0);
  assert.equal(t.lastMain.kind, "text");
  assert.equal(att.list()[0]?.state, "done");
});

test("the sweep turns a quiet instant call into a guessed permission, and only re-reads the thread list when needed", (ctx) => {
  const { sent, store, session, sweep, listed } = setup(ctx);
  session("a", iso(10_000));
  store({ sessionId: "a", kind: "prompt", text: "edit it", ts: iso(20_000) });
  store({ sessionId: "a", kind: "edit", tool: "Edit", toolUseId: "e1", ts: iso(20_000) });
  sweep(); sweep(); sweep();
  assert.deepEqual(sent.map((a) => [a.state, a.sure]), [["permission", false]]);
  assert.equal(listed(), 1);
  session("b", iso(1_000)); // already in the workspace's list: nothing to re-read
  sweep();
  assert.equal(listed(), 1);
  session("c", iso(1_000)); // a thread we haven't seen: the list is read again, once
  sweep(); sweep();
  assert.equal(listed(), 2);
});

test("catch-up from the store keeps which subagent is waiting", (ctx) => {
  const { sent, store, session, sweep } = setup(ctx);
  session("a", iso(10_000));
  store({ sessionId: "a", kind: "prompt", text: "go", ts: iso(30_000) });
  store({ sessionId: "a", kind: "edit", tool: "Edit", toolUseId: "r1", isSubagent: true, agentId: "ag7", ts: iso(20_000) });
  sweep();
  assert.deepEqual(sent.map((a) => [a.state, a.agentId]), [["permission", "ag7"]]);
});

test("a long read, search or web fetch is work, not a permission prompt (the model looks at an image for a minute)", (ctx) => {
  const { att, store, session } = setup(ctx);
  session("a", iso(90_000));
  store({ sessionId: "a", kind: "prompt", text: "look at these", ts: iso(90_000) });
  store({ sessionId: "a", kind: "tool_call", tool: "Read", filePath: "/r/shot.png", toolUseId: "r1", ts: iso(60_000) });
  store({ sessionId: "a", kind: "tool_call", tool: "WebFetch", toolUseId: "w1", ts: iso(60_000) });
  assert.equal(att.list().find((a) => a.sessionId === "a")?.state ?? "working", "working");
});

test("with the plugin's hooks heard, a held edit isn't guessed to be a prompt (the hook would have said)", (ctx) => {
  const { att, store, session } = setup(ctx);
  att.signal({ event: "UserPromptSubmit", session_id: "other" });
  session("a", iso(30_000));
  store({ sessionId: "a", kind: "prompt", text: "edit it", ts: iso(30_000) });
  store({ sessionId: "a", kind: "edit", tool: "Edit", toolUseId: "e1", ts: iso(20_000) });
  assert.notEqual(att.list().find((a) => a.sessionId === "a")?.state, "permission");
});

test("threads outside the workspace are left out of the sweep", (ctx) => {
  const { sent, store, session, sweep } = setup(ctx, ["a"]);
  session("x", iso(10_000));
  store({ sessionId: "x", kind: "edit", tool: "Edit", toolUseId: "e1", ts: iso(10_000) });
  sweep();
  assert.equal(sent.length, 0);
});

test("three failures of the same tool make a thread stuck; working steps in between send nothing", (ctx) => {
  const { sent, store, session, bus } = setup(ctx);
  session("a", iso(0));
  bus.emit("step", store({ sessionId: "a", kind: "prompt", text: "test", ts: iso(0) }));
  for (let i = 0; i < 3; i++) {
    bus.emit("step", store({ sessionId: "a", kind: "tool_call", tool: "Bash", toolUseId: `b${i}`, ts: iso(0) }));
    bus.emit("step", store({ sessionId: "a", kind: "tool_result", text: "Exit code 1\nfailed", input: { isError: true }, toolUseId: `b${i}`, ts: iso(0) }));
  }
  assert.deepEqual(sent.map((a) => a.state), ["working", "stuck"]);
});

test("a finished thread quiet past the forget window is dropped, after telling pages it's idle", (ctx) => {
  const { att, sent, store, session, sweep, later } = setup(ctx);
  session("a", iso(0));
  store({ sessionId: "a", kind: "prompt", text: "go", ts: iso(0) });
  att.signal({ event: "Stop", session_id: "a" });
  sweep();
  assert.equal((att as any).trackers.has("a"), true); // just finished: kept
  later(3 * 60 * 60_000); // three quiet hours
  sweep();
  assert.equal((att as any).trackers.has("a"), false);
  assert.deepEqual(sent.map((a) => a.state), ["done", "idle"]);
});

test("a question still waiting is kept past the forget window", (ctx) => {
  const { att, store, session, sweep, later } = setup(ctx);
  session("a", iso(0));
  store({ sessionId: "a", kind: "tool_call", tool: "AskUserQuestion", toolUseId: "q1", input: { questions: [{ question: "Which?" }] }, ts: iso(0) });
  att.signal({ event: "Notification", session_id: "a", notification_type: "elicitation" });
  later(3 * 60 * 60_000);
  sweep();
  assert.equal((att as any).trackers.has("a"), true);
});

test("mid-turn and quiet is thinking (past the 2 minutes that made it idle, up to 5); a Stop ends it", (ctx) => {
  const { att, store, session } = setup(ctx);
  session("a", iso(4 * 60_000));
  store({ sessionId: "a", kind: "prompt", text: "plan it", ts: iso(4 * 60_000) });   // asked 4 minutes ago, nothing since
  session("b", iso(3 * 60_000));
  store({ sessionId: "b", kind: "prompt", text: "fix it", ts: iso(4 * 60_000) });
  store({ sessionId: "b", kind: "tool_call", tool: "Bash", toolUseId: "b1", ts: iso(3 * 60_000) });
  store({ sessionId: "b", kind: "tool_result", text: "ok", toolUseId: "b1", ts: iso(3 * 60_000) }); // a result, then the model thinks
  session("c", iso(10 * 60_000));
  store({ sessionId: "c", kind: "prompt", text: "old", ts: iso(10 * 60_000) });     // closed mid-turn 10 minutes ago
  const by = () => Object.fromEntries(att.list().map((a) => [a.sessionId, a.state]));
  assert.deepEqual(by(), { a: "thinking", b: "thinking" });
  att.signal({ event: "Stop", session_id: "a" });
  assert.equal(by().a, "done");
});

test("a permission prompt's command is shown and broadcast with its secrets masked", (ctx) => {
  const { att, sent, session } = setup(ctx);
  session("a", iso(1_000));
  const key = "sk-ant-api03-FAKEFAKEFAKEFAKE0123456789";
  att.signal({ event: "PermissionRequest", session_id: "a", tool_name: "Bash", tool_input: { command: `curl -H "x-api-key: ${key}" https://api.example.com/v1/models` }, tool_use_id: "tu1" });
  assert.ok(sent.length > 0);
  assert.ok(!JSON.stringify(sent).includes("FAKEFAKE") && !JSON.stringify(att.list()).includes("FAKEFAKE"), JSON.stringify(att.list()));
  assert.match(att.list()[0]?.detail ?? "", /curl -H "x-api-key: \[redacted\]" https:\/\/api\.example\.com/);
});

test("a permission prompt survives a project switch and a restart, until the log moves on", (ctx) => {
  const { att, store, session, bus } = setup(ctx);
  session("a", iso(5_000));
  store({ sessionId: "a", kind: "tool_call", tool: "Bash", toolUseId: "t1", input: { command: "rm -rf build" }, ts: iso(5_000) });
  att.signal({ event: "PermissionRequest", session_id: "a", tool_name: "Bash", tool_use_id: "t1" });
  bus.emit("workspace", { root: "/elsewhere" });
  assert.equal(att.hookOf("a")?.event, "PermissionRequest");
  // A new server on the same database: the hook was stored.
  const again = new AttentionService(new BusService(), { broadcast: () => {} } as any, { listSessions: () => [{ id: "a" }] } as any, (att as any).dbs);
  again.onModuleInit();
  assert.equal(again.hookOf("a")?.event, "PermissionRequest");
  // Answered before that restart (the call's result is in the log): not waiting any more.
  store({ sessionId: "a", kind: "tool_result", toolUseId: "t1", ts: iso(0) });
  const third = new AttentionService(new BusService(), { broadcast: () => {} } as any, { listSessions: () => [{ id: "a" }] } as any, (att as any).dbs);
  third.onModuleInit();
  assert.equal(third.hookOf("a"), undefined);
});

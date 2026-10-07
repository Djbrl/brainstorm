// Run: npx tsc -p . && node --test dist/
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import type { Attention, Step, WsMessage } from "../types";
import { AttentionService } from "./attention.service";

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function setup(visible = ["a", "b"]) {
  process.env.RUNDOWN_DATA_DIR = mkdtempSync(join(tmpdir(), "bs-attention-"));
  const dbs = new DbService();
  dbs.db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, cwd TEXT NOT NULL, title TEXT NOT NULL, started_at TEXT NOT NULL, last_event_at TEXT NOT NULL)`);
  dbs.db.exec(`CREATE TABLE steps (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, kind TEXT NOT NULL,
    text TEXT, tool TEXT, input TEXT, file_path TEXT, diff TEXT, label TEXT, risk TEXT, is_subagent INTEGER NOT NULL DEFAULT 0, tool_use_id TEXT, agent_id TEXT)`);
  const sent: Attention[] = [];
  const bus = new BusService();
  const gateway = { broadcast: (m: WsMessage) => { if (m.type === "attention") sent.push(m.attention); } };
  let listed = 0;
  const listener = { listSessions: () => { listed++; return visible.map((id) => ({ id })); } };
  const att = new AttentionService(bus, gateway as any, listener as any, dbs);
  att.onModuleInit(); // the bus wiring (its sweep timer is unref'd)
  const session = (id: string, at: string) => dbs.db.prepare(`INSERT OR REPLACE INTO sessions VALUES (?, '/r', 't', ?, ?)`).run(id, at, at);
  let seq = 0;
  const store = (s: Partial<Step> & { sessionId: string; kind: Step["kind"]; ts: string }) => {
    const id = s.id ?? `st${seq}`;
    dbs.db.prepare(`INSERT INTO steps (id, session_id, seq, ts, kind, text, tool, input, tool_use_id, is_subagent, agent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, s.sessionId, seq++, s.ts, s.kind, s.text ?? null, s.tool ?? null, s.input ? JSON.stringify(s.input) : null, s.toolUseId ?? null, s.isSubagent ? 1 : 0, s.agentId ?? null);
    return { ...s, id, seq: seq - 1 } as Step;
  };
  return { att, sent, store, session, listed: () => listed, sweep: () => (att as any).sweep(), bus };
}

test("catch-up reads the newest 600 steps, oldest first", () => {
  const { att, store, session } = setup();
  session("a", iso(5_000));
  store({ sessionId: "a", kind: "prompt", text: "go", ts: iso(60_000) });
  for (let i = 0; i < 700; i++) {
    store({ sessionId: "a", kind: "tool_call", tool: "Bash", toolUseId: `t${i}`, ts: iso(50_000) });
    store({ sessionId: "a", kind: "tool_result", text: "ok", toolUseId: `t${i}`, ts: iso(50_000) });
  }
  store({ sessionId: "a", kind: "text", text: "Done.", ts: iso(10_000) });
  const t = (att as any).tracker("a");
  assert.equal(t.pending.size, 0);
  assert.equal(t.lastMain.kind, "text");
  assert.equal(att.list()[0]?.state, "done");
});

test("the sweep turns a quiet instant call into a guessed permission, and only re-reads the thread list when needed", () => {
  const { sent, store, session, sweep, listed } = setup();
  session("a", iso(10_000));
  store({ sessionId: "a", kind: "prompt", text: "edit it", ts: iso(10_000) });
  store({ sessionId: "a", kind: "edit", tool: "Edit", toolUseId: "e1", ts: iso(10_000) });
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

test("catch-up from the store keeps which subagent is waiting", () => {
  const { sent, store, session, sweep } = setup();
  session("a", iso(10_000));
  store({ sessionId: "a", kind: "prompt", text: "go", ts: iso(20_000) });
  store({ sessionId: "a", kind: "tool_call", tool: "Read", toolUseId: "r1", isSubagent: true, agentId: "ag7", ts: iso(10_000) });
  sweep();
  assert.deepEqual(sent.map((a) => [a.state, a.agentId]), [["permission", "ag7"]]);
});

test("threads outside the workspace are left out of the sweep", () => {
  const { sent, store, session, sweep } = setup(["a"]);
  session("x", iso(10_000));
  store({ sessionId: "x", kind: "edit", tool: "Edit", toolUseId: "e1", ts: iso(10_000) });
  sweep();
  assert.equal(sent.length, 0);
});

test("three failures of the same tool make a thread stuck; working steps in between send nothing", () => {
  const { sent, store, session, bus } = setup();
  session("a", iso(0));
  bus.emit("step", store({ sessionId: "a", kind: "prompt", text: "test", ts: iso(0) }));
  for (let i = 0; i < 3; i++) {
    bus.emit("step", store({ sessionId: "a", kind: "tool_call", tool: "Bash", toolUseId: `b${i}`, ts: iso(0) }));
    bus.emit("step", store({ sessionId: "a", kind: "tool_result", text: "Exit code 1\nfailed", input: { isError: true }, toolUseId: `b${i}`, ts: iso(0) }));
  }
  assert.deepEqual(sent.map((a) => a.state), ["working", "stuck"]);
});

test("a finished thread quiet past the forget window is dropped, after telling pages it's idle", () => {
  const { att, sent, store, session, sweep } = setup();
  session("a", iso(3 * 60 * 60_000));
  store({ sessionId: "a", kind: "prompt", text: "go", ts: iso(3 * 60 * 60_000) });
  att.signal({ event: "Stop", session_id: "a" });
  const hook = (att as any).trackers.get("a").hook;
  hook.at = Date.now() - 3 * 60 * 60_000; // the Stop came long ago
  sweep();
  assert.equal((att as any).trackers.has("a"), false);
  assert.deepEqual(sent.map((a) => a.state), ["done", "idle"]);
});

test("a question still waiting is kept past the forget window", () => {
  const { att, store, session, sweep } = setup();
  session("a", iso(3 * 60 * 60_000));
  store({ sessionId: "a", kind: "tool_call", tool: "AskUserQuestion", toolUseId: "q1", input: { questions: [{ question: "Which?" }] }, ts: iso(3 * 60 * 60_000) });
  att.signal({ event: "Notification", session_id: "a", notification_type: "elicitation" });
  (att as any).trackers.get("a").hook = undefined;
  sweep();
  assert.equal((att as any).trackers.has("a"), true);
});

test("mid-turn and quiet is thinking (past the 2 minutes that made it idle, up to 5); a Stop ends it", () => {
  const { att, store, session } = setup();
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

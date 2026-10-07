// Run: npx tsc -p . && node --test dist/
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { BusService } from "../core/bus.service";
import type { AgentPresence, Session, Step, WsMessage } from "../types";
import { AgentsService } from "./agents.service";

function setup() {
  const bus = new BusService();
  const sent: AgentPresence[] = [];
  const gateway = { broadcast: (m: WsMessage) => { if (m.type === "agent") sent.push(m.agent); } };
  let title = "Tidy the docs";
  let lookups = 0;
  const listener = { getSession: () => { lookups++; return { title } as Session; } };
  const agents = new AgentsService(bus, { defaultRoot: "/r", claudeProjectsDir: "/nonexistent" } as any, gateway as any, listener as any);
  agents.onModuleInit(); // the bus wiring (its sweep timer is unref'd)
  let seq = 0;
  const step = (p: Partial<Step>): Step => ({ id: `s${seq}`, sessionId: "a", seq: seq++, ts: new Date().toISOString(), kind: "tool_call", ...p });
  return { bus, sent, agents, step, lookups: () => lookups, retitle: (t: string) => { title = t; } };
}

test("only changes and a once-a-second pulse are broadcast; the session name is looked up once", () => {
  const { bus, sent, step, lookups } = setup();
  bus.emit("step", step({ tool: "Read", filePath: "/r/a.ts" }));
  bus.emit("step", step({ kind: "edit", tool: "Edit", filePath: "/r/a.ts" }));
  for (let i = 0; i < 20; i++) bus.emit("step", step({ tool: "Bash", input: { command: "ls" } }));
  // The first Bash step says what it does now (off the map); the rest only moved the time, within a second.
  assert.deepEqual(sent.map((a) => a.away ?? a.action), ["read", "edit", "Running a command"]);
  assert.equal(lookups(), 1);
  bus.emit("step", step({ tool: "Read", filePath: "/r/b.ts" }));
  assert.equal(sent.at(-1)?.file, "/r/b.ts");
  assert.equal(sent.at(-1)?.away, undefined); // back on the map
});

test("a ts-only update goes out once a second has passed", () => {
  const { bus, sent, agents, step } = setup();
  bus.emit("step", step({ tool: "Read", filePath: "/r/a.ts" }));
  (agents as any).sentAt.set("a", Date.now() - 1_500);
  bus.emit("step", step({ tool: "Bash" }));
  assert.equal(sent.length, 2);
});

test("a renamed session is looked up again", () => {
  const { bus, sent, step, lookups, retitle } = setup();
  bus.emit("step", step({ tool: "Read", filePath: "/r/a.ts" }));
  retitle("Fix the camera");
  bus.emit("session", { id: "a" } as Session);
  bus.emit("step", step({ tool: "Bash" }));
  assert.equal(lookups(), 2);
  assert.equal(sent.at(-1)?.name, "Fix the camera");
});

test("a subagent shows as soon as it acts, named after its first prompt; off the map, it says what it does", () => {
  const { bus, sent, step } = setup();
  bus.emit("step", step({ agentId: "sub1", isSubagent: true, kind: "prompt", text: "Find where the camera is set up" }));
  assert.equal(sent.length, 0); // a prompt alone isn't doing anything yet
  bus.emit("step", step({ agentId: "sub1", isSubagent: true, tool: "Bash" }));
  assert.equal(sent.at(-1)?.name, "Subagent · Find where the camera is set up");
  assert.equal(sent.at(-1)?.away, "Running a command");
  assert.equal(sent.at(-1)?.file, undefined);
  bus.emit("step", step({ agentId: "sub1", isSubagent: true, tool: "Read", filePath: "/tmp/shot.png" }));
  assert.equal(sent.at(-1)?.away, "Reading a file outside the project");
  bus.emit("step", step({ agentId: "sub1", isSubagent: true, tool: "Read", filePath: "/r/camera.ts" }));
  assert.equal(sent.at(-1)?.file, "/r/camera.ts");
  assert.equal(sent.at(-1)?.away, undefined);
});

test("errors are sent at once", () => {
  const { bus, sent, step } = setup();
  bus.emit("step", step({ tool: "Read", filePath: "/r/a.ts" }));
  bus.emit("step", step({ kind: "tool_result", text: "<tool_use_error>File does not exist</tool_use_error>" }));
  assert.equal(sent.length, 2);
  assert.equal(sent[1].error, "File does not exist");
});

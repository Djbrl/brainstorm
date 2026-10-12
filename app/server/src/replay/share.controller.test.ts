import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Replay, Session, Step } from "../shared/contract";
import { ShareController } from "./share.controller";

test("a share carries no Ask answers, and its file name comes from the masked title", async () => {
  const session = { id: "s1", cwd: "/tmp/p", title: "use ghp_FAKEfakeFAKEfake0123456789abcd to push", startedAt: "2026-10-11T10:00:00Z", lastEventAt: "", status: "idle", harness: "claude" } satisfies Session;
  const steps = [{ id: "st1", sessionId: "s1", seq: 0, ts: "", kind: "prompt", text: "hi" }] satisfies Step[];
  const replays = { build: async () => ({ steps, sessions: [session], answers: [{ request: { question: "Why?", stepId: "st1" }, response: { answer: "Because" } }] }) as unknown as Replay };
  const ctl = new ShareController({ getSession: () => session, listSessions: () => [session], listSteps: () => steps }, replays, { bump() {} }, { root: "/tmp/p" });
  const headers: Record<string, string> = {};
  let body: any;
  await ctl.share("s1", "json", { setHeader: (k: string, v: string) => { headers[k] = v; }, json: (b: unknown) => { body = b; } } as any);
  assert.deepEqual(body.answers, []);
  assert.ok(!headers["Content-Disposition"].includes("FAKE"), headers["Content-Disposition"]);
  assert.match(headers["Content-Disposition"], /rundown-use-redacted-to-push-2026-10-11\.json/);
});

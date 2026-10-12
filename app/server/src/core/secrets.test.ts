import { test } from "node:test";
import assert from "node:assert/strict";
import { hookCheck, hookSignature, shareSecret } from "./secrets";

test("hook signatures: refused while the secret isn't shared (no server.json), then checked for key, body and age", () => {
  const body = Buffer.from(`{"event":"Stop","session_id":"a"}`), now = 1_800_000_000_000, ts = String(now);
  assert.equal(hookCheck(ts, hookSignature(ts, body), body, now), "no-secret"); // fail closed
  shareSecret();
  assert.equal(hookCheck(ts, hookSignature(ts, body), body, now), "ok");
  assert.equal(hookCheck(undefined, undefined, body, now), "unsigned");
  assert.equal(hookCheck(ts, hookSignature(ts, "{}"), body, now), "bad");
  assert.equal(hookCheck(ts, "nonsense", body, now), "bad");
  assert.equal(hookCheck(ts, hookSignature(ts, body), body, now + 2 * 60_000 + 1), "stale");
  assert.equal(hookCheck(ts, hookSignature(ts, body), body, now - 2 * 60_000 - 1), "stale");
});

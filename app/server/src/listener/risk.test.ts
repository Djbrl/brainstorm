import { test } from "node:test";
import assert from "node:assert/strict";
import { riskOf } from "./risk";

const edit = (filePath: string, diff?: { before: string; after: string }) => ({ kind: "edit" as const, filePath, diff });

test("risk flags: .env, auth, payment, a deleted test, a large deletion, a possible secret; none for an ordinary edit", () => {
  assert.deepEqual(riskOf(edit("/r/.env.local")), ["touches .env"]);
  assert.deepEqual(riskOf(edit("/r/src/auth/login.ts")), ["touches auth"]);
  assert.deepEqual(riskOf(edit("/r/src/billing.ts")), ["touches payment"]);
  assert.deepEqual(riskOf(edit("/r/a.test.ts", { before: "x".repeat(100), after: "y" })), ["deleted test"]);
  assert.deepEqual(riskOf(edit("/r/a.ts", { before: "l\n".repeat(80), after: "" })), ["large deletion"]);
  assert.deepEqual(riskOf(edit("/r/a.ts", { before: "", after: "const k = 'AKIAABCDEFGHIJKLMNOP'" })), ["possible secret"]);
  assert.equal(riskOf(edit("/r/src/todo.ts", { before: "a", after: "b" })), undefined);
  assert.equal(riskOf({ kind: "tool_call", filePath: "/r/.env" }), undefined);
});

// Ask's context: what goes to the model (the steps before, the step, its diff, an excerpt of the file), and what never
// does (a file outside the project, secrets). Claude is a fake that records the prompt.
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session, Step } from "../shared/contract";
import { DbService } from "../core/db.service";
import { AskService, endAtSentence } from "./ask.service";

const base = realpathSync(mkdtempSync(join(tmpdir(), "rundown-ask-")));
process.env.RUNDOWN_DATA_DIR = join(base, "data");
const root = join(base, "shop");
mkdirSync(join(root, "src", "cart"), { recursive: true });
const lines = Array.from({ length: 400 }, (_, i) => `const line${i} = ${i};`);
lines[300] = "export function addToCart(item) { return [...cart, item]; }";
writeFileSync(join(root, "src", "cart", "cart.ts"), lines.join("\n"));
writeFileSync(join(base, "outside.txt"), "the neighbour's diary");

const step = (p: Partial<Step>): Step => ({ id: "s3", sessionId: "t1", seq: 3, ts: "2026-10-01T12:00:00.000Z", kind: "edit", tool: "Edit", ...p });

function setup({ fail = false, cut = false, key = "" } = {}) {
  const prompts: string[] = [];
  const bumps: string[] = [];
  const edit = step({ filePath: join(root, "src", "cart", "cart.ts"), diff: { before: "old", after: "export function addToCart(item) { return [...cart, item]; }" } });
  const before = [
    step({ id: "s1", seq: 1, kind: "prompt", tool: undefined, text: "make the cart keep items, token sk-ant-api03-FAKEFAKEFAKEFAKEFAKE0123456789" }),
    step({ id: "s2", seq: 2, kind: "tool_call", tool: "Read", filePath: join(root, "src", "cart", "cart.ts") }),
  ];
  const ask = new AskService(
    new DbService(),
    { claude: { key, model: "claude-test" } },
    { root },
    {
      getStep: (id) => (id === edit.id ? edit : undefined),
      listSessions: () => [{ id: "t1", cwd: root } as Session],
      stepsBefore: () => before,
    },
    { complete: async (_system, user) => { prompts.push(user); if (fail) throw new Error("offline"); return { text: "It adds an item to the cart and returns the new list. Then it saves. And", model: "claude-sonnet-test", tokensIn: 1000, tokensOut: 200, cut }; } },
    { bump: (k) => { bumps.push(k); } },
  );
  return { ask, prompts, bumps };
}

test("the context holds the steps before, the step, its diff and an excerpt around the change", async () => {
  const { ask, prompts, bumps } = setup();
  const res = await ask.ask({ question: "What does this change do?", stepId: "s3" });
  assert.equal(res.fallback, false);
  assert.equal(res.costUsd, +((1000 * 3 + 200 * 15) / 1e6).toFixed(6)); // sonnet pricing
  assert.deepEqual(bumps, ["ak"]);
  const p = prompts[0];
  assert.match(p, /## What the agent did just before\n- \[prompt\] make the cart keep items/);
  assert.match(p, /## The step in question\n\[edit .*cart\.ts\]/);
  assert.match(p, /## Its diff\n--- before\nold\n\+\+\+ after\nexport function addToCart/);
  assert.match(p, /## File: src\/cart\/cart\.ts \(module src\/cart\)/);
  assert.match(p, /## Excerpt \(lines 261-410 of 400\)|## Excerpt \(lines 261-400 of 400\)/); // 40 lines above the change
  assert.ok(p.includes("301: export function addToCart"), "the changed line is in the excerpt");
  assert.ok(!p.includes("1: const line0 "), "the excerpt starts near the change, not at the top");
  assert.ok(p.endsWith("## Question\nWhat does this change do?"));
  assert.ok(!p.includes("FAKEFAKE"), "secrets are masked before the context leaves");
});

test("a file outside the project and the threads' folders never goes to the model; a relative one is the project's", async () => {
  const { ask, prompts } = setup();
  await ask.ask({ question: "Q1", filePath: join(base, "outside.txt") });
  assert.ok(!prompts[0].includes("diary") && !prompts[0].includes("## File"), prompts[0]);
  await ask.ask({ question: "Q2", filePath: "src/cart/cart.ts" });
  assert.match(prompts[1], /## File: src\/cart\/cart\.ts/);
  assert.match(prompts[1], /## Excerpt \(lines 1-150 of 400\)/); // no step: from the top
});

test("the same question on the same unchanged target is answered from the cache", async () => {
  const { ask, prompts } = setup();
  const a = await ask.ask({ question: "Why the spread?", stepId: "s3" });
  const b = await ask.ask({ question: "Why the spread?", stepId: "s3" });
  assert.equal(prompts.length, 1);
  assert.deepEqual(b, a);
  assert.ok(ask.listAnswers().some((r) => r.request.question === "Why the spread?"));
});

test("no question, no call; Claude unreachable says what to do; a cut answer ends at a sentence", async () => {
  const empty = setup();
  assert.equal((await empty.ask.ask({ question: "   " })).model, "none");
  assert.equal(empty.prompts.length, 0);
  const down = await setup({ fail: true }).ask.ask({ question: "Q-down" });
  assert.equal(down.fallback, true);
  assert.match(down.answer, /add an Anthropic API key/);
  const keyed = await setup({ fail: true, key: "test-key" }).ask.ask({ question: "Q-keyed" });
  assert.match(keyed.answer, /Could not reach Claude/);
  const cut = await setup({ cut: true }).ask.ask({ question: "Q-cut" });
  assert.match(cut.answer, /^It adds an item to the cart and returns the new list\.\n\n\*\(Answer shortened/);
});

test("endAtSentence keeps the last full sentence, or marks a cut", () => {
  const note = "\n\n*(Answer shortened: ask a narrower question for the rest.)*";
  assert.equal(endAtSentence("The cart keeps its items now. It also saves th"), `The cart keeps its items now.${note}`);
  assert.equal(endAtSentence("It does:\n- one thing\n- another thi"), `It does:\n- one thing${note}`);
  assert.equal(endAtSentence("No sentence end here at al"), `No sentence end here at…${note}`);
  assert.equal(endAtSentence("A. Then a long sentence without its end"), `A. Then a long sentence without its…${note}`); // a full stop too early is not used
});

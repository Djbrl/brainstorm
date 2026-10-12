// Golden tests for reading logs: synthetic Claude Code and Codex logs (fixtures/golden) are read as history and the
// threads and steps they make are compared with stored snapshots. UPDATE_GOLDEN=1 rewrites the snapshots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeListener, type TestListener } from "./helpers";

const DIR = process.env.GOLDEN_DIR ?? resolve(__dirname, "../../src/test/fixtures/golden");
const ROOT = "/work/acme-shop";
const S1 = "5e55a0a1-0000-4000-8000-000000000001";
const S2 = "5e55a0a1-0000-4000-8000-000000000002";
const CODEX = "0199c0de-0000-7000-8000-00000000c0de";

/** Every .jsonl under `dir`, deepest last (a thread's log before its subagents'). */
function logs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) continue;
    if (name.endsWith(".jsonl")) out.push(p);
  }
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...logs(p));
  }
  return out;
}

/** The threads and their steps as stable JSON: scratch paths replaced by a placeholder. */
function snapshot(t: TestListener, ids: string[]) {
  const sessions = t.listener.store.listSessions().filter((s) => ids.includes(s.id)).sort((a, b) => a.id.localeCompare(b.id));
  const data = { sessions: sessions.map((s) => ({ ...s, steps: t.listener.store.listSteps(s.id) })) };
  return JSON.parse(JSON.stringify(data).split(t.tmp).join("<tmp>"));
}

function compare(name: string, actual: unknown) {
  const file = join(DIR, `${name}.steps.json`);
  if (process.env.UPDATE_GOLDEN === "1" || !existsSync(file)) {
    writeFileSync(file, JSON.stringify(actual, null, 2) + "\n");
    if (process.env.UPDATE_GOLDEN !== "1") assert.fail(`${name}.steps.json was missing: written, check it and run again`);
    return;
  }
  assert.deepEqual(actual, JSON.parse(readFileSync(file, "utf8")), `${name} differs from its snapshot (UPDATE_GOLDEN=1 rewrites it)`);
}

test("golden: a Claude Code thread, its subagent, and a resumed thread", async () => {
  const t = await makeListener({ root: ROOT });
  cpSync(join(DIR, "claude"), t.projectDir, { recursive: true });
  for (const f of logs(t.projectDir)) await t.readNow(f, true);
  const snap = snapshot(t, [S1, S2]);
  compare("claude", snap);

  // What the snapshot has to show, so a bad rewrite can't hide a feature.
  const [one, two] = snap.sessions;
  assert.equal(one.title, "Cart rounding", "the custom title names the thread");
  const kinds = one.steps.map((s: any) => s.tool ?? s.kind);
  for (const k of ["thinking", "Read", "MultiEdit", "Write", "Edit", "Bash", "Task", "Grep"]) assert.ok(kinds.includes(k), k);
  assert.ok(one.steps.some((s: any) => s.tool === "MultiEdit" && s.diff.before.includes("\n---\n")));
  assert.ok(!one.steps.some((s: any) => /Request interrupted/.test(s.text ?? "")), "the interruption notice is no prompt");
  assert.ok(one.steps.some((s: any) => s.kind === "tool_result" && s.toolUseId === "toolu_read2"), "the image result");
  assert.ok(one.steps.filter((s: any) => s.isSubagent).every((s: any) => s.agentId === "a7c3e19f"));
  assert.ok(two.steps.some((s: any) => s.id.endsWith(`@${S2}`)), "the resumed thread's copied lines have their own ids");
  assert.ok(two.steps.some((s: any) => s.filePath === `${ROOT}/src/orders.ts`));
  await t.close();
});

test("golden: a Codex 0.150 rollout", async () => {
  const t = await makeListener({ root: ROOT });
  const dir = join(t.cfg.codexDir, "sessions", "2026", "09", "02");
  cpSync(join(DIR, "codex"), dir, { recursive: true });
  for (const f of logs(dir)) await t.readNow(f, true);
  const snap = snapshot(t, [CODEX]);
  compare("codex", snap);
  const [s] = snap.sessions;
  assert.equal(s.harness, "codex");
  const kinds = s.steps.map((x: any) => x.tool ?? x.kind);
  for (const k of ["prompt", "thinking", "text", "Read", "Edit", "Write", "Bash"]) assert.ok(kinds.includes(k), k);
  await t.close();
});

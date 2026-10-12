// Audit findings on shared files and the Markdown export that were fixed without a test of their own.
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Replay, Session, Step } from "../shared/contract";
import { ShareController } from "../replay/share.controller";
import { threadMarkdown } from "../replay/markdown";

// A scratch data folder (no one's private redaction list) and a tiny share page to pour the replay into.
const tmp = mkdtempSync(join(tmpdir(), "rundown-audit-share-"));
process.env.RUNDOWN_DATA_DIR = join(tmp, "data");
const template = join(tmp, "share.html");
writeFileSync(template, "<!doctype html><html><head><title>Rundown</title></head><body><!--rundown:replay--></body></html>");

const count = (text: string, part: string) => text.split(part).length - 1;

// Guards server-io-modules F3 (first pass; confirmed worse in verify-server-modules): $' or $& in a title spliced the page.
test("a thread title with $' or $& lands in the shared page's title as text, and the replay is poured in once", async () => {
  process.env.RUNDOWN_SHARE_TEMPLATE = template;
  const session = { id: "s1", cwd: "/work/demo-repo", title: "quote $' and $& in the sed call", startedAt: "2026-10-01T09:00:00Z", lastEventAt: "", status: "idle", harness: "claude" } satisfies Session;
  const steps = [{ id: "st1", sessionId: "s1", seq: 0, ts: "", kind: "prompt", text: "hi" }] satisfies Step[];
  const replays = { build: async () => ({ steps, sessions: [session], answers: [] }) as unknown as Replay };
  const ctl = new ShareController({ getSession: () => session, listSessions: () => [session], listSteps: () => steps }, replays, { bump() {} }, { root: "/work/demo-repo" });
  let html = "";
  await ctl.share("s1", undefined, { setHeader() {}, send: (b: string) => { html = b; } } as any);
  assert.equal(count(html, "<title>"), 1, html);
  assert.equal(count(html, 'id="rundown-replay"'), 1, html);
  assert.ok(!html.includes("<!--rundown:replay-->"), "the placeholder is replaced");
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
  assert.match(title, /^quote \$.* in the sed call · Rundown replay$/);
  assert.ok(html.indexOf('id="rundown-replay"') > html.indexOf("</title>"), "the replay is in the body, not the title");
  delete process.env.RUNDOWN_SHARE_TEMPLATE;
});

// Guards server-io-modules F23 / x-architecture "inside the root": /work/demo-repo-two is not inside /work/demo-repo.
test("the Markdown export names a file in a sibling folder by its full path, not relative to the project", () => {
  const session: Session = { id: "t1", cwd: "/work/demo-repo", title: "Notes", startedAt: "2026-10-01T09:00:00.000Z", lastEventAt: "2026-10-01T09:05:00.000Z", status: "idle", harness: "claude" };
  const s = (seq: number, p: Partial<Step>): Step => ({ id: `s${seq}`, sessionId: "t1", seq, ts: "2026-10-01T09:00:00.000Z", kind: "text", ...p });
  const md = threadMarkdown(session, [
    s(0, { kind: "prompt", text: "Write the notes" }),
    s(1, { kind: "edit", tool: "Write", filePath: "/work/demo-repo-two/notes.md", toolUseId: "u1" }),
    s(2, { kind: "edit", tool: "Write", filePath: "/work/demo-repo/inside.md", toolUseId: "u2" }),
  ], null);
  assert.ok(md.includes("`/work/demo-repo-two/notes.md`"), md);
  assert.ok(!md.includes("../demo-repo-two"), md);
  assert.ok(md.includes("`inside.md`"), md);
});

import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DbService } from "../core/db.service";
import { ShotsService } from "./shots.service";
import { ShotsController } from "./shots.controller";

test("only png, jpeg, gif and webp shots are kept, and a shot is served as an inert image", () => {
  const base = mkdtempSync(join(tmpdir(), "rd-shots-"));
  process.env.RUNDOWN_DATA_DIR = join(base, "data");
  const proj = join(base, "projects", "-tmp-x");
  mkdirSync(proj, { recursive: true });
  const img = (media_type: string) => ({ type: "image", source: { type: "base64", media_type, data: Buffer.from("x").toString("base64") } });
  writeFileSync(join(proj, "s1.jsonl"), JSON.stringify({ type: "user", uuid: "u1", sessionId: "s1", message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "t1", content: [img("text/html"), img("image/png"), img("image/svg+xml"), img("text/javascript")] }] } }) + "\n");
  const svc = new ShotsService(new DbService(), { claudeProjectsDir: join(base, "projects") } as any, { getStep: () => ({ sessionId: "s1" }) } as any);
  const ctl = new ShotsController(svc);
  const get = (idx: string) => { const h: Record<string, string> = {}; try { ctl.shot("u1:0", idx, { setHeader: (k: string, v: string) => { h[k] = v; }, end() {} } as any); return h; } catch { return null; } };
  assert.equal(get("0"), null);
  assert.equal(get("2"), null);
  assert.equal(get("3"), null);
  assert.deepEqual(get("1"), { "Content-Type": "image/png", "Content-Disposition": "inline", "Content-Security-Policy": "default-src 'none'; sandbox", "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400" });
});

test("a log is read a chunk at a time: lines cut by a chunk, a line too long to keep, and a line still being written", () => {
  const { appendFileSync } = require("node:fs") as typeof import("node:fs");
  const base = mkdtempSync(join(tmpdir(), "rd-shots-"));
  process.env.RUNDOWN_DATA_DIR = join(base, "data");
  const proj = join(base, "projects", "-tmp-x");
  mkdirSync(proj, { recursive: true });
  const shotLine = (uuid: string, pad = "") => JSON.stringify({ type: "user", uuid, sessionId: "s1", pad, message: { role: "user", content: [
    { type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from(uuid).toString("base64") } }] }] } }) + "\n";
  const file = join(proj, "s1.jsonl");
  writeFileSync(file, shotLine("a") + "{}\n" + shotLine("long", "x".repeat(5000)) + shotLine("b") + shotLine("c").slice(0, 40));
  const svc = new ShotsService(new DbService(), { claudeProjectsDir: join(base, "projects") } as any, { getStep: () => ({ sessionId: "s1" }) } as any);
  svc.chunkBytes = 97;
  svc.maxLineBytes = 1000;
  svc.scan("s1");
  const ids = () => ["a", "long", "b", "c"].filter((u) => svc.has(`${u}:0`));
  assert.deepEqual(ids(), ["a", "b"]);
  assert.equal(Buffer.from(svc.get("b:0", 0)!.data).toString(), "b");
  appendFileSync(file, shotLine("c").slice(40)); // the last line is finished
  svc.scan("s1");
  assert.deepEqual(ids(), ["a", "b", "c"]);
});

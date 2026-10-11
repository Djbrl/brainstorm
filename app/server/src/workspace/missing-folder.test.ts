// The open project's folder renamed, moved or deleted: the setup status says so (root null, missing), the folder coming
// back opens it again, and a case-only rename on a case-insensitive disk opens it under its new spelling.
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { WorkspaceService } from "./workspace.service";
import type { SetupStatus } from "../shared/contract";

Logger.overrideLogger(false);

function service(dir: string) {
  const sent: SetupStatus[] = [];
  const kept = new Map<string, string>();
  const settings = { get: (k: string) => kept.get(k) ?? null, set: (k: string, v: string) => kept.set(k, v), delete: (k: string) => kept.delete(k) };
  const cfg = { claudeProjectsDir: join(dir, "projects"), codexDir: join(dir, "codex"), claude: {} };
  const svc = new WorkspaceService(
    { emit() {}, on() {} } as never,
    { broadcast: (m: { type: string; status: SetupStatus }) => { if (m.type === "setup") sent.push(m.status); } } as never,
    cfg as never,
    { root: "", set() {} } as never,
    { codexProjects: () => new Map(), bringGuest() {} } as never,
    { getCached: () => undefined, isBuilding: () => false } as never,
    settings as never,
  );
  const check = () => (svc as unknown as { checkFolder(): void }).checkFolder();
  return { svc, sent, check };
}

test("a deleted or renamed project folder: the status says so, and it opens again when it's back", async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rd-missing-")));
  const proj = join(dir, "proj");
  mkdirSync(proj);
  const { svc, sent, check } = service(dir);
  try {
    svc.onModuleInit();
    await svc.select(proj);
    assert.equal(svc.status().root, proj);
    renameSync(proj, join(dir, "proj-renamed"));
    check();
    assert.deepEqual([svc.status().root, svc.status().missing], [null, { root: proj, name: "proj" }]);
    assert.equal(sent.at(-1)?.root, null);
    renameSync(join(dir, "proj-renamed"), proj);
    check();
    assert.equal(svc.status().root, proj);
    assert.equal(svc.status().missing, undefined);
  } finally { svc.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); }
});

test("a case-only rename on a case-insensitive disk opens the project under its new spelling", async (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "rd-case-")));
  const proj = join(dir, "Proj");
  mkdirSync(proj);
  if (!existsSync(join(dir, "proj"))) { rmSync(dir, { recursive: true, force: true }); return t.skip("case-sensitive disk"); }
  const { svc, check } = service(dir);
  try {
    svc.onModuleInit();
    await svc.select(proj);
    renameSync(proj, join(dir, "proj"));
    check();
    assert.equal(svc.status().root, join(dir, "proj"));
    assert.equal((await svc.select(join(dir, "PROJ"))).root, join(dir, "proj")); // picked with another spelling: the disk's
  } finally { svc.onModuleDestroy(); rmSync(dir, { recursive: true, force: true }); }
});

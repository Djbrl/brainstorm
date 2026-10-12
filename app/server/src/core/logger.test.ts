// The server's log: Nest's start-up list of modules and routes only at debug level, no colours with NO_COLOR.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serverLogger } from "./logger";

function capture(fn: () => void): string {
  const out: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = ((s: string) => { out.push(String(s)); return true; }) as typeof process.stdout.write;
  try { fn(); } finally { process.stdout.write = write; }
  return out.join("");
}

test("Nest's module and route lines are debug lines; the app's own lines stay", () => {
  delete process.env.RUNDOWN_DEBUG;
  const log = serverLogger(false);
  const out = capture(() => {
    log.log("Mapped {/api/health, GET} route", "RouterExplorer");
    log.log("CoreModule dependencies initialized", "InstanceLoader");
    log.log("Nest application successfully started", "NestApplication");
    log.log("watching the logs", "Listener");
  });
  assert.ok(!out.includes("Mapped") && !out.includes("CoreModule") && !out.includes("successfully"), out);
  assert.match(out, /\[Listener\] watching the logs/);
  process.env.RUNDOWN_DEBUG = "1";
  assert.match(capture(() => serverLogger(false).log("Mapped {/api/health, GET} route", "RouterExplorer")), /Mapped \{\/api\/health, GET\} route/);
  delete process.env.RUNDOWN_DEBUG;
});

test("colours only on a terminal, and never with NO_COLOR", () => {
  delete process.env.NO_COLOR;
  assert.match(capture(() => serverLogger(true).log("hello", "Test")), /\x1b\[/);
  assert.doesNotMatch(capture(() => serverLogger(false).log("hello", "Test")), /\x1b\[/);
  process.env.NO_COLOR = "1";
  assert.doesNotMatch(capture(() => serverLogger(true).log("hello", "Test")), /\x1b\[/);
  delete process.env.NO_COLOR;
});

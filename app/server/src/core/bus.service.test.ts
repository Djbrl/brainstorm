import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import { BusService } from "./bus.service";

// Run with `npm run test:bus` (compiles with the project's tsc, then node:test).

Logger.overrideLogger(false); // keep the expected "listener failed" warnings out of the test output

const touched = { path: "/x/a.ts", sessionId: "s1", ts: "2026-10-05T00:00:00Z" };

test("a listener that throws doesn't stop the next one or reach the emitter", () => {
  const bus = new BusService();
  const seen: string[] = [];
  bus.on("file-touched", () => { seen.push("first"); });
  bus.on("file-touched", () => { throw new Error("boom"); });
  bus.on("file-touched", ({ path }) => { seen.push(`third ${path}`); });
  assert.doesNotThrow(() => bus.emit("file-touched", touched));
  assert.deepEqual(seen, ["first", "third /x/a.ts"]);
});

test("a listener that rejects is caught too", async () => {
  const bus = new BusService();
  let after = false;
  bus.on("workspace", async () => { throw new Error("async boom"); });
  bus.on("workspace", () => { after = true; });
  let unhandled = false;
  const onUnhandled = () => { unhandled = true; };
  process.on("unhandledRejection", onUnhandled);
  bus.emit("workspace", { root: "/x" });
  await new Promise((r) => setTimeout(r, 10));
  process.off("unhandledRejection", onUnhandled);
  assert.equal(after, true);
  assert.equal(unhandled, false);
});

test("events with no listeners are fine, and each listener sees its own event only", () => {
  const bus = new BusService();
  assert.doesNotThrow(() => bus.emit("workspace", { root: "/x" }));
  const roots: string[] = [];
  bus.on("workspace", ({ root }) => { roots.push(root); });
  bus.emit("file-touched", touched);
  bus.emit("workspace", { root: "/y" });
  assert.deepEqual(roots, ["/y"]);
});

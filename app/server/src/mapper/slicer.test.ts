import test from "node:test";
import assert from "node:assert/strict";
import { slicer } from "./live";

test("a sliced loop gives the event loop back every few milliseconds", async () => {
  const slice = slicer(5);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  // Busy until it has given the loop back five times (time-bounded, so a loaded machine slows it but can't fail it).
  let yields = 0;
  const end = performance.now() + 2_000;
  while (yields < 5 && performance.now() < end) if (await slice.due()) yields++;
  clearInterval(timer);
  assert.ok(yields >= 5, `yielded ${yields} times`);
  assert.ok(ticks >= 3, `timers ran ${ticks} times`);
});

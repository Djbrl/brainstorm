import test from "node:test";
import assert from "node:assert/strict";
import { slicer } from "./live";

test("a sliced loop gives the event loop back every few milliseconds", async () => {
  const slice = slicer(5);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  let yields = 0;
  const end = performance.now() + 60;
  while (performance.now() < end) if (await slice.due()) yields++;
  clearInterval(timer);
  assert.ok(yields >= 5, `yielded ${yields} times`);
  assert.ok(ticks >= 3, `timers ran ${ticks} times`);
});

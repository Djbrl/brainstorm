// The label pass places names where they don't cover each other, the same on every frame (its buffers are reused).
import { describe, expect, it } from "vitest";
import { drawQueuedLabels, LabelSpace, type QueuedLabel } from "./labels";

const ctx = document.createElement("canvas").getContext("2d") as unknown as CanvasRenderingContext2D; // every text 10 px wide (setup.ts)
const label = (text: string, x: number, y: number, prio: number, must = false): QueuedLabel => ({
  text, x, y, size: 12, scale: 1, alpha: 1, weight: 500, family: "x", ink: "#000", halo: "#fff", prio, forced: false, must,
  at: { id: text, x, y: y - 10, r: 6 },
});
// Where the label pass put them before its buffers were reused (the same code with fresh objects per frame).
const PLACED = [["a", 0, 0], ["b", 0, -31], ["c", 0, 0], ["d", 0, 0]]; // c and d find no room: they wait for the zoom
const place = (space: LabelSpace) => {
  space.reset(40);
  const q = [label("a", 0, 0, 2), label("b", 0, 0, 1), label("c", 0, 0, 0), label("d", 0, 0, 0), label("e", 0, 0, 0, true)];
  drawQueuedLabels(ctx, q, space);
  return q.map((l) => [l.text, Math.round(l.x), Math.round(l.y)]);
};

describe("drawQueuedLabels", () => {
  it("puts the most important name under its file, the next one above it, and a must one anyway", () => {
    const got = place(new LabelSpace());
    expect(got.find((l) => l[0] === "a")).toEqual(["a", 0, 0]);
    expect(got.slice(0, 4)).toEqual(PLACED);
    expect(got.find((l) => l[0] === "e")).toEqual(["e", 0, 0]);
  });
  it("places the same way frame after frame", () => {
    const space = new LabelSpace();
    const first = place(space);
    for (let i = 0; i < 5; i++) expect(place(space)).toEqual(first);
  });
});

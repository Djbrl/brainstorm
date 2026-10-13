// The director's framing maths: the area it frames, the dead zone, the zoom by spread, cut or glide, look-ahead.
import { describe, expect, it } from "vitest";
import { DIRECTOR, frameArea, groupAhead, inDeadZone, isCut, shouldMove, viewFor, zoomForSpread } from "./director";
import type { Safe } from "./camera";

// A 1000 × 800 canvas, nothing covering it: the dead zone is the middle 600 × 480, a framing fills the middle 420 × 336.
const S: Safe = { w: 1000, h: 800, left: 0, top: 0, right: 0, bottom: 0 };

describe("frame area", () => {
  it("frames every agent's recent edits together when they fit", () => {
    const box = frameArea([[{ x: 0, y: 0 }, { x: 50, y: 20 }], [{ x: 200, y: 100 }]], 1, S);
    expect(box).toEqual({ x0: 0, y0: 0, x1: 200, y1: 100 });
  });
  it("frames only the agent that edited last when they're too far apart", () => {
    const box = frameArea([[{ x: 0, y: 0 }], [{ x: 5000, y: 0 }, { x: 5100, y: 40 }]], 1, S);
    expect(box).toEqual({ x0: 5000, y0: 0, x1: 5100, y1: 40 });
  });
  it("has nothing to frame without points", () => expect(frameArea([[]], 0, S)).toBeNull());
});

describe("zoom by spread", () => {
  it("comes close on one file (its neighbourhood) but no closer than the most", () => {
    expect(zoomForSpread({ x0: 10, y0: 10, x1: 10, y1: 10 }, S)).toBe(Math.min(DIRECTOR.maxK, 336 / 120));
  });
  it("steps back as the edits spread", () => {
    const near = zoomForSpread({ x0: 0, y0: 0, x1: 150, y1: 100 }, S), far = zoomForSpread({ x0: 0, y0: 0, x1: 400, y1: 200 }, S);
    expect(far).toBeLessThan(near);
    expect(far).toBeCloseTo(Math.min(420 / 400, 336 / 200));
  });
  it("never goes past the least zoom", () => expect(zoomForSpread({ x0: 0, y0: 0, x1: 1e5, y1: 1e5 }, S)).toBe(DIRECTOR.minK));
  it("centres the area in the safe area, even with a panel open", () => {
    const s = { ...S, left: 300 };
    const v = viewFor({ x0: 0, y0: 0, x1: 100, y1: 100 }, s);
    // The box's middle (50, 50) lands in the middle of the uncovered part (x 650, y 400).
    expect(s.w / 2 + (50 - v.x) * v.k).toBeCloseTo(650);
    expect(s.h / 2 + (50 - v.y) * v.k).toBeCloseTo(400);
  });
});

describe("dead zone", () => {
  const v = { x: 0, y: 0, k: 1 };   // graph (0, 0) at the canvas middle (500, 400)
  it("holds still while the markers stay in the middle 60%", () => {
    expect(inDeadZone(v, S, [{ x: 290, y: 230 }, { x: -290, y: -230 }])).toBe(true);
    expect(shouldMove(v, S, [{ x: 290, y: 0 }], { x: 0, y: 0, k: 1.2 })).toBe(false);
  });
  it("moves once a marker leaves it", () => {
    expect(inDeadZone(v, S, [{ x: 310, y: 0 }])).toBe(false);
    expect(shouldMove(v, S, [{ x: 0, y: 250 }], v)).toBe(true);
  });
  it("moves when the view is far wider than the spread wants, even inside it, but not when it's closer", () => {
    expect(shouldMove(v, S, [{ x: 0, y: 0 }], { x: 0, y: 0, k: 2.5 })).toBe(true);
    expect(shouldMove(v, S, [{ x: 0, y: 0 }], { x: 0, y: 0, k: 0.3 })).toBe(false);
  });
  it("never moves for nobody", () => expect(shouldMove(v, S, [], { x: 0, y: 0, k: 9 })).toBe(false));
});

describe("cut or glide", () => {
  it("glides a short way", () => expect(isCut({ x: 0, y: 0, k: 1 }, { x: 400, y: 0, k: 1.2 }, S)).toBe(false));
  it("cuts a long way", () => expect(isCut({ x: 0, y: 0, k: 1 }, { x: 3000, y: 0, k: 1 }, S)).toBe(true));
  it("cuts a big change of zoom", () => expect(isCut({ x: 0, y: 0, k: 0.3 }, { x: 0, y: 0, k: 2.4 }, S)).toBe(true));
});

describe("look-ahead", () => {
  it("groups the next nearby moves into one framing", () => {
    const pts = [{ x: 0, y: 0 }, { x: 40, y: 10 }, { x: 80, y: -20 }, { x: 120, y: 30 }];
    expect(groupAhead(pts, S)).toHaveLength(4);
  });
  it("stops at the first move that's too far to share the framing", () => {
    const pts = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 4000, y: 0 }, { x: 70, y: 0 }];
    expect(groupAhead(pts, S)).toEqual([{ x: 0, y: 0 }, { x: 60, y: 0 }]);
  });
  it("looks at most a few moves ahead, and always keeps the marker's own place", () => {
    expect(groupAhead(Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 })), S)).toHaveLength(DIRECTOR.ahead + 1);
    expect(groupAhead([{ x: 0, y: 0 }], S)).toHaveLength(1);
    expect(groupAhead([], S)).toHaveLength(0);
  });
});

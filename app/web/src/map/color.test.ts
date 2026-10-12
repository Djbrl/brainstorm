// A file's colour from its time: the parsed form (cached on map nodes) gives what the string gives.
import { describe, expect, it } from "vitest";
import { fadesFor, recencyAt, recencyRGB, type Tokens } from "./color";

const t = { hot: [255, 91, 31], warm: [255, 166, 110], cool: [199, 203, 214] } as unknown as Tokens;
describe("recency colours", () => {
  it("are the same from the time string or its parsed time", () => {
    const now = Date.parse("2026-10-11T12:00:00Z"), since = now - 3_600_000;
    for (let m = -1; m < 120; m += 0.7) {
      const iso = new Date(now - m * 60_000).toISOString();
      for (const rec of [false, true]) expect(recencyAt(t, Date.parse(iso), now, rec, since)).toEqual(recencyRGB(t, iso, now, rec, since));
    }
    expect(recencyRGB(t, undefined, now, false, since)).toEqual(t.cool);
  });
  it("stop moving once a change is older than fadesFor", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    for (const rec of [false, true]) {
      const at = now - fadesFor(rec);
      expect(recencyAt(t, at, now, rec, 0)).toEqual(recencyAt(t, at - 3_600_000, now + 3_600_000 * 5, rec, 0));
    }
  });
});

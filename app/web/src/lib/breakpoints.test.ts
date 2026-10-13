// The layout's widths are written twice, in the scripts (lib/breakpoints.ts) and in the CSS media queries: the files
// the comment there lists must use the same numbers.
import { describe, expect, it } from "vitest";
import { matches, NARROW, NARROW_PX, PHONE, PHONE_PX, reducedMotion } from "./breakpoints";

const sheets = import.meta.glob("../map/**/*.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const css = (rel: string) => sheets[`../${rel}`] ?? "";
const widths = (text: string) => [...text.matchAll(/(max|min)-width:\s*(\d+)px/g)].map((m) => `${m[1]}-${m[2]}`);

describe("breakpoints", () => {
  it("say the same widths as the CSS", () => {
    const narrow = ["map/map.css", "map/sidebar/sidebar.css", "map/dock.css"];
    const phone = ["map/map.css", "map/readmap.css", "map/sidebar/sidebar.css", "map/dock.css", "map/tour/tour.css"];
    for (const f of narrow) expect(widths(css(f)), f).toContain(`max-${NARROW_PX}`);
    for (const f of phone) expect(widths(css(f)), f).toContain(`max-${PHONE_PX}`);
    for (const f of ["map/sidebar/sidebar.css"]) expect(widths(css(f)), f).toContain(`min-${PHONE_PX + 1}`);
    expect(NARROW).toBe(`(max-width: ${NARROW_PX}px)`);
    expect(PHONE).toBe(`(max-width: ${PHONE_PX}px)`);
    expect(PHONE_PX).toBeLessThan(NARROW_PX);
  });

  it("read media queries, and say no where there's no window", () => {
    const g = globalThis as { matchMedia?: unknown };
    const real = g.matchMedia;
    g.matchMedia = (q: string) => ({ matches: q === PHONE, addEventListener() {}, removeEventListener() {} });
    expect(matches(PHONE)).toBe(true);
    expect(matches(NARROW)).toBe(false);
    g.matchMedia = undefined;
    expect(matches(PHONE)).toBe(false);
    expect(reducedMotion()).toBe(false);
    g.matchMedia = real;
  });
});

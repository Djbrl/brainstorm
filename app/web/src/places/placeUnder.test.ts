import { describe, expect, it } from "vitest";
import { placeUnder, type PNode } from "./PlacesMap";

const node = (id: string, kind: PNode["kind"], x: number, y: number, r: number): PNode =>
  ({ id, kind, area: "web", label: id, x, y, r, events: 1, changes: 0, failed: 0 }) as PNode;

describe("placeUnder", () => {
  const area = node("area|web", "area", 0, 0, 100), site = node("s", "site", 0, 0, 40), page = node("p", "page", 10, 0, 3);
  const g = { id: 1, nodes: [area, site, page], folders: [area, site] };
  it("finds the place drawn last, on top", () => expect(placeUnder(g, 10, 0, 1)?.id).toBe("p"));
  it("gives a tiny place at least 5 units", () => expect(placeUnder(g, 14.5, 0, 1)?.id).toBe("p"));
  it("goes through an area to nothing", () => expect(placeUnder(g, 80, 0, 1)).toBeNull());
});

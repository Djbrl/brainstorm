// The map's layout depends only on which files exist: the same files in any order, with or without a structure
// version, give the same places (seeded from the audit's t-graph-nav.cjs, 150 maps).
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import type { FileNode } from "@contract";
import { hitAt, useGraph, type Graph } from "./graph";
import type { Island } from "../lib/islands";
import { int, pick, rng, shuffle } from "../test/fixtures";

/** useGraph is a hook: run it in a component rendered once on the server side. */
function layout(files: FileNode[], structure?: number, islands?: Island[]): Graph {
  let out: Graph | undefined;
  const Probe = () => { out = useGraph({ root: "/p", files, edges: [], modules: [] }, "light", structure, islands).graph; return null; };
  renderToString(createElement(Probe));
  return out!;
}
const places = (g: Graph) => new Map(g.nodes.map((n) => [n.id as string, { x: n.x, y: n.y, r: n.r }]));

const DIRS = ["", "src", "src/lib", "src/lib/deep", "src/ui", "app/web/src", "docs", "test", "a/b/c/d"];
function files(r: () => number, n: number): FileNode[] {
  const s = new Map<string, FileNode>();
  while (s.size < n) { const d = pick(r, DIRS); const p = `/p/${d ? d + "/" : ""}f${int(r, 400)}.ts`; s.set(p, { path: p, module: ".", lines: 1 + int(r, 900) }); }
  return [...s.values()];
}

describe("useGraph", () => {
  it("places the same files at the same spots whatever their order", () => {
    const r = rng(77);
    for (let t = 0; t < 60; t++) {
      const fs = files(r, 5 + int(r, 120));
      const a = places(layout(fs, 1));
      expect(places(layout(shuffle(r, fs), 1)), `map ${t}`).toEqual(a);
      expect(places(layout(shuffle(r, fs))), `map ${t}, no structure version`).toEqual(a);
    }
  });

  it("puts every file inside its folder's circle, and finds it there", () => {
    const g = layout(files(rng(3), 80), 1);
    for (const n of g.nodes) {
      const up = n.up;
      if (n.dir || !up) continue;
      expect(Math.hypot(n.x! - up.x!, n.y! - up.y!) + n.r).toBeLessThanOrEqual(up.r + 1e-6);
      expect(hitAt(g, n.x!, n.y!, 1)?.id).toBe(n.id);
    }
  });

  it("gives an empty map for no files", () => {
    expect(layout([]).nodes).toEqual([]);
  });
});

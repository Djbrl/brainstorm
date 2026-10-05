// Owner: viewers. Colour-coded code for the step panel and the file window, with the same grammars and colours the
// diff viewer uses (refractor, already in the app for diffs). Loaded the first time code is shown: refractor's core,
// then each language's grammar on its own (a grammar pulls in the ones it builds on), so a project in TypeScript never
// downloads Rust. Highlighting is synchronous once a grammar is in, and only the lines on show are coloured.
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { THEMES, useTheme } from "./theme";

type Grammar = { default: (p: unknown) => void };
const GRAMMARS: Record<string, () => Promise<Grammar>> = {
  typescript: () => import("refractor/typescript"), tsx: () => import("refractor/tsx"),
  javascript: () => import("refractor/javascript"), jsx: () => import("refractor/jsx"),
  json: () => import("refractor/json"), css: () => import("refractor/css"), scss: () => import("refractor/scss"),
  markup: () => import("refractor/markup"), bash: () => import("refractor/bash"), python: () => import("refractor/python"),
  markdown: () => import("refractor/markdown"), yaml: () => import("refractor/yaml"), go: () => import("refractor/go"),
  rust: () => import("refractor/rust"), java: () => import("refractor/java"), sql: () => import("refractor/sql"),
  diff: () => import("refractor/diff"), toml: () => import("refractor/toml"), ini: () => import("refractor/ini"),
  swift: () => import("refractor/swift"), kotlin: () => import("refractor/kotlin"), ruby: () => import("refractor/ruby"),
  php: () => import("refractor/php"), c: () => import("refractor/c"), cpp: () => import("refractor/cpp"),
  csharp: () => import("refractor/csharp"),
};
const EXT: Record<string, string> = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx", js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx", json: "json", jsonc: "json", css: "css", scss: "scss", html: "markup", htm: "markup", xml: "markup",
  svg: "markup", vue: "markup", sh: "bash", bash: "bash", zsh: "bash", fish: "bash", py: "python", md: "markdown",
  mdx: "markdown", yml: "yaml", yaml: "yaml", go: "go", rs: "rust", java: "java", sql: "sql", diff: "diff",
  patch: "diff", toml: "toml", ini: "ini", cfg: "ini", swift: "swift", kt: "kotlin", kts: "kotlin", rb: "ruby",
  php: "php", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp",
};
/** The grammar for a file, by its extension (undefined: shown plain). */
export function langOf(path: string | undefined | null): string | undefined {
  const m = /\.([a-z0-9]+)$/i.exec(path ?? "");
  return m ? EXT[m[1].toLowerCase()] : undefined;
}

type Refractor = { highlight: (code: string, lang: string) => Root; register: (g: unknown) => void; registered: (l: string) => boolean };
type Root = { children: Node[] };
type Node = { type: "text"; value: string } | { type: "element"; properties?: { className?: string[] }; children: Node[] };
let core: Promise<Refractor> | null = null;
const loading = new Map<string, Promise<void>>();
const ready = new Set<string>();
function load(lang: string): Promise<void> {
  let p = loading.get(lang);
  if (!p) {
    core ??= import("refractor/core").then((m) => m.refractor as unknown as Refractor);
    p = Promise.all([core, GRAMMARS[lang]()]).then(([r, g]) => { r.register(g.default); ready.add(lang); });
    loading.set(lang, p);
  }
  return p;
}
let refractor: Refractor | null = null;

/** A line of code as coloured pieces: the text, and its token type (none: the plain colour). */
export type Piece = { t: string; k?: string };
/**
 * `code` split into lines of coloured pieces, or null while the grammar loads (or with no grammar for it). Nested
 * tokens take the innermost type the palette knows (an interpolation inside a string is coloured as itself).
 */
export function highlightLines(code: string, lang: string | undefined): Piece[][] | null {
  if (!lang || !refractor || !ready.has(lang)) return null;
  const lines: Piece[][] = [[]];
  const walk = (nodes: Node[], k: string | undefined) => {
    for (const n of nodes) {
      if (n.type === "text") {
        const parts = n.value.split("\n");
        parts.forEach((t, i) => { if (i) lines.push([]); if (t) lines[lines.length - 1].push({ t, k }); });
      } else {
        const cls = n.properties?.className ?? [];
        const own = cls.find((c) => c !== "token" && c in LIGHT);
        walk(n.children, own ?? k);
      }
    }
  };
  try { walk(refractor.highlight(code, lang).children, undefined); } catch { return null; }
  return lines;
}

/** Re-renders once the grammar for `lang` is in (true then); false while it loads or when there's none. */
export function useGrammar(lang: string | undefined): boolean {
  const [, bump] = useState(0);
  const has = !!lang && ready.has(lang) && !!refractor;
  useEffect(() => {
    if (!lang || !GRAMMARS[lang] || has) return;
    let live = true;
    load(lang).then(() => core!).then((r) => { refractor = r; if (live) bump((n) => n + 1); }).catch(() => {});
    return () => { live = false; };
  }, [lang, has]);
  return has;
}

/** One line's pieces as React nodes, coloured from the palette (inline, like the diff viewer: no stylesheet to clash). */
export function renderPieces(pieces: Piece[], palette: Palette): ReactNode {
  return pieces.map((p, i) => (p.k ? createElement("span", { key: i, style: { color: palette[p.k] } }, p.t) : p.t));
}

export type Palette = Record<string, string>;
/** Light themes: GitHub light, as the diff viewer's own light palette, with plain text in the theme's ink. */
const LIGHT: Palette = {
  default: "inherit", comment: "#6a737d", prolog: "#6a737d", doctype: "#6a737d", cdata: "#6a737d", punctuation: "#57606a",
  property: "#005cc5", tag: "#22863a", boolean: "#005cc5", number: "#005cc5", constant: "#005cc5", symbol: "#005cc5",
  deleted: "#b31d28", selector: "#6f42c1", "attr-name": "#6f42c1", string: "#032f62", char: "#032f62", builtin: "#005cc5",
  inserted: "#22863a", operator: "#d73a49", entity: "#22863a", url: "#032f62", "attr-value": "#032f62", keyword: "#d73a49",
  atrule: "#d73a49", "class-name": "#6f42c1", function: "#6f42c1", regex: "#032f62", important: "#d73a49", variable: "#e36209",
};
/** Dark themes (PS2, Dead Space): softer than the diff viewer's Dracula, readable on navy and on near-black green. */
const DARK: Palette = {
  default: "inherit", comment: "#7d8aa6", prolog: "#7d8aa6", doctype: "#7d8aa6", cdata: "#7d8aa6", punctuation: "#b8c0d4",
  property: "#7fd4f5", tag: "#ff8ecf", boolean: "#c9a7ff", number: "#c9a7ff", constant: "#c9a7ff", symbol: "#c9a7ff",
  deleted: "#ff7b7b", selector: "#8ff0a4", "attr-name": "#8ff0a4", string: "#f3e98a", char: "#f3e98a", builtin: "#7fd4f5",
  inserted: "#8ff0a4", operator: "#ff8ecf", entity: "#ff8ecf", url: "#f3e98a", "attr-value": "#f3e98a", keyword: "#ff8ecf",
  atrule: "#ff8ecf", "class-name": "#7fd4f5", function: "#8ff0a4", regex: "#ffc285", important: "#ffc285", variable: "#e6e9f2",
};
/** The palette for the current map theme (and whether it's a dark one). */
export function usePalette(): { palette: Palette; dark: boolean } {
  const dark = THEMES.find((t) => t.id === useTheme())?.dark ?? false;
  return { palette: dark ? DARK : LIGHT, dark };
}

// The little of a browser the tested modules touch when they load (vitest runs them in Node, with no DOM): a canvas that
// measures every text 10 px wide, storage in memory, media queries that never match, a location at "/". Tests that
// need a different location or media query change these objects.
const ctx = new Proxy({} as Record<string | symbol, unknown>, {
  get: (t, k) => (k === "measureText" ? () => ({ width: 10 }) : k in t ? t[k] : () => ({ addColorStop() {} })),
  set: (t, k, v) => { t[k] = v; return true; },
});
const canvas = () => ({ getContext: () => ctx, width: 0, height: 0, style: {} });
const g = globalThis as Record<string, unknown>;
g.document = {
  documentElement: { dataset: {}, style: { setProperty() {} } }, createElement: canvas, addEventListener() {}, removeEventListener() {},
  querySelector: () => null, getElementById: () => null, body: {}, visibilityState: "visible",
};
g.window = globalThis;
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
const kept = new Map<string, string>();
g.localStorage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, String(v)), removeItem: (k: string) => void kept.delete(k), clear: () => kept.clear() };
g.location = { protocol: "http:", pathname: "/", search: "", hash: "", origin: "http://127.0.0.1", href: "http://127.0.0.1/", host: "127.0.0.1" };
g.history = { pushState() {}, replaceState() {} };
g.OffscreenCanvas = function () { return canvas(); };
g.getComputedStyle = () => ({ getPropertyValue: () => "" });

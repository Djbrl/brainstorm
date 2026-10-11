// Small text helpers for the server and the web.

/** A path's last part ("/a/b/c.ts" → "c.ts"), "/" and "\" alike; "" for no path. */
export const basename = (p?: string) => (p ? p.split(/[\\/]/).filter(Boolean).pop() ?? p : "");

/** "1 step", "962 steps", "1,204 files". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Text on one line (runs of whitespace made one space), cut to `max` characters with "…". */
export const oneLine = (s: string, max: number) => { const l = s.replace(/\s+/g, " ").trim(); return l.length > max ? `${l.slice(0, max - 1).trimEnd()}…` : l; };

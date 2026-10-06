// Shared by api/usage.js (receives the daily report) and api/usage-stats.js (the admin page's numbers). Not a function
// itself: Vercel skips files starting with "_".
//
// One report = one file in the private Blob store (the waitlist's), and everything is in its name, so the admin page
// needs a listing, never a read:  usage/<day>/<id>_<kind>_<country>_<version>_<os>_<theme>_<counts>.json
// counts: "th3-rp1-…" (only the non-zero ones) or "0". The app side is app/server/src/usage/usage.service.ts.

const KEYS = ["op", "th", "rp", "lv", "sh", "ak", "pj", "se", "st"];
const OS = new Set(["darwin", "linux", "win32", "other"]);
const THEMES = new Set(["default", "metro", "prism", "hologram", "none"]);
const RENAMED = { ps2: "prism", deadspace: "hologram" };   // 0.5 and older report the themes' old names
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** The Blob store's credentials, as the SDK resolves them: Vercel's OIDC token plus BLOB_STORE_ID, else BLOB_READ_WRITE_TOKEN. */
function blobAuth(req) {
  const oidc = req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
  const rw = process.env.BLOB_READ_WRITE_TOKEN;
  return oidc && process.env.BLOB_STORE_ID
    ? { token: oidc, storeId: process.env.BLOB_STORE_ID.replace(/^store_/, "") }
    : rw ? { token: rw, storeId: rw.split("_")[3] || "" } : null;
}
const blobHeaders = (auth) => ({ authorization: `Bearer ${auth.token}`, "x-api-version": "12", "x-vercel-blob-store-id": auth.storeId });

/** A report from the app, checked field by field. Anything unexpected is refused, so nothing else can be smuggled in. */
function validate(body) {
  if (!body || typeof body !== "object") return null;
  const { id, kind, v, os, tm, c } = body;
  if (typeof id !== "string" || !ID.test(id)) return null;
  if (kind !== "new" && kind !== "day") return null;
  if (typeof v !== "string" || !VERSION.test(v)) return null;
  if (typeof os !== "string" || !OS.has(os)) return null;
  const named = typeof tm === "string" ? RENAMED[tm] ?? tm : "";
  const theme = THEMES.has(named) ? named : "none";
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const counts = {};
  for (const [k, n] of Object.entries(c)) {
    if (!KEYS.includes(k) || !Number.isInteger(n) || n < 0 || n > 1_000_000) return null;
    if (n > 0) counts[k] = n;
  }
  return { id, kind, v, os, tm: theme, c: counts };
}

/** Vercel's country header: two letters, or XX. The IP itself is never read or kept. */
const countryOf = (req) => { const cc = String(req.headers["x-vercel-ip-country"] || "").toUpperCase(); return /^[A-Z]{2}$/.test(cc) ? cc : "XX"; };

function pathnameFor(r, country, day) {
  const counts = KEYS.filter((k) => r.c[k]).map((k) => `${k}${r.c[k]}`).join("-") || "0";
  return `usage/${day}/${r.id}_${r.kind}_${country}_${r.v}_${r.os}_${r.tm}_${counts}.json`;
}

function parsePathname(p) {
  const m = /^usage\/(\d{4}-\d{2}-\d{2})\/([0-9a-f-]{36})_(new|day)_([A-Z]{2})_(\d{1,3}\.\d{1,3}\.\d{1,3})_([a-z0-9]+)_([a-z0-9]+)_([a-z0-9-]+)\.json$/.exec(p);
  if (!m) return null;
  const c = {};
  if (m[8] !== "0") for (const part of m[8].split("-")) { const k = part.slice(0, 2), n = Number(part.slice(2)); if (KEYS.includes(k) && Number.isFinite(n)) c[k] = n; }
  return { day: m[1], id: m[2], kind: m[3], cc: m[4], v: m[5], os: m[6], tm: m[7], c };
}

const dayOf = (d) => d.toISOString().slice(0, 10);
const addDays = (day, n) => dayOf(new Date(Date.parse(day + "T00:00:00Z") + n * 86_400_000));
const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);
const countBy = (items, key) => {
  const m = new Map();
  for (const it of items) m.set(it[key], (m.get(it[key]) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, installs: n }));
};

/** The admin page's numbers, from the reports' names alone. `today` is a UTC day (YYYY-MM-DD). */
function aggregate(records, today, days = 30) {
  // One report per install per day; a retried one keeps the fullest.
  const byKey = new Map();
  for (const r of records) {
    const k = r.id + r.day, had = byKey.get(k);
    if (!had || total(r.c) > total(had.c)) byKey.set(k, r);
  }
  const all = [...byKey.values()];
  const first = new Map();
  for (const r of all) if (!first.has(r.id) || r.day < first.get(r.id)) first.set(r.id, r.day);
  const since = (n) => addDays(today, -(n - 1));
  const window = all.filter((r) => r.day >= since(days));
  const latest = new Map();
  for (const r of window) if (!latest.has(r.id) || r.day > latest.get(r.id).day) latest.set(r.id, r);
  const active = (n) => new Set(all.filter((r) => r.day >= since(n) && r.day <= today).map((r) => r.id)).size;

  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today, -i), rs = all.filter((r) => r.day === day), uses = {};
    for (const r of rs) for (const [k, n] of Object.entries(r.c)) uses[k] = (uses[k] ?? 0) + n;
    series.push({ day, active: new Set(rs.map((r) => r.id)).size, newInstalls: [...first.values()].filter((d) => d === day).length, uses });
  }
  const uses = {};
  for (const r of window) for (const [k, n] of Object.entries(r.c)) uses[k] = (uses[k] ?? 0) + n;

  // Came back: of the installs at least a week old, how many were used again within their first week.
  const old = [...first.entries()].filter(([, d]) => d <= addDays(today, -7));
  const back = old.filter(([id, d]) => all.some((r) => r.id === id && r.day > d && r.day <= addDays(d, 7))).length;

  return {
    today, days,
    installs: first.size,
    active: { day: active(1), week: active(7), month: active(30) },
    cameBackWithinAWeek: old.length ? { installs: old.length, share: back / old.length } : null,
    countries: countBy([...latest.values()], "cc"),
    versions: countBy([...latest.values()], "v"),
    os: countBy([...latest.values()], "os"),
    themes: countBy([...latest.values()], "tm"),
    uses,
    series,
  };
}

module.exports = { KEYS, blobAuth, blobHeaders, validate, countryOf, pathnameFor, parsePathname, aggregate, dayOf };

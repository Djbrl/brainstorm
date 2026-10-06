import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DbService } from "../core/db.service";
import { BusService } from "../core/bus.service";
import { env } from "../core/local";

// Owned by the lead. Anonymous usage stats: once a day, counts of what was used, sent to the landing site so we know how
// many people use Rundown, roughly where, and which parts matter. On by default, off in Settings (or with DO_NOT_TRACK=1
// or RUNDOWN_USAGE=off), and never sent from a development build. What is sent, exactly (also in the README):
//   id    a random install id made on this machine (not derived from anything about it)
//   kind  "new" the first time, then "day"
//   v, os Rundown's version and the platform (darwin, linux, win32)
//   tm    the map theme in use
//   c     counts since the last report: op app opened, th threads opened, rp replays played, lv live follows,
//         sh threads shared, ak questions asked, pj projects opened, se agent sessions seen working, st agent steps seen
// The landing site adds the country from the request and keeps no IP. Never code, paths, prompts, titles or names.

export const USAGE_KEYS = ["op", "th", "rp", "lv", "sh", "ak", "pj", "se", "st"] as const;
export type UsageKey = (typeof USAGE_KEYS)[number];
/** Counts the web app reports (the server counts the rest itself). */
export const WEB_KEYS = new Set<string>(["op", "th", "rp", "lv"]);
export const THEMES = new Set(["default", "metro", "prism", "hologram"]);

const ENDPOINT = process.env.RUNDOWN_USAGE_URL ?? "https://brainstorm-landing.vercel.app/api/usage";
const FIRST_TRY_MS = 60_000;          // after start, so a crash loop doesn't report
const EVERY_MS = 60 * 60_000;         // then hourly: one report per UTC day at most
const SAVE_MS = 30_000;               // counts are saved this often (a restart loses at most that much)

export type UsageStatus = {
  enabled: boolean;
  /** Why it's off whatever the setting says: DO_NOT_TRACK or RUNDOWN_USAGE in the environment. */
  locked: string | null;
  /** False in a development build: nothing is sent even when enabled. */
  sends: boolean;
  lastSent: string | null;
  pending: Partial<Record<UsageKey, number>>;
};

@Injectable()
export class UsageService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Usage");
  private counts: Partial<Record<UsageKey, number>> = {};
  private sessions = new Set<string>();
  private theme = "";
  private dirty = false;
  private on = true;                  // the setting, read once (a step bumps a count: no database read each time)
  private timers: NodeJS.Timeout[] = [];

  constructor(private dbs: DbService, private bus: BusService) {}

  onModuleInit() {
    this.dbs.db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`);
    try { this.counts = JSON.parse(this.get("usage.counts") ?? "{}"); } catch { this.counts = {}; }
    try { for (const s of JSON.parse(this.get("usage.sessions") ?? "[]")) this.sessions.add(s); } catch { /* none */ }
    this.theme = this.get("usage.theme") ?? "";
    this.on = this.get("usage.enabled") !== "0";
    // Live agent work only: the listener emits "step" for live steps, not for history it reads in.
    this.bus.on("step", (s) => {
      if (!this.enabled()) return;
      this.bump("st");
      if (!this.sessions.has(s.sessionId)) { this.sessions.add(s.sessionId); this.dirty = true; }
    });
    this.bus.on("workspace", () => this.bump("pj"));
    const first = setTimeout(() => void this.report(), FIRST_TRY_MS);
    const hourly = setInterval(() => void this.report(), EVERY_MS);
    const save = setInterval(() => this.save(), SAVE_MS);
    for (const t of [first, hourly, save]) t.unref?.();
    this.timers.push(first, hourly, save);
  }

  onModuleDestroy() { this.timers.forEach(clearTimeout); this.save(); }

  // ---- reads and settings ----

  status(): UsageStatus {
    return { enabled: this.enabled(), locked: this.locked(), sends: this.sends(), lastSent: this.get("usage.lastDay"), pending: this.pending() };
  }

  setEnabled(on: boolean): UsageStatus {
    this.on = on;
    this.set("usage.enabled", on ? "1" : "0");
    if (!on) { this.counts = {}; this.sessions.clear(); this.dirty = true; this.save(); } // off means nothing kept to send later
    return this.status();
  }

  /** Count one use. Nothing is counted while it's off. */
  bump(key: UsageKey, n = 1) {
    if (!this.enabled()) return;
    this.counts[key] = Math.min(1_000_000, (this.counts[key] ?? 0) + n);
    this.dirty = true;
  }

  setTheme(theme: string) {
    if (!THEMES.has(theme) || theme === this.theme) return;
    this.theme = theme;
    this.set("usage.theme", theme);
  }

  // ---- the daily report ----

  private enabled() { return this.on && !this.locked(); }

  private locked(): string | null {
    const dnt = process.env.DO_NOT_TRACK, off = process.env.RUNDOWN_USAGE?.toLowerCase();
    if (dnt && dnt !== "0" && dnt.toLowerCase() !== "false") return "DO_NOT_TRACK is set";
    if (off === "off" || off === "0" || off === "false") return "RUNDOWN_USAGE is off";
    return null;
  }

  /** Only a released build reports (the plugin sets its version); a dev build never does, unless asked for testing. */
  private sends() {
    const v = env("VERSION");
    return (!!v && v !== "dev") || process.env.RUNDOWN_USAGE_DEV === "1";
  }

  private pending(): Partial<Record<UsageKey, number>> {
    const c = { ...this.counts };
    if (this.sessions.size) c.se = this.sessions.size;
    return c;
  }

  private async report() {
    if (!this.enabled() || !this.sends()) return;
    const day = new Date().toISOString().slice(0, 10);
    const last = this.get("usage.lastDay");
    if (last === day) return;
    let id = this.get("usage.id");
    if (!id) { id = randomUUID(); this.set("usage.id", id); }
    const sent = this.pending();
    const body = {
      id, kind: last ? "day" : "new",
      v: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(env("VERSION") ?? "") ? env("VERSION") : "0.0.0",
      os: ["darwin", "linux", "win32"].includes(process.platform) ? process.platform : "other",
      tm: this.theme || "none",
      c: sent,
    };
    try {
      const r = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
      if (!r.ok) { this.log.warn(`report not accepted (${r.status}); will try again later`); return; }
    } catch (e) {
      this.log.warn(`report not sent (${(e as Error).message}); will try again later`);
      return;
    }
    // Sent: start counting afresh (minus what was counted while the report was on its way, which stays for next time).
    for (const k of USAGE_KEYS) {
      if (k === "se") continue;
      const left = (this.counts[k] ?? 0) - (sent[k] ?? 0);
      if (left > 0) this.counts[k] = left; else delete this.counts[k];
    }
    this.sessions.clear();
    this.set("usage.lastDay", day);
    this.dirty = true;
    this.save();
  }

  // ---- storage (the settings table, shared with the workspace) ----

  private save() {
    if (!this.dirty) return;
    this.dirty = false;
    this.set("usage.counts", JSON.stringify(this.counts));
    this.set("usage.sessions", JSON.stringify([...this.sessions].slice(-500)));
  }

  private get(key: string): string | null {
    const row = this.dbs.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private set(key: string, value: string) {
    this.dbs.db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
  }
}

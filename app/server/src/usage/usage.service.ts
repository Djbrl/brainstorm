import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { SettingsService } from "../core/settings.service";
import { BusService } from "../core/bus.service";
import { config } from "../core/config";
import { safely } from "../core/safely";
import type { UsageStatus } from "../shared/contract";

// Anonymous usage stats: once a day, counts of what was used, sent to the landing site so we know how
// many people use Rundown, roughly where, and which parts matter. Off until the person says yes (the app asks once;
// since 0.7, also for installs that never chose), off again in Settings, always off with DO_NOT_TRACK=1 or
// RUNDOWN_USAGE=off, and never sent from a development build. "Delete the stats already sent" asks the site to remove
// every report with this install's id, then makes a new id. What is sent, exactly (also in the README and on the
// site's privacy page):
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

const ENDPOINT = config.usageUrl;
const FORGET = ENDPOINT.replace(/\/api\/usage$/, "/api/usage-forget");
const FIRST_TRY_MS = 60_000;          // after start, so a crash loop doesn't report
const EVERY_MS = 60 * 60_000;         // then hourly: one report per UTC day at most
const SAVE_MS = 30_000;               // counts are saved this often (a restart loses at most that much)


@Injectable()
export class UsageService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger("Usage");
  private counts: Partial<Record<UsageKey, number>> = {};
  private sessions = new Set<string>();
  private theme = "";
  private dirty = false;
  private on = false;                 // the setting, read once (a step bumps a count: no database read each time)
  private timers: NodeJS.Timeout[] = [];

  constructor(private settings: SettingsService, private bus: BusService) {}

  onModuleInit() {
    try { this.counts = JSON.parse(this.get("usage.counts") ?? "{}"); } catch { this.counts = {}; }
    try { for (const s of JSON.parse(this.get("usage.sessions") ?? "[]")) this.sessions.add(s); } catch { /* none */ }
    this.theme = this.get("usage.theme") ?? "";
    this.on = this.get("usage.enabled") === "1"; // only after a yes
    // Live agent work only: the listener emits "step" for live steps, not for history it reads in.
    this.bus.on("step", (s) => {
      if (!this.enabled()) return;
      this.bump("st");
      if (!this.sessions.has(s.sessionId)) { this.sessions.add(s.sessionId); this.dirty = true; }
    });
    this.bus.on("workspace", () => this.bump("pj"));
    const first = setTimeout(() => safely(this.log, "usage report", () => this.report()), FIRST_TRY_MS);
    const hourly = setInterval(() => safely(this.log, "usage report", () => this.report()), EVERY_MS);
    const save = setInterval(() => safely(this.log, "saving usage counts", () => this.save()), SAVE_MS);
    for (const t of [first, hourly, save]) t.unref?.();
    this.timers.push(first, hourly, save);
  }

  onModuleDestroy() { this.timers.forEach(clearTimeout); this.save(); }

  // ---- reads and settings ----

  status(): UsageStatus {
    return { enabled: this.enabled(), asked: this.get("usage.enabled") !== null, id: this.get("usage.lastDay") ? this.get("usage.id") : null,
      locked: this.locked(), sends: this.sends(), lastSent: this.get("usage.lastDay"), pending: this.pending() };
  }

  setEnabled(on: boolean): UsageStatus {
    this.on = on;
    this.set("usage.enabled", on ? "1" : "0");
    if (!on) { this.counts = {}; this.sessions.clear(); this.dirty = true; this.save(); } // off means nothing kept to send later
    return this.status();
  }

  /** Remove every report already sent with this install's id (the site deletes them), then start over with a new id. */
  async forget(): Promise<{ status: UsageStatus; deleted: boolean }> {
    const id = this.get("usage.id");
    let deleted = !id; // nothing was ever sent
    if (id) {
      try {
        const r = await fetch(FORGET, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(15_000) });
        deleted = r.ok;
      } catch { deleted = false; }
      if (!deleted) return { status: this.status(), deleted }; // keep the id, so asking again can still find the reports
      this.del("usage.id"); this.del("usage.lastDay");
    }
    this.counts = {}; this.sessions.clear(); this.dirty = true; this.save();
    return { status: this.status(), deleted };
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
    return config.usageLocked;
  }

  /** Only a released build reports (the plugin sets its version); a dev build never does, unless asked for testing. */
  private sends() {
    const v = config.version;
    return (!!v && v !== "dev") || config.usageDev;
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
      v: /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(config.version ?? "") ? config.version : "0.0.0",
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

  private get(key: string) { return this.settings.get(key); }
  private set(key: string, value: string) { this.settings.set(key, value); }
  private del(key: string) { this.settings.delete(key); }
}

import { Injectable } from "@nestjs/common";
import { DbService } from "../core/db.service";
import { stepsVersion, workSteps } from "../core/work-steps";
import { ListenerService } from "../listener/listener.service";
import { CallPairer } from "../listener/pairing";
import type { CoworkArea, CoworkEvent, CoworkPage, CoworkSite, CoworkSummary, Step } from "../types";
import { CODE_TOOLS, CoworkTracker } from "./classify";

// Walks threads' steps, pairs calls with results, and aggregates places. Each thread's events are kept until its
// steps change (a cheap version stamp), so the page's poll of a running thread only re-reads that thread, and only
// when it moved; threads that are done cost nothing.

type Part = { events: CoworkEvent[]; codeSteps: number };
const KEEP = 64; // threads whose events stay cached

@Injectable()
export class CoworkService {
  private parts = new Map<string, { version: string; part: Part }>();

  constructor(private dbs: DbService, private listener: ListenerService) {}

  summary(sessionId?: string): CoworkSummary {
    const sessions = sessionId ? sessionId.split(",") : this.listener.listSessions().map((s) => s.id);
    return aggregatePlaces(sessions.map((sid) => this.part(sid)));
  }

  private part(sid: string): Part {
    const version = stepsVersion(this.dbs.db, sid);
    const hit = this.parts.get(sid);
    if (hit && hit.version === version) { this.parts.delete(sid); this.parts.set(sid, hit); return hit.part; } // most recent last
    const part = placeEvents(sid, workSteps(this.dbs.db, sid));
    this.parts.delete(sid);
    this.parts.set(sid, { version, part });
    if (this.parts.size > KEEP) this.parts.delete(this.parts.keys().next().value!);
    return part;
  }
}

/** The places of some threads, from their steps. Shared by the live API and the replay export (hosted demos have no server). */
export function summarizePlaces(sessions: string[], stepsOf: (sessionId: string) => Step[]): CoworkSummary {
  return aggregatePlaces(sessions.map((sid) => placeEvents(sid, stepsOf(sid))));
}

/** One thread's place events, in step order, and how many of its steps were plain code work. */
export function placeEvents(sid: string, steps: Step[]): Part {
  const events: CoworkEvent[] = [];
  let codeSteps = 0;
  const tracker = new CoworkTracker(sid);
  const pairer = new CallPairer();                   // results pair with their call by tool_use id (order as the fallback)
  for (const st of steps) {
    if (st.kind === "tool_call" || st.kind === "edit") {
      if (CODE_TOOLS.has(st.tool ?? "") && st.tool !== "Bash") codeSteps++;
      pairer.call(st);
      continue;
    }
    if (st.kind !== "tool_result") continue;
    const call = pairer.result(st);
    if (!call) continue;
    const found = tracker.handle(call, st);
    if (call.tool === "Bash" && !found.length) codeSteps++;
    events.push(...found);
  }
  for (const call of pairer.pending()) events.push(...tracker.handle(call, undefined)); // still running
  return { events, codeSteps };
}

/** Sites and pages from threads' events (thread order, then time: the sort is stable). */
export function aggregatePlaces(parts: Part[]): CoworkSummary {
  const events: CoworkEvent[] = parts.flatMap((p) => p.events);
  const codeSteps = parts.reduce((n, p) => n + p.codeSteps, 0);
  events.sort((a, b) => a.ts.localeCompare(b.ts));

  const areas: Record<CoworkArea, number> = { web: 0, local: 0, services: 0, apps: 0 };
  const pages = new Map<string, CoworkPage & { sessionSet: Set<string> }>();
  const sites = new Map<string, CoworkSite & { pageSet: Set<string> }>();
  for (const e of events) {
    areas[e.area]++;
    const siteId = `${e.area}|${e.site}`;
    const s = sites.get(siteId) ?? sites.set(siteId, { id: siteId, area: e.area, name: e.site, pages: 0, events: 0, changes: 0, failed: 0, lastTs: e.ts, pageSet: new Set() }).get(siteId)!;
    const pageId = `${e.area}|${e.page}`;
    const p = pages.get(pageId) ?? pages.set(pageId, { id: pageId, site: siteId, area: e.area, events: 0, reads: 0, changes: 0, failed: 0, lastTs: e.ts, sessions: [], sessionSet: new Set() }).get(pageId)!;
    const isChange = !!e.change && e.change.confidence !== "maybe";
    s.events++; p.events++;
    if (isChange) { s.changes++; p.changes++; }
    if (e.failed) { s.failed++; p.failed++; }
    if (e.action === "read" || e.action === "visit" || e.action === "search") p.reads++;
    s.lastTs = p.lastTs = e.ts;
    s.pageSet.add(pageId);
    p.sessionSet.add(e.sessionId);
    if (e.title) p.title = e.title;
    if (!p.url && /^(web|local)$/.test(e.area) && !e.page.startsWith("search:")) p.url = e.page.startsWith("file:") ? `file://${e.page.slice(5)}` : `${isLocal(e.site) ? "http" : "https"}://${e.page}`;
  }

  return {
    areas, codeSteps,
    sites: [...sites.values()].map(({ pageSet, ...s }) => ({ ...s, pages: pageSet.size })).sort((a, b) => b.events - a.events),
    pages: [...pages.values()].map(({ sessionSet, ...p }) => ({ ...p, sessions: [...sessionSet] })).sort((a, b) => b.events - a.events),
    events,
  };
}

const isLocal = (site: string) => /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(site) || /\.(localhost|test)(:\d+)?$/.test(site);

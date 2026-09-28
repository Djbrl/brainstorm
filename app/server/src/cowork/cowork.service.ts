import { Injectable } from "@nestjs/common";
import { ListenerService } from "../listener/listener.service";
import type { CoworkArea, CoworkEvent, CoworkPage, CoworkSite, CoworkSummary, Step } from "../types";
import { CODE_TOOLS, CoworkTracker } from "./classify";

// Owner: cowork. Walks every session's steps, pairs calls with results, and aggregates places.

@Injectable()
export class CoworkService {
  private cache: { at: number; key: string; summary: CoworkSummary } | null = null;

  constructor(private listener: ListenerService) {}

  summary(sessionId?: string): CoworkSummary {
    const key = sessionId ?? "*";
    if (this.cache && this.cache.key === key && Date.now() - this.cache.at < 10_000) return this.cache.summary;
    const summary = this.compute(sessionId);
    this.cache = { at: Date.now(), key, summary };
    return summary;
  }

  private compute(sessionId?: string): CoworkSummary {
    const sessions = sessionId ? sessionId.split(",") : this.listener.listSessions().map((s) => s.id);
    const events: CoworkEvent[] = [];
    let codeSteps = 0;

    for (const sid of sessions) {
      const tracker = new CoworkTracker(sid);
      // Results come back in call order, so pair them first-in-first-out per thread (as in failures).
      const pending = new Map<boolean, Step[]>();
      const queue = (st: Step) => pending.get(!!st.isSubagent) ?? pending.set(!!st.isSubagent, []).get(!!st.isSubagent)!;
      for (const st of this.listener.listSteps(sid)) {
        if (st.kind === "tool_call" || st.kind === "edit") {
          if (CODE_TOOLS.has(st.tool ?? "") && st.tool !== "Bash") codeSteps++;
          queue(st).push(st);
          continue;
        }
        if (st.kind !== "tool_result") continue;
        const call = queue(st).shift();
        if (!call) continue;
        const found = tracker.handle(call, st);
        if (call.tool === "Bash" && !found.length) codeSteps++;
        events.push(...found);
      }
      for (const q of pending.values()) for (const call of q) events.push(...tracker.handle(call, undefined)); // still running
    }
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
}

const isLocal = (site: string) => /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(site) || /\.(localhost|test)(:\d+)?$/.test(site);
